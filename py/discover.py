import contextlib
import copy
import ipaddress
import json
import logging
import os
import platform
import socket
import struct
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from optparse import OptionParser
from typing import Any, Dict, List, Optional, Tuple

import xml.etree.ElementTree as ET

import config
from device_config import BASE_CONST

MCAST_GRP = '239.255.254.253'
MCAST_PORT = 8427
PROBE_PORT = 2202
PROBE_COMMANDS = [
    b'< GET 1 DEVICE_ID >\r\n',
    b'< GET 1 ALL >\r\n',
    b'< GET DEVICE_ID >\r\n',
]
MAX_PROBE_WORKERS = 24
MAX_HOSTS_PER_SUBNET = 1024
SLP_SOCKET_TIMEOUT = 1.0
ACTIVE_SCAN_TTL = 180
DEFAULT_DCID_XML = '/Applications/Shure Update Utility.app/Contents/Resources/DCIDMap.xml'
FALLBACK_DISCOVERY_SETTINGS = {
    'auto': True,
    'subnets': [],
    'scan_interval': 60,
    'timeout_ms': 750,
}
FALLBACK_DISCOVERY_MIN_TIMEOUT = 100
FALLBACK_DISCOVERY_MAX_TIMEOUT = 5000

dcid_status: Dict[str, Any] = {
    'loaded': False,
    'source': None,
    'message': 'DCID map not loaded. Install Shure Update Utility or provide dcid.json.',
}


def _update_dcid_status(source_path: Optional[str]) -> None:
    global dcid_status
    if deviceList:
        message = f'DCID map loaded with {len(deviceList)} entries'
        if source_path:
            message = f'{message} from {source_path}'
        dcid_status = {
            'loaded': True,
            'source': source_path,
            'message': message,
        }
        logger.debug(message)
        return

    fallback_map = DCIDMapCheck()
    if fallback_map:
        message = (
            'DCID map not generated. Run "python py/discover.py --convert -i \"{}\" -o dcid.json" '
            'to import the Shure Update Utility database.'
        ).format(fallback_map)
    else:
        message = (
            'DCID map not found. Install Shure Update Utility or provide dcid.json so discovery '
            'can classify receivers.'
        )

    dcid_status = {
        'loaded': False,
        'source': source_path,
        'message': message,
    }
    logger.warning(message)


def get_dcid_status() -> Dict[str, Any]:
    return copy.deepcopy(dcid_status)

logger = logging.getLogger('micboard.discovery')


deviceList: Dict[str, Dict[str, str]] = {}
discovered: List[Dict[str, Any]] = []
discovered_lock = threading.Lock()


def discover() -> None:
    """Run multicast listener and periodic active scans."""
    dcid_path = None
    app_dir_fn = getattr(config, 'app_dir', None)
    if callable(app_dir_fn):
        dcid_path = app_dir_fn('dcid.json')
    if isinstance(dcid_path, str) and os.path.exists(dcid_path):
        try:
            dcid_restore_from_file(dcid_path)
            logger.debug('Loaded %d DCID entries from %s', len(deviceList), dcid_path)
        except Exception:
            logger.warning('Failed to load DCID map from %s', dcid_path, exc_info=True)
    _update_dcid_status(dcid_path if isinstance(dcid_path, str) else None)

    while True:
        try:
            _discovery_loop()
        except Exception:
            logger.exception('Discovery loop crashed; restarting in 5 seconds')
            time.sleep(5)


def _discovery_loop() -> None:
    with contextlib.closing(_open_multicast_socket()) as sock:
        next_scan_at = 0.0
        while True:
            settings = _get_discovery_settings()
            now = time.time()
            if next_scan_at == 0.0:
                next_scan_at = now
            deadline = max(0.0, next_scan_at - now)
            timeout = min(SLP_SOCKET_TIMEOUT, deadline) if deadline > 0 else SLP_SOCKET_TIMEOUT

            ip = ''
            try:
                sock.settimeout(timeout)
                data, (ip, _) = sock.recvfrom(4096)
            except socket.timeout:
                data = None
            except OSError as exc:
                logger.warning('Multicast socket error: %s', exc)
                time.sleep(1.0)
                continue

            if data:
                _handle_multicast_packet(data, ip)

            if time.time() >= next_scan_at:
                try:
                    _run_active_scan(settings)
                except Exception:
                    logger.exception('Active discovery scan failed')
                next_scan_at = time.time() + max(int(settings.get('scan_interval', 60)), 15)
                ttl = max(settings.get('scan_interval', 60) * 3, ACTIVE_SCAN_TTL)
                _prune_discovered(ttl)


