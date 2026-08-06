import argparse
import copy
import ipaddress
import json
import logging
import logging.config
import os
import sys
import threading
import time
import uuid
from shutil import copyfile
from typing import Any, Dict, List, Optional, Tuple

import shure
import offline

from logging_utils import (
    LOG_FILENAME,
    build_logging_config,
    default_settings,
    normalize_settings,
)

from pco_credentials import (
    CredentialError,
    CredentialMeta,
    apply_auth_update,
    public_auth_view,
)

APPNAME = 'wirelessboard'
LEGACY_APPNAME = 'micboard'

CONFIG_FILE_NAME = 'config.json'
DEFAULT_PORT = 8058

logger = logging.getLogger('micboard.core')

config_tree = {}

# Set when config.json loaded but did not give us a usable tree. Everything that
# writes the config back *without the operator asking* has to consult this:
# after a degraded load the tree in memory is mostly defaults, so saving it
# replaces the one damaged-but-possibly-recoverable copy of their settings with
# an empty board. An explicit save from the interface still writes, and clears
# this -- that one is the operator's decision, not ours.
config_load_degraded = False

gif_dir = ''

group_update_list = []

args = {}

DEFAULT_DISCOVERY_SETTINGS = {
    'auto': True,
    'subnets': [],
    'scan_interval': 60,
    'timeout_ms': 750,
}

DISCOVERY_MIN_INTERVAL = 15
DISCOVERY_MAX_INTERVAL = 900
DISCOVERY_MIN_TIMEOUT = 100
DISCOVERY_MAX_TIMEOUT = 5000

GOOGLE_DRIVE_SCOPE_READONLY = 'https://www.googleapis.com/auth/drive.readonly'

DEFAULT_CLOUD_SETTINGS = {
    'providers': {
        'google_drive': {
            'enabled': False,
            'client': {},
            'auth': {
                'credential_id': 'google-drive-default',
                'has_credentials': False,
                'scopes': [GOOGLE_DRIVE_SCOPE_READONLY],
                'updated_at': None,
            },
            'cache': {
                'default': False,
                'directory': None,
                'max_age_hours': 168,
            },
        },
    },
    'slot_sources': {},
}

BACKGROUND_MODES = ('NONE', 'IMG', 'MP4')
DEFAULT_BACKGROUND_SETTINGS = {
    'mode': 'NONE',
}


def ensure_background_defaults() -> Dict[str, Any]:
    defaults = config_tree.get('background_defaults')
    if not isinstance(defaults, dict):
        defaults = {}

    raw_mode = defaults.get('mode')
    mode = str(raw_mode).strip().upper() if isinstance(raw_mode, str) else None
    if not mode or mode not in BACKGROUND_MODES:
        mode = DEFAULT_BACKGROUND_SETTINGS['mode']

    defaults['mode'] = mode
    config_tree['background_defaults'] = defaults
    return defaults


def get_background_defaults() -> Dict[str, Any]:
    return copy.deepcopy(ensure_background_defaults())


def get_background_default_mode() -> str:
    defaults = ensure_background_defaults()
    return defaults.get('mode', DEFAULT_BACKGROUND_SETTINGS['mode'])


