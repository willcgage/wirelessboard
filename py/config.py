import argparse
import copy
import ipaddress
import json
import logging
import logging.config
import os
import sys
import time
import uuid
from shutil import copyfile
from typing import Any, Dict, List, Optional, Tuple

import shure
import offline
import tornado_server

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
        logger.info('Adding UUID: %s to config.conf', micboard_uuid)
        config_tree['uuid'] = micboard_uuid
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

    if background_directory is not None:
        resolved = os.path.abspath(os.path.expanduser(background_directory))
        return {
            'source': 'cli',
            'resolved_path': resolved,
            'configured_path': resolved,
            'default_path': default_path,
            'cli_override': True,
            'exists': os.path.isdir(resolved),
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
        }

    resolved_default = os.path.abspath(default_gif_dir())
    return {
        'source': 'default',
        'resolved_path': resolved_default,
        'configured_path': None,
        'default_path': default_path,
        'cli_override': False,
        'exists': os.path.isdir(resolved_default),
    }


def set_background_directory(path: Optional[str]) -> Dict[str, Any]:
    background_directory = args.get('background_directory') if isinstance(args, dict) else None
    if background_directory not in (None, ''):
        raise RuntimeError('Background directory is controlled by a command-line override.')

    target: Optional[str]
    if path is None:
        target = None
    elif isinstance(path, str):
        target = path.strip()
    else:
        raise ValueError('Background directory must be a string path.')

    global gif_dir

    if not target:
        config_tree.pop('background-folder', None)
        gif_dir = default_gif_dir()
        save_current_config()
        return get_background_directory_state()

    normalized = os.path.abspath(os.path.expanduser(target))
    try:
        os.makedirs(normalized, exist_ok=True)
    except OSError as exc:
        raise ValueError(f'Unable to create background directory: {exc}') from exc

    config_tree['background-folder'] = normalized
    gif_dir = normalized
    save_current_config()
    return get_background_directory_state()

def config_file():
    app_config_path = app_dir(CONFIG_FILE_NAME)
    if app_config_path is not None and os.path.exists(app_config_path):
        return app_config_path
    elif os.path.exists(config_path(CONFIG_FILE_NAME)):
        return config_path(CONFIG_FILE_NAME)
    else:
        demo_config_path = app_dir('democonfig.json')
        if demo_config_path is not None:
            copyfile(demo_config_path, config_path(CONFIG_FILE_NAME))
        return config_path(CONFIG_FILE_NAME)

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
    settings = ensure_logging_defaults()
    configure_logging(settings)
    uuid_init()


    logger.info('Starting Wirelessboard %s', config_tree['wirelessboard_version'])


def config_mix(slots):
    for slot in slots:
        current = get_slot_by_number(slot['slot'])
        if current:
            if 'extended_id' not in slot and 'extended_id' in current:
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


def reconfig(payload):
    if isinstance(payload, dict):
        slots = payload.get('slots', [])
        discovery_payload = payload.get('discovery')
    else:
        slots = payload
        discovery_payload = None

    tornado_server.SocketHandler.close_all_ws()

    if discovery_payload is not None:
        normalized = normalize_discovery_settings(discovery_payload)
        config_tree['discovery'] = normalized
    else:
        ensure_discovery_defaults()

    if not isinstance(slots, list):
        logger.warning('Invalid slot payload during reconfig; expected list, got %s', type(slots))
        slots = []

    config_tree['slots'] = config_mix(slots)

    save_current_config()

    config_tree.clear()
    for device in shure.NetworkDevices:
        # device.socket_disconnect()
        device.disable_metering()
        del device.channels[:]

    del shure.NetworkDevices[:]
    del offline.OfflineDevices[:]

    time.sleep(2)

    config()
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
    with open(file) as config_file:
        config_tree = json.load(config_file)

        for chan in config_tree['slots']:
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
    ensure_logging_defaults()


def init_config():
    config()

def write_json_config(data):
    with open(config_file(), 'w') as f:
        json.dump(data, f, indent=2, separators=(',', ': '), sort_keys=True)

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
    for slot in config_tree['slots']:
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


def get_public_pco_config() -> Dict[str, Any]:
    """Return a sanitized snapshot of the PCO configuration for API consumers."""

    pco_cfg = config_tree.get('pco')
    if not isinstance(pco_cfg, dict):
        return {'auth': public_auth_view({})}

    payload = copy.deepcopy(pco_cfg)
    payload['auth'] = public_auth_view(pco_cfg)
    return payload
