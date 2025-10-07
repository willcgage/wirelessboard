"""Helpers for securely storing and retrieving PCO credentials.

The credentials are persisted in the host operating system keyring. The
application configuration stores only non-sensitive metadata (credential ID,
digest, and salt) so `config.json` can remain portable without exposing the
actual token/secret pair.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import secrets
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional, Tuple, cast

import keyring  # type: ignore[import]
from keyring import errors as keyring_errors  # type: ignore[import]

LOGGER = logging.getLogger('micboard.pco')

_SERVICE_NAME = "wirelessboard:pco"
_DEFAULT_CREDENTIAL_ID = "default"
_DIGEST_VERSION = 1


class CredentialError(Exception):
    """Raised when credentials cannot be loaded or stored."""


@dataclass
class CredentialMeta:
    """Serializable metadata stored alongside the config."""

    credential_id: str = _DEFAULT_CREDENTIAL_ID
    salt_b64: Optional[str] = None
    token_digest: Optional[str] = None
    version: int = _DIGEST_VERSION

    def to_config(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "credential_id": self.credential_id,
            "version": self.version,
        }
        if self.salt_b64:
            data["salt"] = self.salt_b64
        if self.token_digest:
            data["token_digest"] = self.token_digest
        return data

    @classmethod
    def from_config(cls, data: Optional[Any]) -> "CredentialMeta":
        if not isinstance(data, dict):
            return cls()
        credential_id = str(data.get("credential_id") or _DEFAULT_CREDENTIAL_ID)
        salt_val = data.get("salt")
        digest_val = data.get("token_digest")
        version_val = data.get("version")
        salt: Optional[str] = str(salt_val) if isinstance(salt_val, str) else None
        digest: Optional[str] = str(digest_val) if isinstance(digest_val, str) else None
        version = int(version_val) if isinstance(version_val, (int, str)) and str(version_val).isdigit() else _DIGEST_VERSION
        return cls(credential_id=credential_id, salt_b64=salt, token_digest=digest, version=version)


def _serialize_payload(token: str, secret: str) -> str:
    return json.dumps({"token": token, "secret": secret}, separators=(",", ":"))


def _deserialize_payload(payload: str) -> Tuple[str, str]:
    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise CredentialError("Stored credential payload is corrupted; re-enter the PCO PAT.") from exc
    token = data.get("token")
    secret = data.get("secret")
    if not token or not secret:
        raise CredentialError("Stored credential payload is incomplete; re-enter the PCO PAT.")
    return str(token), str(secret)


def _persist_in_keyring(credential_id: str, token: str, secret: str) -> None:
    payload = _serialize_payload(token, secret)
    try:
        keyring.set_password(_SERVICE_NAME, credential_id, payload)
    except keyring_errors.KeyringError as exc:
        raise CredentialError("Unable to write credentials to the system keyring.") from exc


def _load_from_keyring(credential_id: str) -> Tuple[str, str]:
    try:
        payload = keyring.get_password(_SERVICE_NAME, credential_id)
    except keyring_errors.KeyringError as exc:
        raise CredentialError("Unable to access the system keyring.") from exc

    if payload is None:
        raise CredentialError("PCO credentials are not stored in the keyring; re-enter them.")
    return _deserialize_payload(payload)


def _compute_digest(token: str, secret: str, salt_b64: str) -> str:
    try:
        salt_bytes = base64.b64decode(salt_b64.encode("ascii"), validate=True)
    except Exception as exc:  # noqa: BLE001
        raise CredentialError("Stored credential salt is invalid; re-enter the PCO PAT.") from exc
    digest = hashlib.sha256()
    digest.update(salt_bytes)
    digest.update(b"\0")
    digest.update(token.encode("utf-8"))
    digest.update(b"\0")
    digest.update(secret.encode("utf-8"))
    return digest.hexdigest()


def _generate_salt() -> str:
    return base64.b64encode(secrets.token_bytes(24)).decode("ascii")


def ensure_credentials(
    pco_cfg: Dict[str, Any],
    *,
    save_callback: Optional[Callable[[], None]] = None,
) -> Tuple[str, str, CredentialMeta]:
    """Ensure credentials exist for *pco_cfg* and return them along with metadata.

    If the configuration still contains plaintext `token`/`secret`, they are migrated
    into the system keyring and the configuration dict is updated in-place to store
    only metadata. When migration occurs, *save_callback* is invoked (if provided)
    so the mutated configuration can be persisted back to disk.
    """

    if not isinstance(pco_cfg, dict):
        raise CredentialError("Invalid PCO configuration block.")

    raw_auth = cast(Optional[Dict[str, Any]], pco_cfg.get("auth"))
    if not isinstance(raw_auth, dict):
        raise CredentialError("Missing PCO auth configuration.")

    meta = CredentialMeta.from_config(raw_auth)
    plaintext_token = raw_auth.get("token") if raw_auth else None
    plaintext_secret = raw_auth.get("secret") if raw_auth else None

    if plaintext_token or plaintext_secret:
        if not plaintext_token or not plaintext_secret:
            raise CredentialError("PCO token and secret must both be provided.")
        meta.salt_b64 = _generate_salt()
        meta.token_digest = _compute_digest(str(plaintext_token), str(plaintext_secret), meta.salt_b64)
        meta.version = _DIGEST_VERSION
        _persist_in_keyring(meta.credential_id, str(plaintext_token), str(plaintext_secret))
        sanitized_auth = meta.to_config()
        pco_cfg["auth"] = sanitized_auth
        LOGGER.info("Migrated PCO credentials into the system keyring (id=%s)", meta.credential_id)
        if save_callback:
            save_callback()
    else:
        pco_cfg["auth"] = meta.to_config()

    token, secret = _load_from_keyring(meta.credential_id)

    if meta.salt_b64 and meta.token_digest:
        calculated = _compute_digest(token, secret, meta.salt_b64)
        if calculated != meta.token_digest:
            raise CredentialError(
                "Stored PCO credentials do not match the saved digest; re-enter the PAT token and secret.",
            )

    return token, secret, meta


def apply_auth_update(
    pco_cfg: Dict[str, Any],
    new_auth_payload: Optional[Dict[str, Any]],
    *,
    save_callback: Optional[Callable[[], None]] = None,
) -> CredentialMeta:
    """Update *pco_cfg* with a new auth payload from the API/UI layer.

    The payload can optionally contain fresh `token`/`secret` fields; when present,
    they are stored in the keyring and not persisted in the configuration dict.
    """

    if not isinstance(pco_cfg, dict):
        raise CredentialError("Invalid PCO configuration block.")

    existing_meta = CredentialMeta.from_config(pco_cfg.get("auth"))
    payload: Dict[str, Any] = new_auth_payload or {}

    token = str(payload.get("token") or "").strip()
    secret = str(payload.get("secret") or "").strip()

    if token or secret:
        if not token or not secret:
            raise CredentialError("Both PCO token and secret must be supplied together.")
        meta = CredentialMeta(credential_id=existing_meta.credential_id)
        meta.salt_b64 = _generate_salt()
        meta.token_digest = _compute_digest(token, secret, meta.salt_b64)
        _persist_in_keyring(meta.credential_id, token, secret)
        if save_callback:
            save_callback()
        pco_cfg["auth"] = meta.to_config()
        return meta

    if not existing_meta.token_digest:
        raise CredentialError("PCO credentials have not been configured yet.")

    # No changes; ensure metadata remains in sync.
    pco_cfg["auth"] = existing_meta.to_config()
    return existing_meta


def public_auth_view(pco_cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Return a sanitized auth structure suitable for serialization to the UI."""

    meta = CredentialMeta.from_config(pco_cfg.get("auth"))
    return {
        "credential_id": meta.credential_id,
        "has_credentials": bool(meta.token_digest),
        "digest_version": meta.version,
    }


__all__ = [
    "CredentialError",
    "CredentialMeta",
    "apply_auth_update",
    "ensure_credentials",
    "public_auth_view",
]
