"""Google Drive integration helpers for background media.

This module manages OAuth credentials, Drive API client access, and optional
local caching of remote assets. It relies on the configuration helpers in
``config.py`` to persist provider metadata.
"""
from __future__ import annotations

import io
import json
import logging
import os
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple, cast

import keyring  # type: ignore[import]
from keyring import errors as keyring_errors  # type: ignore[import]

from google.auth.exceptions import RefreshError  # type: ignore[import]
from google.auth.transport.requests import Request  # type: ignore[import]
from google.oauth2.credentials import Credentials  # type: ignore[import]
from google_auth_oauthlib.flow import Flow  # type: ignore[import]
from googleapiclient.discovery import build  # type: ignore[import]
from googleapiclient.errors import HttpError  # type: ignore[import]
from googleapiclient.http import MediaIoBaseDownload  # type: ignore[import]

import config as config_module

_DEFAULT_SCOPE = getattr(config_module, 'GOOGLE_DRIVE_SCOPE_READONLY', 'https://www.googleapis.com/auth/drive.readonly')

config = cast(Any, config_module)

LOGGER = logging.getLogger('micboard.drive')

SCOPES: Tuple[str, ...] = (_DEFAULT_SCOPE,)
SERVICE_NAME = 'wirelessboard:google-drive'
DEFAULT_CREDENTIAL_ID = 'google-drive-default'
FLOW_EXPIRY_SECONDS = 600

MEDIA_MIME_TYPES: Tuple[str, ...] = (
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime',
)
FILE_FIELDS = (
    'id,name,mimeType,size,modifiedTime,createdTime,parents,'
    'thumbnailLink,iconLink,webViewLink,webContentLink,md5Checksum,'
    'videoMediaMetadata,imageMediaMetadata'
)

_PENDING_FLOWS: Dict[str, Tuple[Flow, float]] = {}
_FLOW_LOCK = threading.Lock()


class DriveConfigError(Exception):
    """Raised when provider configuration is missing or invalid."""


class DriveCredentialError(Exception):
    """Raised when credentials cannot be loaded, refreshed, or stored."""


class DriveApiError(Exception):
    """Raised when Google Drive API requests fail."""


@dataclass
class DriveAuthMeta:
    """Serializable metadata about stored OAuth credentials."""

    credential_id: str = DEFAULT_CREDENTIAL_ID
    scopes: Tuple[str, ...] = SCOPES
    has_credentials: bool = False
    updated_at: Optional[str] = None

    def to_config(self) -> Dict[str, Any]:
        return {
            'credential_id': self.credential_id,
            'scopes': list(self.scopes),
            'has_credentials': self.has_credentials,
            'updated_at': self.updated_at,
        }

    def public_view(self) -> Dict[str, Any]:
        return {
            'credential_id': self.credential_id,
            'has_credentials': self.has_credentials,
            'scopes': list(self.scopes),
            'updated_at': self.updated_at,
        }

    @classmethod
    def from_config(cls, payload: Optional[Any]) -> 'DriveAuthMeta':
        if not isinstance(payload, dict):
            return cls()
        credential_id = str(payload.get('credential_id') or DEFAULT_CREDENTIAL_ID)
        scopes = payload.get('scopes')
        if isinstance(scopes, (list, tuple)):
            scope_tuple = tuple(str(scope) for scope in scopes if scope)
        else:
            scope_tuple = SCOPES
        has_credentials = bool(payload.get('has_credentials'))
        updated_at_raw = payload.get('updated_at')
        updated_at = str(updated_at_raw) if updated_at_raw else None
        return cls(
            credential_id=credential_id,
            scopes=scope_tuple or SCOPES,
            has_credentials=has_credentials,
            updated_at=updated_at,
        )


def _provider_config() -> Dict[str, Any]:
    config.ensure_cloud_defaults()
    cloud_cfg = config.config_tree.get('cloud', {})
    providers = cloud_cfg.get('providers', {})
    provider = providers.get('google_drive')
    if not isinstance(provider, dict):
        raise DriveConfigError('Google Drive provider settings are unavailable.')
    return provider