def _get_discovery_settings() -> Dict[str, Any]:
    getter = getattr(config, 'get_discovery_settings', None)
    if callable(getter):
        try:
            result = getter()
        except Exception:
            logger.debug('Falling back to default discovery settings', exc_info=True)
        else:
            if isinstance(result, dict):
                return copy.deepcopy(result)

    defaults = getattr(config, 'DEFAULT_DISCOVERY_SETTINGS', None)
    if isinstance(defaults, dict):
        return copy.deepcopy(defaults)
    return copy.deepcopy(FALLBACK_DISCOVERY_SETTINGS)


def _config_int(name: str, default: int) -> int:
    value = getattr(config, name, default)
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _open_multicast_socket() -> socket.socket:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    except OSError:
        pass
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
    except (AttributeError, OSError):
        pass
    try:
        sock.bind((MCAST_GRP, MCAST_PORT))
    except OSError:
        sock.bind(('', MCAST_PORT))
    mreq = struct.pack('4sl', socket.inet_aton(MCAST_GRP), socket.INADDR_ANY)
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
    return sock


def _handle_multicast_packet(raw_payload: bytes, ip: str) -> None:
    try:
        payload = raw_payload.decode('utf-8', errors='ignore')
    except Exception:
        logger.debug('Unable to decode discovery payload from %s', ip)
        return

    dcid = dcid_find(payload)
    device = dcid_get(dcid)
    lookup = dcid_model_lookup(device['model']) if device else None
    rx_type, channels = lookup if lookup else (None, None)

    add_rx_to_dlist(
        ip,
        rx_type=rx_type,
        channels=channels,
        model=(device.get('model_name') if device else None) or (device.get('model') if device else None),
        band=device.get('band') if device else None,
        dcid=dcid,
        source='slp',
        reachable=True,
    )

    if device is None:
        logger.debug('Discovery packet from %s referenced unknown DCID %s', ip, dcid)


def _run_active_scan(settings: Dict[str, Any]) -> None:
    timeout_ms = settings.get('timeout_ms', 750)
    try:
        timeout_ms = int(timeout_ms)
    except (TypeError, ValueError):
        timeout_ms = 750
    min_timeout = _config_int('DISCOVERY_MIN_TIMEOUT', FALLBACK_DISCOVERY_MIN_TIMEOUT)
    max_timeout = _config_int('DISCOVERY_MAX_TIMEOUT', FALLBACK_DISCOVERY_MAX_TIMEOUT)
    timeout_ms = max(min_timeout, min(max_timeout, timeout_ms))
    timeout = timeout_ms / 1000.0

    networks = _candidate_subnets(settings)
    if not networks:
        logger.debug('No discovery subnets configured for active scan')
        return

    for network in networks:
        try:
            _probe_network(network, timeout)
        except RuntimeError as exc:
            logger.debug('Active scan halted while shutting down: %s', exc)
            return


def _candidate_subnets(settings: Dict[str, Any]) -> List[ipaddress.IPv4Network]:
    candidates: List[ipaddress.IPv4Network] = []
    manual = settings.get('subnets') or []
    for entry in manual:
        try:
            network = ipaddress.ip_network(entry, strict=False)
        except ValueError:
            logger.warning('Skipping invalid discovery subnet %s', entry)
            continue

        if network.version != 4:
            logger.warning('Skipping non-IPv4 discovery subnet %s', entry)
            continue

        if network.num_addresses > MAX_HOSTS_PER_SUBNET:
            logger.warning('Skipping discovery subnet %s (%s hosts)', network, network.num_addresses)
            continue

        candidates.append(network)

    if settings.get('auto', True):
        candidates.extend(_auto_detect_subnets())

    result: List[ipaddress.IPv4Network] = []
    seen = set()
    for network in candidates:
        key = str(network)
        if key in seen:
            continue
        seen.add(key)
        result.append(network)
    return result


def _auto_detect_subnets() -> List[ipaddress.IPv4Network]:
    subnets: List[ipaddress.IPv4Network] = []
    ip_addr = _default_interface_ip()
    if not ip_addr:
        return subnets
    try:
        network_any = ipaddress.ip_network(f'{ip_addr}/24', strict=False)
        if isinstance(network_any, ipaddress.IPv4Network) and network_any.num_addresses <= MAX_HOSTS_PER_SUBNET:
            subnets.append(network_any)
    except ValueError:
        logger.debug('Unable to derive auto subnet from %s', ip_addr)
    return subnets