def _normalize_background_mode(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    mode = str(value).strip().upper()
    if not mode:
        return None
    if mode not in BACKGROUND_MODES:
        raise ValueError('default_mode must be one of: ' + ', '.join(BACKGROUND_MODES))
    return mode


def _normalized_subnet_list(candidates) -> List[str]:
    normalized: List[str] = []
    seen = set()
    if not candidates:
        return normalized

    for entry in candidates:
        if entry is None:
            continue
        candidate = str(entry).strip()
        if not candidate:
            continue

        try:
            if '/' in candidate:
                network = ipaddress.ip_network(candidate, strict=False)
            else:
                ip_obj = ipaddress.ip_address(candidate)
                network = ipaddress.ip_network(f'{ip_obj}/32', strict=False)
        except ValueError:
            logger.warning("Invalid discovery subnet '%s' ignored", candidate)
            continue

        if network.version != 4:
            logger.warning('Ignoring non-IPv4 discovery subnet %s', candidate)
            continue

        if network.prefixlen < 16:
            logger.warning('Discovery subnet %s is too broad; minimum /16', network)
            continue

        key = str(network)
        if key in seen:
            continue
        seen.add(key)
        normalized.append(key)

    return normalized


def normalize_discovery_settings(payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    normalized = copy.deepcopy(DEFAULT_DISCOVERY_SETTINGS)
    if not isinstance(payload, dict):
        return normalized

    auto_flag = payload.get('auto')
    if isinstance(auto_flag, bool):
        normalized['auto'] = auto_flag

    subnets_field = payload.get('subnets')
    subnets: List[str] = []
    if isinstance(subnets_field, str):
        subnets = subnets_field.replace(',', '\n').splitlines()
    elif isinstance(subnets_field, list):
        subnets = subnets_field
    normalized['subnets'] = _normalized_subnet_list(subnets)

    interval = payload.get('scan_interval')
    if interval is not None:
        try:
            value = int(interval)
            if value < DISCOVERY_MIN_INTERVAL:
                value = DISCOVERY_MIN_INTERVAL
            elif value > DISCOVERY_MAX_INTERVAL:
                value = DISCOVERY_MAX_INTERVAL
            normalized['scan_interval'] = value
        except (TypeError, ValueError):
            logger.warning("Invalid discovery scan interval '%s'", interval)

    timeout_field = payload.get('timeout_ms')
    if timeout_field is not None:
        try:
            timeout_value = int(timeout_field)
            if timeout_value < DISCOVERY_MIN_TIMEOUT:
                timeout_value = DISCOVERY_MIN_TIMEOUT
            elif timeout_value > DISCOVERY_MAX_TIMEOUT:
                timeout_value = DISCOVERY_MAX_TIMEOUT
            normalized['timeout_ms'] = timeout_value
        except (TypeError, ValueError):
            logger.warning("Invalid discovery timeout '%s'", timeout_field)

    return normalized


def ensure_discovery_defaults() -> Dict[str, Any]:
    discovery_cfg = config_tree.get('discovery')
    normalized = normalize_discovery_settings(discovery_cfg)
    config_tree['discovery'] = normalized
    return copy.deepcopy(normalized)


def get_discovery_settings() -> Dict[str, Any]:
    return copy.deepcopy(ensure_discovery_defaults())


def update_discovery_settings(payload: Optional[Dict[str, Any]], *, persist: bool = True) -> Dict[str, Any]:
    normalized = normalize_discovery_settings(payload)
    config_tree['discovery'] = normalized
    if persist:
        save_current_config()
    logger.info(
        'Discovery settings updated',
        extra={'context': {
            'auto': normalized['auto'],
            'subnet_count': len(normalized['subnets']),
            'scan_interval': normalized['scan_interval'],
            'timeout_ms': normalized['timeout_ms'],
        }}
    )
    return copy.deepcopy(normalized)

def uuid_init():
    if 'uuid' not in config_tree:
        micboard_uuid = str(uuid.uuid4())
        config_tree['uuid'] = micboard_uuid
        # Held in memory only when the file did not load cleanly. A config
        # missing its uuid is also what a damaged one looks like, so saving here
        # would write the defaults assembled during load straight over the
        # operator's file -- the same overwrite the migration write-back below
        # is held back from. A fresh uuid next start costs nothing.
        if config_load_degraded:
            logger.warning(
                'Not persisting the generated UUID: %s did not load cleanly.',
                config_file())
            return
        logger.info('Adding UUID: %s to config.conf', micboard_uuid)
        save_current_config()


def logging_init():
    configure_logging(default_settings())


def web_port():
    server_port = args.get('server_port') if isinstance(args, dict) else None
    if server_port is not None:
        return int(server_port)

    elif 'WIRELESSBOARD_PORT' in os.environ:
        return int(os.environ['WIRELESSBOARD_PORT'])
    elif 'MICBOARD_PORT' in os.environ:
        logger.info('Using legacy MICBOARD_PORT environment variable')
        return int(os.environ['MICBOARD_PORT'])

    port = config_tree.get('port', DEFAULT_PORT)
    try:
        return int(port)
    except (TypeError, ValueError):
        logger.warning("Invalid port value '%s' in configuration, falling back to %s", port, DEFAULT_PORT)
        return DEFAULT_PORT


def os_config_path():
    path = os.getcwd()
    if sys.platform.startswith('linux'):
        path = os.getenv('XDG_DATA_HOME', os.path.expanduser("~/.local/share"))
    elif sys.platform == 'win32':
        path = os.getenv('LOCALAPPDATA')
    elif sys.platform == 'darwin':
        path = os.path.expanduser('~/Library/Application Support/')
    return path


def config_path(folder=None):
    config_path_arg = args.get('config_path') if isinstance(args, dict) else None
    if config_path_arg is not None:
        expanded = os.path.expanduser(config_path_arg)
        if os.path.exists(expanded):
            path = expanded
        else:
            logger.warning("Invalid config path")
            sys.exit()

    else:
        base_path = os_config_path()
        preferred_path = os.path.join(base_path, APPNAME)
        legacy_path = os.path.join(base_path, LEGACY_APPNAME)

        if os.path.exists(preferred_path):
            path = preferred_path
        elif os.path.exists(legacy_path):
            logger.info('Reusing legacy configuration directory at %s', legacy_path)
            path = legacy_path
        else:
            os.makedirs(preferred_path)
            path = preferred_path

    if folder:
        return os.path.join(path, folder)
    return path

def logs_dir():
    path = config_path('logs')
    os.makedirs(path, exist_ok=True)
    return path


def log_file():
    return os.path.join(logs_dir(), LOG_FILENAME)


def configure_logging(settings=None):
    normalized = normalize_settings(settings or {})
    logfile = log_file()
    os.makedirs(os.path.dirname(logfile), exist_ok=True)
    config_dict = build_logging_config(normalized, logfile)
    logging.config.dictConfig(config_dict)
    return normalized


def ensure_logging_defaults():
    normalized = normalize_settings(config_tree.get('logging') or {})
    config_tree['logging'] = normalized
    return normalized


APPLIED_MIGRATIONS_KEY = 'migrations'
PCO_FALLBACK_MIGRATION = 'pco_position_number_fallback_off'


def migration_applied(name: str) -> bool:
    applied = config_tree.get(APPLIED_MIGRATIONS_KEY)
    return bool(isinstance(applied, dict) and applied.get(name))


def mark_migration_applied(name: str) -> None:
    """Record a migration at the *top level* of the tree, deliberately.

    ``update_pco_config`` replaces whole sub-objects from the interface's
    payload, so a marker kept inside ``pco.mapping`` would be wiped by the next
    save and the migration would run again -- undoing a setting the operator had
    since turned back on.
    """
    applied = config_tree.get(APPLIED_MIGRATIONS_KEY)
    if not isinstance(applied, dict):
        applied = {}
        config_tree[APPLIED_MIGRATIONS_KEY] = applied
    applied[name] = True


def migrate_pco_number_fallback() -> bool:
    """Turn off a ``position_number_fallback`` that nobody chose. Runs once.

    The PCO panel wrote this key on every save with its checkbox defaulting to
    checked, so installations carry an explicit ``true`` that was never a
    decision. Left alone it matches positions on their trailing number, and once
    more than one team is scheduled "Vocal 1", "Guitar 1" and "Host 1" all claim
    the same slot -- roughly half the automatic assignments land on the wrong
    channel.

    Because the value is explicit, changing the default could not reach these
    installations. This clears it exactly once and records that it did, so an
    operator who deliberately turns it back on -- correct for a single-team
    plan -- keeps it through every later restart.

    Returns True when the tree changed and needs saving.
    """
    if migration_applied(PCO_FALLBACK_MIGRATION):
        return False

    pco_cfg = config_tree.get('pco')
    mapping = pco_cfg.get('mapping') if isinstance(pco_cfg, dict) else None
    if not isinstance(mapping, dict):
        # Nothing to correct, but record it so an install that adds PCO later
        # is not retroactively overridden.
        mark_migration_applied(PCO_FALLBACK_MIGRATION)
        return True

    mark_migration_applied(PCO_FALLBACK_MIGRATION)
    if mapping.get('position_number_fallback') is not True:
        return True

    mapping['position_number_fallback'] = False
    logger.info(
        'Turned off pco.mapping.position_number_fallback: it matches on the '
        'trailing number alone and misassigns whenever more than one team is '
        'scheduled. Re-enable it in the PCO panel if only one team ever is.')
    return True


def ensure_cloud_defaults() -> Dict[str, Any]:
    cloud_cfg = config_tree.get('cloud')
    if not isinstance(cloud_cfg, dict):
        config_tree['cloud'] = copy.deepcopy(DEFAULT_CLOUD_SETTINGS)
        return copy.deepcopy(config_tree['cloud'])

    providers = cloud_cfg.setdefault('providers', {})
    if not isinstance(providers, dict):
        cloud_cfg['providers'] = {}
        providers = cloud_cfg['providers']

    provider = providers.get('google_drive')
    if not isinstance(provider, dict):
        providers['google_drive'] = copy.deepcopy(DEFAULT_CLOUD_SETTINGS['providers']['google_drive'])
        provider = providers['google_drive']

    provider.setdefault('enabled', False)

    client_cfg = provider.get('client')
    if not isinstance(client_cfg, dict):
        provider['client'] = {}

    auth_cfg = provider.get('auth')
    if not isinstance(auth_cfg, dict):
        provider['auth'] = copy.deepcopy(DEFAULT_CLOUD_SETTINGS['providers']['google_drive']['auth'])
    else:
        auth_cfg.setdefault('credential_id', DEFAULT_CLOUD_SETTINGS['providers']['google_drive']['auth']['credential_id'])
        auth_cfg.setdefault('has_credentials', False)
        scopes = auth_cfg.get('scopes')
        if not isinstance(scopes, list):
            auth_cfg['scopes'] = copy.deepcopy(DEFAULT_CLOUD_SETTINGS['providers']['google_drive']['auth']['scopes'])
        auth_cfg.setdefault('updated_at', None)

    cache_cfg = provider.get('cache')
    if not isinstance(cache_cfg, dict):
        provider['cache'] = copy.deepcopy(DEFAULT_CLOUD_SETTINGS['providers']['google_drive']['cache'])
    else:
        cache_cfg.setdefault('default', False)
        cache_cfg.setdefault('directory', None)
        try:
            cache_cfg['max_age_hours'] = int(cache_cfg.get('max_age_hours', 168) or 168)
        except (TypeError, ValueError):
            cache_cfg['max_age_hours'] = 168
        if cache_cfg['max_age_hours'] < 1:
            cache_cfg['max_age_hours'] = 1

    slot_sources = cloud_cfg.get('slot_sources')
    if not isinstance(slot_sources, dict):
        cloud_cfg['slot_sources'] = {}

    return copy.deepcopy(cloud_cfg)


def get_logging_settings() -> Dict[str, Any]:
    ensure_logging_defaults()
    return copy.deepcopy(config_tree.get('logging', {}))


def update_logging_settings(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError('Invalid logging configuration payload')

    current = ensure_logging_defaults()
    merged = copy.deepcopy(current)

    for key in ('level', 'console_level', 'max_bytes', 'backups'):
        if key in payload:
            merged[key] = payload[key]

    if 'levels' in payload:
        levels_value = payload['levels']
        if levels_value is None:
            merged['levels'] = {}
        elif isinstance(levels_value, dict):
            merged['levels'] = {str(k): v for k, v in levels_value.items()}
        else:
            raise ValueError('logging.levels must be an object')

    normalized = normalize_settings(merged)
    config_tree['logging'] = normalized
    configure_logging(normalized)
    save_current_config()
    logger.info('Logging configuration updated', extra={'context': {'level': normalized['level'], 'console_level': normalized['console_level']}})
    return copy.deepcopy(normalized)


def get_cloud_settings() -> Dict[str, Any]:
    ensure_cloud_defaults()
    return copy.deepcopy(config_tree.get('cloud', {}))


def get_google_drive_settings() -> Dict[str, Any]:
    ensure_cloud_defaults()
    provider = config_tree['cloud']['providers']['google_drive']
    return copy.deepcopy(provider)


def update_google_drive_settings(payload: Dict[str, Any]) -> Dict[str, Any]:
    ensure_cloud_defaults()
    if not isinstance(payload, dict):
        raise ValueError('Invalid Google Drive configuration payload')

    provider = config_tree['cloud']['providers']['google_drive']

    if 'enabled' in payload:
        provider['enabled'] = bool(payload['enabled'])

    if 'client' in payload:
        client_payload = payload['client']
        if client_payload is None:
            provider['client'] = {}
        elif isinstance(client_payload, dict):
            provider['client'] = copy.deepcopy(client_payload)
        else:
            raise ValueError('google_drive.client must be an object')

    if 'cache' in payload:
        cache_payload = payload['cache']
        if cache_payload is None:
            provider['cache'] = copy.deepcopy(DEFAULT_CLOUD_SETTINGS['providers']['google_drive']['cache'])
        elif isinstance(cache_payload, dict):
            cache_cfg = provider.setdefault('cache', {})
            if not isinstance(cache_cfg, dict):
                cache_cfg = {}
            default_flag = cache_payload.get('default')
            if default_flag is not None:
                cache_cfg['default'] = bool(default_flag)
            if 'directory' in cache_payload:
                directory_val = cache_payload.get('directory')
                if directory_val:
                    cache_cfg['directory'] = os.path.abspath(os.path.expanduser(str(directory_val).strip()))
                else:
                    cache_cfg['directory'] = None
            if 'max_age_hours' in cache_payload:
                max_age_val = cache_payload.get('max_age_hours')
                if max_age_val is None or max_age_val == '':
                    raise ValueError('google_drive.cache.max_age_hours must be specified')
                try:
                    max_age_int = int(str(max_age_val))
                except (TypeError, ValueError):
                    raise ValueError('google_drive.cache.max_age_hours must be an integer')
                if max_age_int < 1:
                    max_age_int = 1
                cache_cfg['max_age_hours'] = max_age_int
            provider['cache'] = cache_cfg
        else:
            raise ValueError('google_drive.cache must be an object or null')

    if 'auth' in payload:
        auth_payload = payload['auth']
        if auth_payload is None:
            provider['auth'] = copy.deepcopy(DEFAULT_CLOUD_SETTINGS['providers']['google_drive']['auth'])
        elif isinstance(auth_payload, dict):
            auth_cfg = provider.setdefault('auth', {})
            if not isinstance(auth_cfg, dict):
                auth_cfg = {}
            credential_id = auth_payload.get('credential_id')
            if credential_id:
                auth_cfg['credential_id'] = str(credential_id)
            if 'has_credentials' in auth_payload:
                auth_cfg['has_credentials'] = bool(auth_payload['has_credentials'])
            scopes_payload = auth_payload.get('scopes')
            if isinstance(scopes_payload, (list, tuple)):
                auth_cfg['scopes'] = [str(scope) for scope in scopes_payload if scope]
            elif scopes_payload is None:
                auth_cfg['scopes'] = copy.deepcopy(DEFAULT_CLOUD_SETTINGS['providers']['google_drive']['auth']['scopes'])
            if 'updated_at' in auth_payload:
                updated_value = auth_payload['updated_at']
                auth_cfg['updated_at'] = str(updated_value) if updated_value else None
            provider['auth'] = auth_cfg
        else:
            raise ValueError('google_drive.auth must be an object or null')

    save_current_config()
    return copy.deepcopy(provider)


def update_google_drive_auth_metadata(metadata: Dict[str, Any], *, persist: bool = True) -> Dict[str, Any]:
    ensure_cloud_defaults()
    if not isinstance(metadata, dict):
        raise ValueError('Invalid Google Drive auth metadata payload')

    provider = config_tree['cloud']['providers']['google_drive']
    provider['auth'] = copy.deepcopy(metadata)
    if persist:
        save_current_config()
    return copy.deepcopy(provider['auth'])


def get_slot_media_sources() -> Dict[str, Any]:
    ensure_cloud_defaults()
    return copy.deepcopy(config_tree['cloud'].get('slot_sources', {}))


def update_slot_media_sources(payload: Dict[str, Any], *, persist: bool = True) -> Dict[str, Any]:
    ensure_cloud_defaults()
    if not isinstance(payload, dict):
        raise ValueError('slot source payload must be an object')
    config_tree['cloud']['slot_sources'] = copy.deepcopy(payload)
    if persist:
        save_current_config()
    return copy.deepcopy(config_tree['cloud']['slot_sources'])

# https://stackoverflow.com/questions/404744/determining-application-path-in-a-python-exe-generated-by-pyinstaller
def app_dir(folder=None):
    if getattr(sys, 'frozen', False):
        application_path = getattr(sys, '_MEIPASS', None)
        if application_path is not None:
            if folder is not None:
                return os.path.join(application_path, folder)
            else:
                return application_path
        else:
            return None

    if __file__:
        application_path = os.path.dirname(__file__)
    else:
        application_path = os.getcwd()

    if folder is not None:
        return os.path.join(os.path.dirname(application_path), folder)
    else:
        return os.path.dirname(application_path)


def default_gif_dir():
    path = config_path('backgrounds')
    if not os.path.exists(path):
        os.makedirs(path)
    print("GIFCHECK!")
    return path

def get_gif_dir():
    background_directory = args.get('background_directory') if isinstance(args, dict) else None
    if background_directory not in (None, ''):
        expanded = os.path.expanduser(background_directory)
        if os.path.exists(expanded):
            return expanded
        else:
            logger.warning("invalid config path")
            sys.exit()

    background_folder = config_tree.get('background-folder')
    if isinstance(background_folder, str) and background_folder:
        return os.path.expanduser(background_folder)
    return default_gif_dir()


def default_background_path() -> str:
    return os.path.abspath(os.path.join(config_path(), 'backgrounds'))


def get_background_directory_state() -> Dict[str, Any]:
    default_path = default_background_path()
    background_directory = args.get('background_directory') if isinstance(args, dict) else None
    if background_directory in (None, ''):
        background_directory = None

    defaults = ensure_background_defaults()
    default_mode = defaults.get('mode', DEFAULT_BACKGROUND_SETTINGS['mode'])
    supported_modes = list(BACKGROUND_MODES)

    if background_directory is not None:
        resolved = os.path.abspath(os.path.expanduser(background_directory))
        return {
            'source': 'cli',
            'resolved_path': resolved,
            'configured_path': resolved,
            'default_path': default_path,
            'cli_override': True,
            'exists': os.path.isdir(resolved),
            'default_mode': default_mode,
            'supported_modes': supported_modes,
        }

    background_folder = config_tree.get('background-folder')
    if isinstance(background_folder, str) and background_folder.strip():
        resolved = os.path.abspath(os.path.expanduser(background_folder))
        return {
            'source': 'config',
            'resolved_path': resolved,
            'configured_path': background_folder,
            'default_path': default_path,
            'cli_override': False,
            'exists': os.path.isdir(resolved),
            'default_mode': default_mode,
            'supported_modes': supported_modes,
        }

    resolved_default = os.path.abspath(default_gif_dir())
    return {
        'source': 'default',
        'resolved_path': resolved_default,
        'configured_path': None,
        'default_path': default_path,
        'cli_override': False,
        'exists': os.path.isdir(resolved_default),
        'default_mode': default_mode,
        'supported_modes': supported_modes,
    }


def set_background_directory(path: Optional[str], default_mode: Optional[str] = None) -> Dict[str, Any]:
    ensure_background_defaults()
    background_directory = args.get('background_directory') if isinstance(args, dict) else None

    if path is None:
        target = None
    elif isinstance(path, str):
        target = path.strip()
    else:
        raise ValueError('Background directory must be a string path.')

    cli_override_active = background_directory not in (None, '')

    normalized_mode = _normalize_background_mode(default_mode)
    mode_changed = False
    if default_mode is not None:
        desired_mode = normalized_mode if normalized_mode is not None else DEFAULT_BACKGROUND_SETTINGS['mode']
        if config_tree['background_defaults']['mode'] != desired_mode:
            config_tree['background_defaults']['mode'] = desired_mode
            mode_changed = True

    if cli_override_active and target not in (None, ''):
        raise RuntimeError('Background directory is controlled by a command-line override.')

    global gif_dir

    changed = mode_changed

    if not target:
        if not cli_override_active:
            if 'background-folder' in config_tree:
                config_tree.pop('background-folder', None)
                changed = True
            gif_dir = default_gif_dir()
        else:
            if background_directory:
                gif_dir = os.path.abspath(os.path.expanduser(background_directory))
        if changed:
            save_current_config()
        return get_background_directory_state()

    normalized = os.path.abspath(os.path.expanduser(target))
    try:
        os.makedirs(normalized, exist_ok=True)
    except OSError as exc:
        raise ValueError(f'Unable to create background directory: {exc}') from exc

    if config_tree.get('background-folder') != normalized:
        config_tree['background-folder'] = normalized
        changed = True
    gif_dir = normalized
    if changed:
        save_current_config()
    return get_background_directory_state()

def config_file():
    # In a frozen build app_dir() is sys._MEIPASS — a directory *inside* the
    # application bundle. Configuration must never be read or written there: on
    # macOS the bundle is code-signed and notarized, so writing into it fails
    # and would invalidate the signature, and the directory is replaced on every
    # upgrade. Only a source checkout may keep a config.json beside the project,
    # which is the portable-install behaviour this branch originally existed for.
    if not getattr(sys, 'frozen', False):
        app_config_path = app_dir(CONFIG_FILE_NAME)
        if app_config_path is not None and os.path.exists(app_config_path):
            return app_config_path

    user_config = config_path(CONFIG_FILE_NAME)
    if os.path.exists(user_config):
        return user_config

    demo_config_path = app_dir('democonfig.json')
    if demo_config_path is not None and os.path.exists(demo_config_path):
        copyfile(demo_config_path, user_config)
    return user_config

def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('-f', '--config-path', help='configuration directory')
    parser.add_argument('-p', '--server-port', help='server port')
    parser.add_argument('-b', '--background-directory', help='background directory')
    args,_ = parser.parse_known_args()

    return vars(args)


def config():
    global args
    args = parse_args()
    logging_init()
    read_json_config(config_file())
    ensure_discovery_defaults()
    ensure_cloud_defaults()
    ensure_background_defaults()
    settings = ensure_logging_defaults()
    configure_logging(settings)
    uuid_init()


    logger.info('Starting Wirelessboard %s', config_tree['wirelessboard_version'])


def config_mix(slots):
    for slot in slots:
        current = get_slot_by_number(slot['slot'])
        if current:
            # Absent means "not editing this", so the stored value stands --
            # which is what keeps a configuration save from wiping the positions
            # the PCO seed workflow writes. Present but empty means the operator
            # cleared the field, so drop it rather than storing ''.
            if 'extended_id' in slot:
                if not slot['extended_id']:
                    slot.pop('extended_id', None)
            elif 'extended_id' in current:
                slot['extended_id'] = current['extended_id']

            if 'extended_name' in slot:
                if not slot['extended_name']:
                    slot.pop('extended_name', None)
            elif 'extended_name' in current:
                slot['extended_name'] = current['extended_name']

            if 'chan_name_raw' in current:
                slot['chan_name_raw'] = current['chan_name_raw']
            elif 'chan_name_raw' in slot:
                slot.pop('chan_name_raw', None)

    return slots


_RECONFIG_LOCK = threading.Lock()


def reconfig(payload):
    """Apply a configuration change and rebuild every device.

    Runs on a worker thread, not the IOLoop -- it sleeps, and it opens a socket
    per receiver, so on the loop it froze every other request for as long as
    that took. The caller closes the websockets beforehand, because that
    touches Tornado's own objects and has to happen on the loop.

    Serialised, because moving it off the loop also removed the only thing that
    was keeping two saves apart. Every save mutates the module-global
    config_tree and then clears it, so two of them interleaving lets one thread
    clear the tree in between another's ``config_tree['slots'] = ...`` and its
    ``save_current_config()`` -- which writes ``{}`` over the operator's
    config.json. That is not a transient error: the file is destroyed, and
    every start after it fails to load. Observed on site as three concurrent
    saves and three ``KeyError: 'slots'``.
    """
    with _RECONFIG_LOCK:
        _reconfig_locked(payload)


def _reconfig_locked(payload):
    global config_load_degraded

    if isinstance(payload, dict):
        slots = payload.get('slots', [])
        discovery_payload = payload.get('discovery')
    else:
        slots = payload
        discovery_payload = None

    if discovery_payload is not None:
        normalized = normalize_discovery_settings(discovery_payload)
        config_tree['discovery'] = normalized
    else:
        ensure_discovery_defaults()

    if not isinstance(slots, list):
        logger.warning('Invalid slot payload during reconfig; expected list, got %s', type(slots))
        slots = []

    config_tree['slots'] = config_mix(slots)

    # The operator asked for this one, so it writes even after a degraded load,
    # and the file it leaves behind is a real config again.
    save_current_config()
    config_load_degraded = False

    rebuild_from_disk()


def rebuild_from_disk():
    """Drop every receiver and rebuild the board from config.json on disk.

    Shared by a save and by a recovery, so both take the identical path: the
    only difference between them is which bytes reached the file first.

    Call with _RECONFIG_LOCK held.
    """
    # Kept so a failed rebuild can put the running server back. config() below
    # reassigns config_tree from disk, and if that raises -- a config.json that
    # cannot be read is exactly when it does -- the process was left holding the
    # cleared tree, serving a board with no slots, no port and no pco block
    # until someone restarted it.
    previous_tree = copy.deepcopy(config_tree)

    config_tree.clear()
    for device in shure.NetworkDevices:
        # device.socket_disconnect()
        device.disable_metering()
        del device.channels[:]

    del shure.NetworkDevices[:]
    del offline.OfflineDevices[:]

    # Deliberate, and not safe to simply delete. socket_disconnect is commented
    # out above, so the old sockets are dropped rather than closed; this gives
    # the reader thread its ~0.2s select cycles to stop touching them and the OS
    # time to tear the connections down before the loop below dials the same
    # receivers again. Removing it risks a save that leaves receivers
    # unreachable -- during a service, which is when saves happen. Now that this
    # runs off the IOLoop the wait costs only this thread.
    time.sleep(2)

    try:
        config()
    except Exception:
        config_tree.clear()
        config_tree.update(previous_tree)
        logger.exception(
            'Could not reload configuration after saving; keeping the previously '
            'loaded settings in memory. config.json on disk may need attention.')
        raise

    for rx in shure.NetworkDevices:
        rx.socket_connect()

def get_version_number():
    package_json_path = app_dir('package.json')
    if package_json_path is None or not os.path.exists(package_json_path):
        logger.warning("package.json not found.")
        return "unknown"
    with open(package_json_path) as package:
        pkginfo = json.load(package)

    return pkginfo.get('version', 'unknown')

def read_json_config(file):
    global config_tree
    global gif_dir
    global config_load_degraded
    with open(file) as config_file:
        config_tree = json.load(config_file)

        # A config with no slots is a board with no receivers, not a reason to
        # refuse to start. This was an unguarded config_tree['slots'], so a
        # config.json missing the key raised KeyError out of read_json_config --
        # and since init_config() runs before the web thread starts, that took
        # the whole server down rather than just the board. The operator was
        # then left with a process that would not come up and no interface to
        # fix it in. Say so loudly and carry on with an empty board instead;
        # nothing is written back, so a recoverable file stays recoverable.
        slots = config_tree.get('slots')
        config_load_degraded = not isinstance(slots, list)
        if config_load_degraded:
            logger.warning(
                'No usable "slots" list in %s -- starting with an empty board. '
                'The file may be incomplete; it has been left exactly as found.',
                file)
            slots = []

        for chan in slots:
            if chan['type'] in ['uhfr', 'qlxd', 'ulxd', 'axtd', 'p10t']:
                netDev = shure.check_add_network_device(chan['ip'], chan['type'])
                netDev.add_channel_device(chan)

            elif chan['type'] == 'offline':
                offline.add_device(chan)


    gif_dir = get_gif_dir()
    version = get_version_number()
    config_tree.setdefault('port', DEFAULT_PORT)
    config_tree['wirelessboard_version'] = version
    config_tree['micboard_version'] = version
    ensure_discovery_defaults()
    ensure_cloud_defaults()
    ensure_background_defaults()
    ensure_logging_defaults()

    # Corrective migrations have to be written back, or the marker is lost and
    # they run again on the next start.
    #
    # Not when the file did not load cleanly, though. Everything above this
    # point fills in defaults, so saving now would write a complete, wholly
    # invented config over whatever the operator actually had -- the one copy of
    # a config that might still be recoverable, replaced by an empty board. The
    # migration runs again next start, which is the cost, and it is much the
    # smaller one. Re-running a migration is free; the file is not.
    if config_load_degraded:
        logger.warning(
            'Not writing configuration back to %s: it did not load cleanly and '
            'the tree in memory is mostly defaults. Fix or restore the file '
            'first -- saving from the interface will overwrite it.', file)
    elif migrate_pco_number_fallback():
        try:
            save_current_config()
        except Exception as exc:  # noqa: BLE001
            logger.warning('Could not persist configuration migrations: %s', exc)

    # Last, so the copy matches the file as it now stands rather than as it was
    # before the migration above rewrote it. A save rebuilds through here too,
    # so the backup tracks the most recent configuration that actually loaded.
    if not config_load_degraded:
        _capture_backup(file)


CONFIG_BACKUP_SUFFIX = '.bak'
CONFIG_REJECTED_SUFFIX = '.rejected'


def backup_file():
    return config_file() + CONFIG_BACKUP_SUFFIX


def rejected_file():
    return config_file() + CONFIG_REJECTED_SUFFIX


def _capture_backup(source):
    """Keep a copy of a config.json that has just been read successfully.

    Byte-for-byte off the file rather than re-serialised from config_tree: the
    point is to preserve what actually worked, not our reading of it.

    Only ever taken after a clean load, so a board that comes up degraded
    cannot overwrite the last good copy with the damaged one -- which is the
    single thing that would make this useless exactly when it is needed.
    """
    try:
        copyfile(source, backup_file())
    except Exception as exc:  # noqa: BLE001
        # Never fatal. Failing to keep a spare copy must not stop the board
        # from starting.
        logger.warning('Could not update the configuration backup: %s', exc)


def config_health():
    """What the interface needs in order to offer a way out."""
    backup = backup_file()
    healthy_backup = os.path.exists(backup)
    return {
        'degraded': bool(config_load_degraded),
        'backup_available': healthy_backup,
        'config_path': config_file(),
        'backup_path': backup if healthy_backup else None,
    }


def _default_config_payload():
    """The same bytes a fresh install starts from.

    config_file() seeds a brand new install by copying democonfig.json, so
    reusing it here makes "reset to defaults" mean exactly "as if this board
    had never been configured" -- which is what an admin reaching for it
    expects. The inline fallback only matters if the bundle is missing the
    seed file.
    """
    demo_config_path = app_dir('democonfig.json')
    if demo_config_path is not None and os.path.exists(demo_config_path):
        with open(demo_config_path) as handle:
            return handle.read()

    logger.warning('democonfig.json is missing; resetting to a minimal configuration')
    return json.dumps(
        {'port': DEFAULT_PORT, 'groups': [], 'slots': []},
        indent=2, separators=(',', ': '), sort_keys=True)


def recover(action):
    """Replace config.json from the backup, or from the shipped defaults.

    The way out of a config.json the board cannot use. Until this existed the
    only remedy was editing JSON by hand on the machine -- and the failure that
    prompted it left no interface running to explain that.

    Takes the same lock as a save: it rewrites the same file and rebuilds the
    same devices.
    """
    with _RECONFIG_LOCK:
        return _recover_locked(action)


def _recover_locked(action):
    global config_load_degraded

    if action == 'restore':
        source = backup_file()
        if not os.path.exists(source):
            raise FileNotFoundError('No configuration backup is available to restore')
        with open(source) as handle:
            payload = handle.read()
        # Refuse to restore a backup that is itself unusable, rather than
        # trading one broken config for another and reporting success.
        parsed = json.loads(payload)
        if not isinstance(parsed.get('slots'), list):
            raise ValueError('The configuration backup is not usable')
    elif action == 'defaults':
        payload = _default_config_payload()
    else:
        raise ValueError('Unknown recovery action: {}'.format(action))

    target = config_file()

    # The file being replaced is kept, not deleted. It is the only copy of
    # whatever the admin had, and "reset to defaults" must not be the moment it
    # stops existing -- a config that merely failed to parse is often a one
    # character fix for someone reading it later.
    if os.path.exists(target):
        try:
            copyfile(target, rejected_file())
        except Exception as exc:  # noqa: BLE001
            logger.warning('Could not set the previous configuration aside: %s', exc)

    tmp = '{}.tmp'.format(target)
    try:
        with open(tmp, 'w') as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, target)
    except Exception:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise

    logger.warning(
        'Configuration recovered via "%s"; the previous file was kept at %s',
        action, rejected_file())

    config_load_degraded = False
    rebuild_from_disk()
    return config_health()


def init_config():
    config()

def write_json_config(data):
    """Serialise the tree to config.json without ever truncating the old one.

    open(..., 'w') empties the file first, so anything that went wrong between
    that and a completed json.dump -- a crash, a full disk, a tree that is not
    serialisable -- left the operator with a half-written or empty config.json
    and a board that would not start. Rendering to a string first means a tree
    that cannot be serialised fails before the real file is touched at all, and
    os.replace puts the finished file in place in one step.
    """
    target = config_file()
    payload = json.dumps(data, indent=2, separators=(',', ': '), sort_keys=True)

    tmp = '{}.tmp'.format(target)
    try:
        with open(tmp, 'w') as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())

        os.replace(tmp, target)
    except Exception:
        # Otherwise a disk that filled up mid-write leaves a half-written
        # config.json.tmp sitting next to the real one for good.
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise

def save_current_config():
    return write_json_config(config_tree)

def get_group_by_number(group_number):
    for group in config_tree['groups']:
        if group['group'] == int(group_number):
            return group
    return None

def update_group(data):
    group_update_list.append(data)
    group = get_group_by_number(data['group'])
    if not group:
        group = {}
        group['group'] = data['group']
        config_tree['groups'].append(group)

    group['slots'] = data['slots']
    group['title'] = data['title']
    group['hide_charts'] = data['hide_charts']

    save_current_config()

def get_slot_by_number(slot_number):
    # .get, because config_mix calls this while merging a save against the
    # loaded tree, which -- on a board that started from a config with no slots
    # -- does not have the key yet.
    for slot in config_tree.get('slots') or []:
        if slot['slot'] == slot_number:
            return slot
    return None

def update_slot(data):
    slot_cfg = get_slot_by_number(data['slot'])

    if slot_cfg is None:
        logger.warning("Slot config for slot %s not found.", data['slot'])
        return

    has_extended_id = 'extended_id' in data
    has_extended_name = 'extended_name' in data
    has_chan_name = 'chan_name_raw' in data

    if has_extended_id:
        value = data.get('extended_id')
        if value:
            slot_cfg['extended_id'] = value
        else:
            slot_cfg.pop('extended_id', None)

    if has_extended_name:
        value = data.get('extended_name')
        if value:
            slot_cfg['extended_name'] = value
        else:
            slot_cfg.pop('extended_name', None)

    if has_chan_name:
        value = data.get('chan_name_raw')
        if value:
            slot_cfg['chan_name_raw'] = value
        else:
            slot_cfg.pop('chan_name_raw', None)

    save_current_config()


def _normalized_slot_set(slots):
    if slots is None:
        return {slot_cfg.get('slot') for slot_cfg in config_tree.get('slots', []) if slot_cfg.get('slot') is not None}
    target = set()
    try:
        for entry in slots:
            try:
                target.add(int(entry))
            except (TypeError, ValueError):
                continue
    except TypeError:
        try:
            target.add(int(slots))
        except (TypeError, ValueError):
            return set()
    return target


def clear_device_names(slots=None):
    """Remove cached device names for the provided slot numbers.

    If *slots* is ``None`` all configured slots will be cleared. Returns the
    list of slot numbers that were updated. Extended name data is preserved.
    """

    target_slots = _normalized_slot_set(slots)
    if not target_slots:
        return []

    cleared = []
    dirty = False
    for slot_cfg in config_tree.get('slots', []):
        slot_num = slot_cfg.get('slot')
        if slot_num in target_slots and 'chan_name_raw' in slot_cfg:
            slot_cfg.pop('chan_name_raw', None)
            dirty = True
        if slot_num in target_slots:
            cleared.append(slot_num)

    if dirty:
        save_current_config()

    return cleared

def update_pco_config(pco_data: Any) -> Tuple[Dict[str, Any], CredentialMeta]:
    if not isinstance(pco_data, dict):
        logger.warning('Invalid PCO config payload')
        raise CredentialError('Invalid PCO configuration payload')

    existing = config_tree.get('pco') if isinstance(config_tree.get('pco'), dict) else {}
    merged: Dict[str, Any] = copy.deepcopy(existing) if existing else {}

    # Apply non-auth fields first to preserve ancillary configuration updates.
    for key, value in pco_data.items():
        if key == 'auth':
            continue
        merged[key] = value

    auth_provided = 'auth' in pco_data
    auth_payload_raw = pco_data.get('auth') if auth_provided else None
    meta: CredentialMeta

    if auth_provided:
        payload = auth_payload_raw if isinstance(auth_payload_raw, dict) else {}
        token = str(payload.get('token') or '').strip()
        secret = str(payload.get('secret') or '').strip()
        if token or secret:
            try:
                meta = apply_auth_update(
                    merged,
                    {
                        'token': token,
                        'secret': secret,
                    },
                )
            except CredentialError as exc:
                logger.warning('Failed to update PCO credentials: %s', exc)
                raise
        else:
            meta = CredentialMeta.from_config(merged.get('auth'))
            merged['auth'] = meta.to_config()
    else:
        meta = CredentialMeta.from_config(merged.get('auth'))
        merged['auth'] = meta.to_config()

    config_tree['pco'] = merged
    save_current_config()
    try:
        logger.info('PCO config updated and saved to %s', config_file())
    except Exception:
        logger.info('PCO config updated and saved')

    return merged, meta


def get_public_config_tree() -> Dict[str, Any]:
    """Return the configuration as it should be served to clients.

    The stored PCO auth block holds only metadata — credential_id, version, salt
    and token_digest — and notably no `has_credentials` flag; that flag exists
    only in the public view. Serving the raw tree therefore did two bad things
    at once: it published the salt and digest to every client polling
    /data.json, and it overwrote the browser's cached `has_credentials`, which
    is what the PCO sync button checks. Credentials would save correctly and
    then appear unstored on the next poll a second later.
    """

    tree = dict(config_tree)
    if isinstance(tree.get('pco'), dict):
        tree['pco'] = get_public_pco_config()
    return tree


def get_public_pco_config() -> Dict[str, Any]:
    """Return a sanitized snapshot of the PCO configuration for API consumers."""

    pco_cfg = config_tree.get('pco')
    if not isinstance(pco_cfg, dict):
        return {'auth': public_auth_view({})}

    payload = copy.deepcopy(pco_cfg)
    payload['auth'] = public_auth_view(pco_cfg)
    return payload