def _get_auth_meta() -> DriveAuthMeta:
    provider = _provider_config()
    return DriveAuthMeta.from_config(provider.get('auth'))


def _persist_auth_meta(meta: DriveAuthMeta, *, persist: bool = True) -> DriveAuthMeta:
    config.update_google_drive_auth_metadata(meta.to_config(), persist=persist)
    return meta


def public_auth_state() -> Dict[str, Any]:
    return _get_auth_meta().public_view()


def public_client_state() -> Dict[str, Any]:
    provider = _provider_config()
    client_cfg = provider.get('client')
    client_summary: Dict[str, Any] = {'has_configuration': bool(client_cfg)}
    if isinstance(client_cfg, dict):
        if 'installed' in client_cfg and isinstance(client_cfg['installed'], dict):
            installed = client_cfg['installed']
            client_summary['installed'] = {
                'client_id': installed.get('client_id'),
                'project_id': installed.get('project_id'),
                'redirect_uris': installed.get('redirect_uris'),
                'token_uri': installed.get('token_uri'),
                'auth_uri': installed.get('auth_uri'),
            }
        if 'web' in client_cfg and isinstance(client_cfg['web'], dict):
            web_cfg = client_cfg['web']
            client_summary['web'] = {
                'client_id': web_cfg.get('client_id'),
                'project_id': web_cfg.get('project_id'),
                'redirect_uris': web_cfg.get('redirect_uris'),
                'token_uri': web_cfg.get('token_uri'),
                'auth_uri': web_cfg.get('auth_uri'),
                'javascript_origins': web_cfg.get('javascript_origins'),
            }
    return client_summary


def public_provider_state() -> Dict[str, Any]:
    provider = _provider_config()
    cache_raw = provider.get('cache')
    cache_cfg = cache_raw if isinstance(cache_raw, dict) else {}
    return {
        'enabled': bool(provider.get('enabled')),
        'auth': public_auth_state(),
        'client': public_client_state(),
        'cache': {
            'default': bool(cache_cfg.get('default')),
            'directory': cache_cfg.get('directory'),
            'max_age_hours': cache_cfg.get('max_age_hours'),
        },
    }


def _credential_key(meta: Optional[DriveAuthMeta] = None) -> str:
    meta = meta or _get_auth_meta()
    credential_id = meta.credential_id or DEFAULT_CREDENTIAL_ID
    return credential_id


def _serialize_credentials(credentials: Credentials) -> str:
    payload = credentials.to_json()
    if not isinstance(payload, str):
        raise DriveCredentialError('Unable to serialize Google Drive credentials.')
    return payload


def _deserialize_credentials(payload: str, *, scopes: Iterable[str]) -> Credentials:
    try:
        info = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise DriveCredentialError('Stored Google Drive credentials are corrupted.') from exc
    creds = Credentials.from_authorized_user_info(info, scopes=list(scopes) or list(SCOPES))
    if not creds.scopes:
        creds = Credentials.from_authorized_user_info(info, scopes=list(SCOPES))
    return creds


def store_credentials(credentials: Credentials, *, meta: Optional[DriveAuthMeta] = None, persist: bool = True) -> DriveAuthMeta:
    meta = meta or _get_auth_meta()
    credential_id = _credential_key(meta)
    serialized = _serialize_credentials(credentials)
    try:
        keyring.set_password(SERVICE_NAME, credential_id, serialized)
    except keyring_errors.KeyringError as exc:
        raise DriveCredentialError('Unable to store Google Drive credentials in the system keyring.') from exc

    scopes = tuple(sorted(set(credentials.scopes or meta.scopes))) or SCOPES
    meta.scopes = scopes
    meta.has_credentials = True
    meta.updated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    _persist_auth_meta(meta, persist=persist)
    LOGGER.info('Stored Google Drive credentials (id=%s)', credential_id)
    return meta


