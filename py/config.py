import argparse
import copy
import json
import logging
import logging.config
import os
import sys
import time
import uuid
from shutil import copyfile
from typing import Any, Dict, Tuple

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
    if background_directory is not None:
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


def reconfig(slots):
    tornado_server.SocketHandler.close_all_ws()

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