def _default_interface_ip() -> Optional[str]:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock_obj:
            sock_obj.connect(('8.8.8.8', 80))
            return sock_obj.getsockname()[0]
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except socket.gaierror:
            return None


def _probe_network(network: ipaddress.IPv4Network, timeout: float) -> None:
    hosts = [str(host) for host in network.hosts()]
    if not hosts:
        return
    if len(hosts) > MAX_HOSTS_PER_SUBNET:
        hosts = hosts[:MAX_HOSTS_PER_SUBNET]
    workers = min(MAX_PROBE_WORKERS, max(1, len(hosts)))
    logger.debug('Active scan on %s with %d hosts (workers=%d)', network, len(hosts), workers)

    try:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {}
            for host_ip in hosts:
                try:
                    futures[executor.submit(_probe_ip, host_ip, timeout)] = host_ip
                except RuntimeError as exc:
                    logger.debug('Stopping probe scheduling: %s', exc)
                    raise

            for future in as_completed(futures):
                ip = futures[future]
                try:
                    result = future.result()
                except Exception as exc:
                    logger.debug('Probe error for %s: %s', ip, exc)
                    continue
                if not result:
                    continue
                add_rx_to_dlist(
                    result.get('ip', ip),
                    rx_type=result.get('type'),
                    channels=result.get('channels'),
                    model=result.get('model'),
                    band=result.get('band'),
                    dcid=result.get('dcid'),
                    source=result.get('source', 'active'),
                    reachable=result.get('reachable', True),
                )
    except RuntimeError:
        raise


def _probe_ip(ip: str, timeout: float) -> Optional[Dict[str, Any]]:
    start = time.time()
    try:
        with socket.create_connection((ip, PROBE_PORT), timeout=timeout) as conn:
            conn.settimeout(timeout)
            payload = ''
            for command in PROBE_COMMANDS:
                try:
                    conn.sendall(command)
                    data = conn.recv(4096)
                    if data:
                        payload = data.decode('utf-8', errors='ignore')
                        break
                except socket.timeout:
                    continue
            info = _parse_probe_payload(payload)
            info['ip'] = ip
            info['source'] = 'active'
            info['reachable'] = True
            info['rtt_ms'] = int((time.time() - start) * 1000)
            return info
    except (socket.timeout, ConnectionError, OSError):
        return None


def _parse_probe_payload(payload: str) -> Dict[str, Any]:
    info: Dict[str, Any] = {}
    if not payload:
        return info

    dcid = _extract_dcid_from_text(payload)
    if dcid:
        info['dcid'] = dcid
        device = dcid_get(dcid)
        if device:
            info['model'] = device.get('model_name') or device.get('model')
            info['band'] = device.get('band')
            lookup = dcid_model_lookup(device.get('model'))
            if lookup:
                info['type'], info['channels'] = lookup
    else:
        model_hint = _extract_model_hint(payload)
        if model_hint:
            info['model'] = model_hint

    if payload:
        info['probe_payload'] = payload.strip()
    return info


def _extract_dcid_from_text(data: str) -> Optional[str]:
    if not data:
        return None
    possible_tokens = [token.strip(' <>\"\r\n\t;,') for token in data.replace('cd:', 'cd:').split()]
    for token in possible_tokens:
        candidate = token.upper()
        if candidate.startswith('CD:'):
            candidate = candidate[3:]
        if candidate in deviceList:
            return candidate
    return None


def _extract_model_hint(data: str) -> Optional[str]:
    if not data:
        return None
    for line in data.splitlines():
        upper = line.upper()
        if any(marker in upper for marker in ('MODEL', 'PRODUCT', 'DEVICE')):
            parts = [part.strip('<>\"') for part in line.split() if part]
            for part in parts:
                if part.upper() in {'GET', 'SET', 'REP', 'REPORT', 'SAMPLE'}:
                    continue
                if len(part) > 2:
                    return part
    return None


def add_rx_to_dlist(ip: str, rx_type: Optional[str] = None, channels: Optional[int] = None,
                    model: Optional[str] = None, band: Optional[str] = None,
                    dcid: Optional[str] = None, source: str = 'slp',
                    reachable: bool = True) -> None:
    now = time.time()
    with discovered_lock:
        entry = next((item for item in discovered if item['ip'] == ip), None)
        if entry is None:
            entry = {
                'ip': ip,
                'channel': 1,
            }
            discovered.append(entry)

        if rx_type:
            entry['type'] = rx_type
        elif 'type' not in entry:
            entry['type'] = 'unknown'

        if channels:
            try:
                entry['channels'] = int(channels)
            except (TypeError, ValueError):
                entry['channels'] = channels
        elif 'channels' not in entry:
            entry['channels'] = 1

        if model:
            entry['model'] = model
        if band:
            entry['band'] = band
        if dcid:
            entry['dcid'] = dcid

        entry['source'] = source
        entry['reachable'] = reachable
        entry['timestamp'] = now
        entry.setdefault('slot', discovered.index(entry) + 1)

        discovered.sort(key=lambda item: item['ip'])
        for idx, item in enumerate(discovered, start=1):
            item['slot'] = idx