def load_credentials(*, auto_refresh: bool = True, persist: bool = True) -> Credentials:
    meta = _get_auth_meta()
    credential_id = _credential_key(meta)
    try:
        payload = keyring.get_password(SERVICE_NAME, credential_id)
    except keyring_errors.KeyringError as exc:
        raise DriveCredentialError('Unable to access the system keyring.') from exc

    if payload is None:
        raise DriveCredentialError('Google Drive credentials have not been authorized yet.')

    credentials = _deserialize_credentials(payload, scopes=meta.scopes)

    if auto_refresh and credentials.expired and credentials.refresh_token:
        try:
            credentials.refresh(Request())
            store_credentials(credentials, meta=meta, persist=persist)
        except RefreshError as exc:
            raise DriveCredentialError('Unable to refresh Google Drive credentials.') from exc

    return credentials


def clear_credentials(*, persist: bool = True) -> DriveAuthMeta:
    meta = _get_auth_meta()
    credential_id = _credential_key(meta)
    try:
        keyring.delete_password(SERVICE_NAME, credential_id)
    except keyring_errors.PasswordDeleteError:
        pass
    except keyring_errors.KeyringError as exc:
        raise DriveCredentialError('Unable to clear Google Drive credentials from the keyring.') from exc

    meta.has_credentials = False
    meta.updated_at = None
    _persist_auth_meta(meta, persist=persist)
    LOGGER.info('Cleared Google Drive credentials (id=%s)', credential_id)
    return meta


def _cleanup_flows() -> None:
    cutoff = time.time() - FLOW_EXPIRY_SECONDS
    with _FLOW_LOCK:
        stale_keys = [state for state, (_, created) in _PENDING_FLOWS.items() if created < cutoff]
        for state in stale_keys:
            _PENDING_FLOWS.pop(state, None)


def _build_flow(redirect_uri: str) -> Flow:
    provider = _provider_config()
    client_cfg = provider.get('client')
    if not isinstance(client_cfg, dict) or not client_cfg:
        raise DriveConfigError('Google Drive client configuration has not been provided yet.')

    try:
        flow = Flow.from_client_config(client_cfg, scopes=list(_get_auth_meta().scopes or SCOPES))
    except Exception as exc:  # noqa: BLE001
        raise DriveConfigError('Invalid Google Drive OAuth client configuration.') from exc

    flow.redirect_uri = redirect_uri
    return flow


def start_authorization_flow(redirect_uri: str, *, prompt: str = 'consent') -> Dict[str, Any]:
    _cleanup_flows()
    flow = _build_flow(redirect_uri)
    try:
        auth_url, state = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt=prompt,
        )
    except Exception as exc:  # noqa: BLE001
        raise DriveConfigError('Unable to start Google Drive authorization flow.') from exc

    with _FLOW_LOCK:
        _PENDING_FLOWS[state] = (flow, time.time())

    return {
        'authorization_url': auth_url,
        'state': state,
        'scopes': list(flow.scopes),
    }


def complete_authorization_flow(state: str, code: str) -> DriveAuthMeta:
    if not state or not code:
        raise DriveCredentialError('Authorization state and code are required.')

    _cleanup_flows()
    with _FLOW_LOCK:
        entry = _PENDING_FLOWS.pop(state, None)

    if entry is None:
        raise DriveCredentialError('Authorization state is invalid or has expired. Start the flow again.')

    flow, _created = entry
    try:
        flow.fetch_token(code=code)
    except Exception as exc:  # noqa: BLE001
        raise DriveCredentialError('Failed to exchange authorization code for Google Drive tokens.') from exc

    credentials = flow.credentials
    return store_credentials(credentials)


def build_drive_service(credentials: Optional[Credentials] = None):
    creds = credentials or load_credentials()
    try:
        return build('drive', 'v3', credentials=creds, cache_discovery=False)
    except HttpError as exc:  # pragma: no cover - network failure path
        raise DriveApiError('Unable to create Google Drive service client.') from exc


def _default_media_query() -> str:
    mime_terms = [f"mimeType='{mime}'" for mime in MEDIA_MIME_TYPES]
    mime_clause = ' or '.join(mime_terms)
    return f'({mime_clause}) and trashed = false'


def list_media_files(
    *,
    page_size: int = 100,
    page_token: Optional[str] = None,
    folder_id: Optional[str] = None,
    query: Optional[str] = None,
    order_by: str = 'modifiedTime desc',
) -> Dict[str, Any]:
    if page_size < 1:
        page_size = 1
    elif page_size > 1000:
        page_size = 1000

    q_parts: List[str] = [_default_media_query()]
    if folder_id:
        q_parts.append(f"'{folder_id}' in parents")
    if query:
        q_parts.append(f'({query})')
    effective_query = ' and '.join(q_parts)

    service = build_drive_service()
    try:
        response = service.files().list(
            q=effective_query,
            pageSize=page_size,
            pageToken=page_token,
            orderBy=order_by,
            fields=f'files({FILE_FIELDS}),nextPageToken',
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
            spaces='drive',
        ).execute()
    except HttpError as exc:
        raise DriveApiError('Google Drive API request failed while listing files.') from exc

    files = response.get('files', []) if isinstance(response, dict) else []
    next_token = response.get('nextPageToken') if isinstance(response, dict) else None
    return {
        'files': files,
        'next_page_token': next_token,
        'query': effective_query,
    }


def get_file_metadata(file_id: str, fields: Optional[str] = None) -> Dict[str, Any]:
    if not file_id:
        raise DriveApiError('A Google Drive file ID must be supplied.')

    service = build_drive_service()
    field_list = fields or (FILE_FIELDS + ',sha1Checksum,etag')
    try:
        metadata = service.files().get(
            fileId=file_id,
            fields=field_list,
            supportsAllDrives=True,
        ).execute()
    except HttpError as exc:
        raise DriveApiError('Failed to retrieve Google Drive file metadata.') from exc

    if not isinstance(metadata, dict):
        raise DriveApiError('Google Drive returned an unexpected metadata payload.')
    return metadata


def _cache_settings() -> Dict[str, Any]:
    provider = _provider_config()
    cache_cfg = provider.get('cache')
    return cache_cfg if isinstance(cache_cfg, dict) else {}


def cache_enabled_by_default() -> bool:
    cache_cfg = _cache_settings()
    return bool(cache_cfg.get('default'))


def _cache_directory() -> str:
    cache_cfg = _cache_settings()
    directory = cache_cfg.get('directory') if isinstance(cache_cfg, dict) else None
    if directory:
        base = os.path.abspath(os.path.expanduser(str(directory)))
    else:
        base = os.path.join(config.config_path(), 'drive-cache')
    os.makedirs(base, exist_ok=True)
    return base


def _cache_max_age_hours() -> int:
    cache_cfg = _cache_settings()
    try:
        return int(cache_cfg.get('max_age_hours', 168) or 168)
    except (TypeError, ValueError):
        return 168


def _guess_extension(metadata: Dict[str, Any]) -> str:
    mime_type = metadata.get('mimeType') if isinstance(metadata, dict) else None
    name = metadata.get('name') if isinstance(metadata, dict) else None
    if isinstance(name, str):
        _, ext = os.path.splitext(name)
        if ext:
            return ext.lower()
    if mime_type == 'image/gif':
        return '.gif'
    if mime_type == 'image/png':
        return '.png'
    if mime_type == 'image/jpeg':
        return '.jpg'
    if mime_type == 'image/webp':
        return '.webp'
    if mime_type == 'video/mp4':
        return '.mp4'
    if mime_type == 'video/webm':
        return '.webm'
    if mime_type == 'video/quicktime':
        return '.mov'
    return '.bin'


def _cache_metadata_path(data_path: str) -> str:
    return data_path + '.json'