def _prune_discovered(ttl: float) -> None:
    cutoff = time.time() - ttl
    with discovered_lock:
        before = len(discovered)
        discovered[:] = [entry for entry in discovered if entry.get('timestamp', 0) >= cutoff]
        if before != len(discovered):
            logger.debug('Pruned %d stale discovery entries', before - len(discovered))


def time_filterd_discovered_list(ttl: float = ACTIVE_SCAN_TTL) -> List[Dict[str, Any]]:
    cutoff = time.time() - ttl
    with discovered_lock:
        snapshot = [dict(entry) for entry in discovered if entry.get('timestamp', 0) >= cutoff]
        for entry in snapshot:
            entry['age'] = max(0, time.time() - entry.get('timestamp', 0))
        return snapshot


def dcid_find(data: str) -> str:
    dcid = ''
    for segment in data.split(','):
        segment = segment.strip('()')
        if 'cd:' in segment:
            dcid = segment.split('cd:')[-1]
    return dcid


def dcid_get(dcid: Optional[str]) -> Optional[Dict[str, str]]:
    if not dcid:
        return None
    return deviceList.get(dcid)


def dcid_model_lookup(name: Optional[str]) -> Optional[Tuple[str, Any]]:
    if not name:
        return None
    for type_key, type_value in BASE_CONST.items():
        for model_key, model_value in type_value['DCID_MODEL'].items():
            if name == model_key:
                return type_key, model_value
    return None


def DCID_Parse(file: str) -> None:
    tree = ET.parse(file)
    root = tree.getroot()

    devices = root.findall('./MapEntry')

    for device in devices:
        key_element = device.find('Key')
        model_element = device.find('ModelName')
        dcid_list = device.find('DCIDList')
        if key_element is None or model_element is None or dcid_list is None:
            continue

        model = key_element.text or ''
        model_name = model_element.text or ''
        for dccid in dcid_list.iter('DCID'):
            if dccid.text is None:
                continue
            band = dccid.attrib.get('band', '') if dccid.attrib else ''
            dev = {'model': model, 'model_name': model_name, 'band': band}
            deviceList[dccid.text] = dev


def dcid_save_to_file(file: str) -> None:
    with open(file, 'w') as out_file:
        json.dump(deviceList, out_file, indent=2, separators=(',', ': '), sort_keys=True)
        out_file.write('\n')


def dcid_restore_from_file(file: str) -> None:
    global deviceList
    with open(file, 'r') as in_file:
        deviceList = json.load(in_file)


def updateDCIDmap(inputFile: str, outputFile: str) -> None:
    DCID_Parse(inputFile)
    dcid_save_to_file(outputFile)


def DCIDMapCheck() -> Optional[str]:
    if platform.system() == 'Darwin' and os.path.isfile(DEFAULT_DCID_XML):
        return DEFAULT_DCID_XML
    return None


def main() -> None:
    usage = 'usage: %prog [options] arg'
    parser = OptionParser(usage)

    parser.add_option('-i', '--input', dest='input_file',
                      help='DCID input file')
    parser.add_option('-o', '--output', dest='output_file',
                      help='output file')
    parser.add_option('-c', '--convert', default=False,
                      action='store_true', dest='convert',
                      help='Generate dcid.json from input DCIDMap.xml file')
    parser.add_option('-d', '--discover', default=True,
                      action='store_true', dest='discover',
                      help='Discover Shure devices on the network')

    (options, _) = parser.parse_args()

    if options.convert:
        if not options.output_file:
            print('use -o to specify a DCID output file destination')
            sys.exit()

        if options.input_file:
            path = options.input_file

        elif DCIDMapCheck():
            path = DCIDMapCheck()

        else:
            print('Specify an input DCIDMap.xml file with -i or install Wireless Workbench')
            sys.exit()

        if path:
            updateDCIDmap(path, options.output_file)
            print('Converting {} to {}'.format(path, options.output_file))
        sys.exit()

    if options.discover:
        print('Starting discovery loop (Ctrl+C to exit)')
        discover()


if __name__ == '__main__':
    main()