def _load_cached_metadata(data_path: str) -> Optional[Dict[str, Any]]:
    meta_path = _cache_metadata_path(data_path)
    try:
        with open(meta_path, 'r', encoding='utf-8') as handle:
            return json.load(handle)
    except FileNotFoundError:
        return None
    except json.JSONDecodeError:
        LOGGER.warning('Cached Google Drive metadata %s is corrupted; ignoring.', meta_path)
        return None


def _write_cached_metadata(data_path: str, metadata: Dict[str, Any]) -> None:
    meta_path = _cache_metadata_path(data_path)
    temp_fd, temp_path = tempfile.mkstemp(prefix='drive-meta-', suffix='.json')
    try:
        with os.fdopen(temp_fd, 'w', encoding='utf-8') as handle:
            json.dump(metadata, handle, indent=2, separators=(',', ': '))
        os.replace(temp_path, meta_path)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def _is_cache_valid(
    data_path: str,
    *,
    cached_meta: Optional[Dict[str, Any]],
    fresh_meta: Optional[Dict[str, Any]],
    max_age_hours: int,
) -> bool:
    if not os.path.isfile(data_path):
        return False

    if cached_meta and fresh_meta:
        cached_mod = cached_meta.get('modifiedTime')
        fresh_mod = fresh_meta.get('modifiedTime')
        if cached_mod and fresh_mod and cached_mod != fresh_mod:
            return False

    if max_age_hours > 0:
        age_seconds = time.time() - os.path.getmtime(data_path)
        if age_seconds > max_age_hours * 3600:
            return False

    return True


def _download_drive_file(file_id: str, destination_path: str, *, chunk_size: int = 1_048_576) -> None:
    service = build_drive_service()
    request = service.files().get_media(fileId=file_id, supportsAllDrives=True)
    temp_fd, temp_path = tempfile.mkstemp(prefix='drive-download-', suffix='.tmp')
    try:
        with os.fdopen(temp_fd, 'wb') as handle:
            downloader = MediaIoBaseDownload(handle, request, chunksize=chunk_size)
            done = False
            while not done:
                _status, done = downloader.next_chunk()
        os.replace(temp_path, destination_path)
    except HttpError as exc:
        raise DriveApiError('Failed to download Google Drive file content.') from exc
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def ensure_local_copy(
    file_id: str,
    *,
    metadata: Optional[Dict[str, Any]] = None,
    use_cache: Optional[bool] = None,
    chunk_size: int = 1_048_576,
) -> str:
    if not file_id:
        raise DriveApiError('A Google Drive file ID must be provided.')

    meta = metadata or get_file_metadata(file_id)
    do_cache = cache_enabled_by_default() if use_cache is None else bool(use_cache)

    if not do_cache:
        temp_fd, temp_path = tempfile.mkstemp(prefix='drive-inline-', suffix=_guess_extension(meta))
        os.close(temp_fd)
        _download_drive_file(file_id, temp_path, chunk_size=chunk_size)
        return temp_path

    cache_dir = _cache_directory()
    extension = _guess_extension(meta)
    target_path = os.path.join(cache_dir, f'{file_id}{extension}')
    cached_meta = _load_cached_metadata(target_path)
    max_age = _cache_max_age_hours()

    if _is_cache_valid(target_path, cached_meta=cached_meta, fresh_meta=meta, max_age_hours=max_age):
        return target_path

    _download_drive_file(file_id, target_path, chunk_size=chunk_size)
    _write_cached_metadata(target_path, meta)
    return target_path


__all__ = [
    'DriveApiError',
    'DriveConfigError',
    'DriveCredentialError',
    'DriveAuthMeta',
    'build_drive_service',
    'cache_enabled_by_default',
    'clear_credentials',
    'complete_authorization_flow',
    'ensure_local_copy',
    'get_file_metadata',
    'list_media_files',
    'load_credentials',
    'public_auth_state',
    'public_client_state',
    'public_provider_state',
    'start_authorization_flow',
    'store_credentials',
]
