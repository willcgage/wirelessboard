import json
import os
import asyncio
import socket
import logging
import sys
import time
from typing import Any, cast, Iterable

import tornado.websocket as websocket
import tornado.web as web
import tornado.ioloop as ioloop
import tornado.escape as escape

import shure
import config as config_module
import discover
import offline
import pco
import google_drive
from pco_credentials import CredentialError
from logging_utils import available_levels, available_sources, purge_logs, read_log_entries

config = cast(Any, config_module)

logger = logging.getLogger('micboard.web')


# https://stackoverflow.com/questions/5899497/checking-file-extension
def file_list(extension):
    files = []
    dir_list = os.listdir(config.get_gif_dir())
    for file in dir_list:
        if file.lower().endswith(extension):
            files.append(file)
    return files

# Resolved lazily and cached as (url, monotonic deadline).
_LOCAL_URL_CACHE = None
_LOCAL_URL_TTL_SECONDS = 60


def localURL():
    """Best-effort http://<local ip>:<port> for the QR code.

    gethostbyname on the host's own name is a blocking resolver call, and this
    runs inside /data.json, which every open board requests every five seconds.
    Where that name does not resolve the call does not fail fast -- it spends
    the full resolver timeout, and since the handler is synchronous it spends
    it holding the IOLoop, so every other request queues behind it. A floor of
    just over 5000ms on every /data.json, with the backlog climbing past 100s,
    is what that looks like from the outside.

    The address is still re-resolved periodically, which was the point of doing
    it per request, but a slow or failing lookup now costs that once a minute
    rather than once per request. Failures are cached too: a lookup that times
    out is the expensive case and the one most worth not repeating.
    """
    global _LOCAL_URL_CACHE

    if 'local_url' in config.config_tree:
        return config.config_tree['local_url']

    if _LOCAL_URL_CACHE is not None and time.monotonic() < _LOCAL_URL_CACHE[1]:
        return _LOCAL_URL_CACHE[0]

    started = time.monotonic()
    try:
        ip = socket.gethostbyname(socket.gethostname())
        url = 'http://{}:{}'.format(ip, config.config_tree['port'])
    except OSError:
        logger.debug('Unable to resolve local IP for the QR code URL', exc_info=True)
        url = 'https://github.com/willcgage/wirelessboard'

    elapsed = time.monotonic() - started
    if elapsed > 1:
        logger.warning(
            'Resolving this host took %.1fs, and every request waits while it runs. '
            'Set "local_url" in config.json to skip the lookup entirely.', elapsed)

    _LOCAL_URL_CACHE = (url, time.monotonic() + _LOCAL_URL_TTL_SECONDS)
    return url

def wirelessboard_json(network_devices):
    offline_devices = offline.offline_json()
    data = []
    discovered = []
    for net_device in network_devices:
        data.append(net_device.net_json())

    if offline_devices:
        data.append(offline_devices)

    gifs = file_list('.gif')
    jpgs = file_list('.jpg')
    mp4s = file_list('.mp4')
    url = localURL()

    for device in discover.time_filterd_discovered_list():
        discovered.append(device)

    return json.dumps({
        'receivers': data,
        'url': url,
        'gif': gifs,
        'jpg': jpgs,
        'mp4': mp4s,
        'background_defaults': config.get_background_defaults(),
        'config': config.get_public_config_tree(),
        'discovered': discovered,
        'discovery_status': discover.get_dcid_status(),
    }, sort_keys=True, indent=4)


class IndexHandler(web.RequestHandler):
    def get(self):
        demo_path = config.app_dir('demo.html')
        if not isinstance(demo_path, str) or demo_path is None:
            self.send_error(404)
        else:
            self.render(demo_path)

    def head(self):
        # Respond OK for health checks without a body
        self.set_status(200)

class AboutHandler(web.RequestHandler):
    def get(self):
        about_path = config.app_dir('static/about.html')
        if not isinstance(about_path, str) or about_path is None:
            self.send_error(404)
        else:
            self.render(about_path)

    def head(self):
        self.set_status(200)

class JsonHandler(web.RequestHandler):
    def get(self):
        self.set_header('Content-Type', 'application/json')
        self.write(wirelessboard_json(shure.NetworkDevices))

    def head(self):
        # Indicate availability; clients should GET to retrieve JSON
        self.set_header('Content-Type', 'application/json')
        self.set_status(200)

class SocketHandler(websocket.WebSocketHandler):
    clients = set()

    def check_origin(self, origin):
        return True

    def open(self, *args, **kwargs):
        self.clients.add(self)

    def on_close(self):
        self.clients.remove(self)

    @classmethod
    def close_all_ws(cls):
        for c in cls.clients:
            c.close()

    @classmethod
    def broadcast(cls, data):
        for c in cls.clients:
            try:
                c.write_message(data)
            except Exception as exc:
                logger.warning('WebSocket broadcast failed: %s', exc)

    @classmethod
    def ws_dump(cls):
        out = {}
        if shure.chart_update_list:
            out['chart-update'] = shure.chart_update_list

        if shure.data_update_list:
            out['data-update'] = []
            for ch in shure.data_update_list:
                out['data-update'].append(ch.ch_json_mini())

        if config.group_update_list:
            out['group-update'] = config.group_update_list

        if out:
            data = json.dumps(out)
            cls.broadcast(data)
        del shure.chart_update_list[:]
        del shure.data_update_list[:]
        del config.group_update_list[:]

class SlotHandler(web.RequestHandler):
    def get(self):
        self.write("hi - slot")

    def post(self):
        data = json.loads(self.request.body)
        self.write('{}')
        for slot_update in data:
            config.update_slot(slot_update)
            logger.debug('Slot update payload: %s', slot_update)


class SlotDeviceNamesHandler(web.RequestHandler):
    def get(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')

        devices = []
        slots = config.config_tree.get('slots', []) or []
        for slot_cfg in slots:
            slot_num = slot_cfg.get('slot')
            if slot_num is None:
                continue

            channel = shure.get_network_device_by_slot(slot_num)
            name = ''
            source = 'none'
            device_type = slot_cfg.get('type', '')
            ip_addr = slot_cfg.get('ip', '')

            if channel is not None:
                live_name = getattr(channel, 'chan_name_raw', '') or ''
                if live_name:
                    name = live_name
                    source = 'live'
                device_type = getattr(getattr(channel, 'rx', None), 'type', device_type)
                ip_addr = getattr(getattr(channel, 'rx', None), 'ip', ip_addr)

            if not name:
                cached_name = slot_cfg.get('chan_name_raw') or ''
                if cached_name:
                    name = cached_name
                    source = 'config'

            if not name:
                source = 'none'

            devices.append({
                'slot': slot_num,
                'name': name,
                'type': device_type or '',
                'ip': ip_addr or '',
                'source': source
            })

        self.write(json.dumps({'ok': True, 'devices': devices}))


class SlotDeviceNamesClearHandler(web.RequestHandler):
    def post(self):
        slots = None
        if self.request.body:
            try:
                data = json.loads(self.request.body)
            except Exception:
                self.set_status(400)
                self.set_header('Content-Type', 'application/json')
                self.write(json.dumps({'ok': False, 'error': 'Invalid JSON'}))
                return
            else:
                slots = data.get('slots')

        cleared = config.clear_device_names(slots)
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.write(json.dumps({'ok': True, 'cleared': cleared}))


def _parse_bool(value: str) -> bool:
    return value.lower() in {'1', 'true', 'yes', 'on'}


def _parse_sources(params: Iterable[str]) -> Iterable[str]:
    return [s for s in (p.strip() for p in params) if s]


class LogsHandler(web.RequestHandler):
    def get(self):
        self.set_header('Content-Type', 'application/json')
        class GoogleDriveAuthLandingHandler(web.RequestHandler):
            def get(self):
                landing_path = config.app_dir('static/google-drive-auth.html')
                if not isinstance(landing_path, str) or landing_path is None or not os.path.exists(landing_path):
                    self.set_status(404)
                    self.write('Google Drive authorization landing page is unavailable.')
                    return

                self.set_header('Content-Type', 'text/html; charset=utf-8')
                self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
                with open(landing_path, 'r', encoding='utf-8') as handle:
                    self.write(handle.read())


        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')

        limit_arg = self.get_query_argument('limit', default='200')
        try:
            limit = max(1, min(1000, int(limit_arg)))
        except (TypeError, ValueError):
            self.set_status(400)
            self.write(json.dumps({'ok': False, 'error': 'Invalid limit parameter'}))
            return

        cursor = self.get_query_argument('cursor', default=None)
        level = self.get_query_argument('level', default=None)
        level = level.upper() if level else None

        sources: Iterable[str] = self.get_arguments('source')
        if not sources:
            sources_param = self.get_query_argument('sources', default=None)
            if sources_param:
                sources = _parse_sources(sources_param.split(','))
        else:
            sources = _parse_sources(sources)

        search = self.get_query_argument('search', default=None)
        direction = self.get_query_argument('direction', default='desc').lower()
        newer_flag = self.get_query_argument('newer', default=None)
        newer = False
        if newer_flag is not None:
            newer = _parse_bool(newer_flag)
        elif direction in {'asc', 'newer', 'forward'}:
            newer = True

        try:
            payload = read_log_entries(
                config.log_file(),
                limit=limit,
                cursor=cursor,
                level=level,
                sources=sources if sources else None,
                search=search,
                newer=newer,
            )
        except Exception as exc:
            logger.warning('Unable to read log entries: %s', exc)
            self.set_status(500)
            self.write(json.dumps({'ok': False, 'error': 'Unable to read logs'}))
            return

        response = {
            'ok': True,
            'entries': payload['entries'],
            'cursor': payload['next_cursor'],
            'has_more': payload['has_more'],
            'sources': available_sources(),
            'levels': available_levels(),
            'logging': config.get_logging_settings(),
            'direction': 'asc' if newer else 'desc',
        }
        self.write(json.dumps(response))


class LogsPurgeHandler(web.RequestHandler):
    def post(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        settings = config.get_logging_settings()
        backups = settings.get('backups', 5)
        try:
            backups_int = int(backups)
        except (TypeError, ValueError):
            backups_int = 5

        try:
            purge_logs(config.log_file(), backups=backups_int)
        except Exception as exc:
            logger.warning('Failed to purge logs: %s', exc)
            self.set_status(500)
            self.write(json.dumps({'ok': False, 'error': 'Unable to purge logs'}))
            return

        self.write(json.dumps({'ok': True}))


class LogSettingsHandler(web.RequestHandler):
    def get(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        response = {
            'ok': True,
            'logging': config.get_logging_settings(),
            'sources': available_sources(),
            'levels': available_levels(),
        }
        self.write(json.dumps(response))

    def post(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        try:
            payload = json.loads(self.request.body or '{}')
        except Exception:
            self.set_status(400)
            self.write(json.dumps({'ok': False, 'error': 'Invalid JSON'}))
            return

        try:
            updated = config.update_logging_settings(payload)
        except ValueError as exc:
            self.set_status(400)
            self.write(json.dumps({'ok': False, 'error': str(exc)}))
            return
        except Exception as exc:
            logger.warning('Failed to update logging settings: %s', exc)
            self.set_status(500)
            self.write(json.dumps({'ok': False, 'error': 'Unable to update logging settings'}))
            return

        self.write(json.dumps({'ok': True, 'logging': updated}))

class ConfigHandler(web.RequestHandler):
    def get(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        config.ensure_discovery_defaults()
        response = {
            'ok': True,
            'config': config.get_public_config_tree(),
            'discovery': config.get_discovery_settings(),
            'discovery_status': discover.get_dcid_status(),
        }
        self.write(json.dumps(response))

    async def post(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')

        try:
            payload = json.loads(self.request.body or '{}')
        except Exception:
            self.set_status(400)
            self.write(json.dumps({'ok': False, 'error': 'Invalid JSON payload'}))
            return

        # Closing the sockets touches Tornado's own objects, so it stays on the
        # IOLoop; reconfig must not do it from the worker thread.
        SocketHandler.close_all_ws()

        try:
            # reconfig tears every receiver down, waits for the old connections
            # to go away, then reconnects -- seconds of unavoidable waiting, and
            # on the IOLoop it froze the whole server for all of it (12s in one
            # captured log). Nothing in it touches Tornado state once the
            # websockets are closed above, so it belongs on a worker thread.
            await ioloop.IOLoop.current().run_in_executor(None, config.reconfig, payload)
        except Exception as exc:
            logger.exception('Failed to apply configuration update')
            self.set_status(500)
            self.write(json.dumps({'ok': False, 'error': 'Unable to apply configuration'}))
            return

        response = {
            'ok': True,
            'config': config.get_public_config_tree(),
            'discovery': config.get_discovery_settings(),
            'discovery_status': discover.get_dcid_status(),
        }
        self.write(json.dumps(response))

class GroupUpdateHandler(web.RequestHandler):
    def get(self):
        self.write("hi - group")

    def post(self):
        data = json.loads(self.request.body)
        config.update_group(data)
        logger.debug('Group update payload: %s', data)
        self.write(data)

class PcoSyncHandler(web.RequestHandler):
    def post(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        plan_override = self.get_query_argument('plan', default=None)
        dry_run = self.get_query_argument('dry_run', default='').lower() in ('1', 'true', 'yes')
        result = pco.sync_from_pco(plan_override, dry_run=dry_run)
        self.write(json.dumps(result))


class PcoPreviewHandler(web.RequestHandler):
    """Resolve the PCO mapping without writing anything to config.json."""

    def get(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        plan_override = self.get_query_argument('plan', default=None)
        self.write(json.dumps(pco.preview_sync(plan_override)))

    def post(self):
        self.get()


class PcoConfigHandler(web.RequestHandler):
    def get(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        payload = config.get_public_pco_config()
        self.write(json.dumps({"ok": True, "pco": payload}))

    def post(self):
        try:
            data = json.loads(self.request.body)
        except Exception:
            self.set_status(400)
            self.write('{"ok": false, "error": "Invalid JSON"}')
            return
        try:
            config.update_pco_config(data)
        except CredentialError as exc:
            self.set_status(400)
            self.set_header('Content-Type', 'application/json')
            self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            self.write(json.dumps({"ok": False, "error": str(exc)}))
            return
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        payload = config.get_public_pco_config()
        self.write(json.dumps({"ok": True, "pco": payload}))


class PcoServicesHandler(web.RequestHandler):
    def get(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        result = pco.list_service_types()
        self.write(json.dumps(result))


class PcoPlansHandler(web.RequestHandler):
    def get(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        service = self.get_query_argument('service', default=None)
        if service:
            result = pco.list_plans_for_service(service)
        else:
            result = pco.list_plans()
        self.write(json.dumps(result))


class PcoPeopleHandler(web.RequestHandler):
    def get(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        plan_id = self.get_query_argument('plan', default=None)
        if not plan_id:
            self.set_status(400)
            self.write('{"ok": false, "error": "Missing plan query param"}')
            return
        # service is no longer required; keep optional for backward compatibility
        service = self.get_query_argument('service', default=None)
        result = pco.list_people_for_plan(plan_id, service)
        self.write(json.dumps(result))


class PcoTeamsHandler(web.RequestHandler):
    def get(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        plan_id = self.get_query_argument('plan', default=None)
        if not plan_id:
            self.set_status(400)
            self.write('{"ok": false, "error": "Missing plan query param"}')
            return
        service = self.get_query_argument('service', default=None)
        result = pco.list_teams_for_plan(plan_id, service)
        self.write(json.dumps(result))


class PcoNotesHandler(web.RequestHandler):
    def get(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        plan_id = self.get_query_argument('plan', default=None)
        if not plan_id:
            self.set_status(400)
            self.write('{"ok": false, "error": "Missing plan query param"}')
            return
        source = self.get_query_argument('source', default=None)
        result = pco.notes_for_plan(plan_id, source_override=source)
        self.write(json.dumps(result))


class BackgroundDirectoryHandler(web.RequestHandler):
    def _set_headers(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')

    def get(self):
        self._set_headers()
        state = config.get_background_directory_state()
        self.write(json.dumps({'ok': True, 'backgrounds': state}))

    def post(self):
        self._set_headers()
        try:
            payload = json.loads(self.request.body or '{}')
        except Exception:
            self.set_status(400)
            self.write(json.dumps({'ok': False, 'error': 'Invalid JSON'}))
            return

        use_default = bool(payload.get('use_default'))
        directory = payload.get('directory')
        default_mode = payload.get('default_mode')

        try:
            state = config.set_background_directory(None if use_default else directory, default_mode=default_mode)
        except RuntimeError as exc:
            self.set_status(409)
            self.write(json.dumps({'ok': False, 'error': str(exc)}))
            return
        except ValueError as exc:
            self.set_status(400)
            self.write(json.dumps({'ok': False, 'error': str(exc)}))
            return

        self.write(json.dumps({'ok': True, 'backgrounds': state}))


class GoogleDriveConfigHandler(web.RequestHandler):
    def _set_headers(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')

    def get(self):
        self._set_headers()
        try:
            payload = google_drive.public_provider_state()
        except google_drive.DriveConfigError as exc:
            self.set_status(500)
            self.write(json.dumps({'ok': False, 'error': str(exc)}))
            return
        self.write(json.dumps({'ok': True, 'drive': payload}))

    def post(self):
        self._set_headers()
        try:
            data = json.loads(self.request.body or '{}')
        except Exception:
            self.set_status(400)
            self.write(json.dumps({'ok': False, 'error': 'Invalid JSON'}))
            return

        client_payload = data.get('client')
        if isinstance(client_payload, str):
            try:
                data['client'] = json.loads(client_payload)
            except json.JSONDecodeError:
                self.set_status(400)
                self.write(json.dumps({'ok': False, 'error': 'client configuration must be valid JSON'}))
                return

        try:
            config.update_google_drive_settings(data)
            payload = google_drive.public_provider_state()
        except ValueError as exc:
            self.set_status(400)
            self.write(json.dumps({'ok': False, 'error': str(exc)}))
            return
        except Exception as exc:  # noqa: BLE001
            logger.exception('Failed to update Google Drive settings')
            self.set_status(500)
            self.write(json.dumps({'ok': False, 'error': 'Unable to update Google Drive settings'}))
            return

        self.write(json.dumps({'ok': True, 'drive': payload}))


class GoogleDriveAuthStartHandler(web.RequestHandler):
    def _set_headers(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')

    def post(self):
        self._set_headers()
        try:
            payload = json.loads(self.request.body or '{}')
        except Exception:
            self.set_status(400)
            self.write(json.dumps({'ok': False, 'error': 'Invalid JSON'}))
            return

        redirect_uri = str(payload.get('redirect_uri') or '').strip()
        prompt = str(payload.get('prompt') or 'consent').strip() or 'consent'
        if not redirect_uri:
            self.set_status(400)
            self.write(json.dumps({'ok': False, 'error': 'redirect_uri is required'}))
            return

        try:
            flow_payload = google_drive.start_authorization_flow(redirect_uri, prompt=prompt)
            auth_state = google_drive.public_auth_state()
        except google_drive.DriveConfigError as exc:
            self.set_status(400)
            self.write(json.dumps({'ok': False, 'error': str(exc)}))
            return
        except google_drive.DriveCredentialError as exc:
            self.set_status(500)
            self.write(json.dumps({'ok': False, 'error': str(exc)}))
            return

        self.write(json.dumps({'ok': True, 'flow': flow_payload, 'auth': auth_state}))


class GoogleDriveAuthCompleteHandler(web.RequestHandler):
    def _set_headers(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')

    def post(self):
        self._set_headers()
        try:
            payload = json.loads(self.request.body or '{}')
        except Exception:
            self.set_status(400)
            self.write(json.dumps({'ok': False, 'error': 'Invalid JSON'}))
            return

        state = str(payload.get('state') or '').strip()
        code = str(payload.get('code') or '').strip()
        if not state or not code:
            self.set_status(400)
            self.write(json.dumps({'ok': False, 'error': 'state and code are required'}))
            return

        try:
            meta = google_drive.complete_authorization_flow(state, code)
        except google_drive.DriveCredentialError as exc:
            self.set_status(400)
            self.write(json.dumps({'ok': False, 'error': str(exc)}))
            return

        self.write(json.dumps({'ok': True, 'auth': meta.public_view()}))


class GoogleDriveAuthClearHandler(web.RequestHandler):
    def _set_headers(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')

    def post(self):
        self._set_headers()
        try:
            meta = google_drive.clear_credentials()
        except google_drive.DriveCredentialError as exc:
            self.set_status(500)
            self.write(json.dumps({'ok': False, 'error': str(exc)}))
            return

        self.write(json.dumps({'ok': True, 'auth': meta.public_view()}))


class GoogleDriveFilesHandler(web.RequestHandler):
    def _set_headers(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')

    def get(self):
        self._set_headers()

        page_size_arg = self.get_query_argument('page_size', default='100')
        try:
            page_size = int(page_size_arg)
        except (TypeError, ValueError):
            self.set_status(400)
            self.write(json.dumps({'ok': False, 'error': 'page_size must be an integer'}))
            return

        page_token = self.get_query_argument('page_token', default=None)
        folder_id = self.get_query_argument('folder', default=None)
        query = self.get_query_argument('query', default=None)
        order_by = self.get_query_argument('order_by', default='modifiedTime desc')

        try:
            listing = google_drive.list_media_files(
                page_size=page_size,
                page_token=page_token,
                folder_id=folder_id,
                query=query,
                order_by=order_by,
            )
        except google_drive.DriveCredentialError as exc:
            self.set_status(401)
            self.write(json.dumps({'ok': False, 'error': str(exc), 'auth': google_drive.public_auth_state()}))
            return
        except google_drive.DriveConfigError as exc:
            self.set_status(400)
            self.write(json.dumps({'ok': False, 'error': str(exc)}))
            return
        except google_drive.DriveApiError as exc:
            self.set_status(502)
            self.write(json.dumps({'ok': False, 'error': str(exc)}))
            return

        response = {
            'ok': True,
            'files': listing.get('files', []),
            'next_page_token': listing.get('next_page_token'),
            'query': listing.get('query'),
            'auth': google_drive.public_auth_state(),
        }
        self.write(json.dumps(response))


class GoogleDriveAuthLandingHandler(web.RequestHandler):
    def get(self):
        landing_path = config.app_dir('static/google-drive-auth.html')
        if not isinstance(landing_path, str) or landing_path is None or not os.path.exists(landing_path):
            self.set_status(404)
            self.write('Google Drive authorization landing page is unavailable.')
            return

        self.set_header('Content-Type', 'text/html; charset=utf-8')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        with open(landing_path, 'r', encoding='utf-8') as handle:
            self.write(handle.read())

# https://stackoverflow.com/questions/12031007/disable-static-file-caching-in-tornado
class NoCacheHandler(web.StaticFileHandler):
    def set_extra_headers(self, path):
        # Disable cache
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')


class RevalidatingStaticHandler(web.StaticFileHandler):
    """Static files the browser always asks about before reusing.

    Tornado sends no ``Cache-Control`` for static files, so browsers fall back
    to heuristic freshness and may reuse a bundle without asking whether it is
    still current. Across an application upgrade that is silently wrong: the
    server renders the new markup while the script and stylesheet come from the
    previous version's cache, and reloading does not help because the browser
    never asks.

    Upgrading 1.4.8 to 1.5.0 did exactly that. The new demo.html rendered a team
    chooser and a service-type selector that the cached script had never heard
    of, so the chooser stayed permanently empty, plan labels kept their old
    format, and the panel wore the previous stylesheet -- three separate
    "1.5.0 is broken" symptoms from one stale file.

    ``no-cache`` is not ``no-store``: the copy is kept and revalidated, so an
    unchanged bundle still costs only a 304.
    """

    def set_extra_headers(self, path):
        self.set_header('Cache-Control', 'no-cache')


class SourceCheckoutStaticHandler(RevalidatingStaticHandler):
    """Also re-hash per request, because in a checkout the bundle changes.

    Tornado caches each file's content hash in a class-level dict for the life
    of the process (``StaticFileHandler._static_hashes``) and never invalidates
    it, because a deployed app's static files do not change underneath it. In a
    checkout they do, on every ``npm run build``.

    A server started before a rebuild therefore keeps answering ``304 Not
    Modified`` against the hash it captured at startup, and the browser goes on
    running the bundle it already had -- through a hard reload, and in a new
    tab, because the validator still matches. ``curl`` sends no validator, so it
    reads from disk and shows the new bytes: the file, the build and the served
    response all look correct while the page is stale, which is a slow thing to
    work out.

    Recomputing per request does not disable caching; it makes the conditional
    request tell the truth. Packaged builds keep the cached hash -- their bundle
    cannot change while the app runs, so re-hashing every request would be pure
    waste.
    """

    def compute_etag(self):
        if self.absolute_path is None:
            return None
        try:
            version = self.get_content_version(self.absolute_path)
        except Exception:  # noqa: BLE001 - matches Tornado's own tolerance here
            logger.debug('Could not hash static file %s', self.absolute_path)
            return None
        return '"{}"'.format(version) if version else None


def static_file_handler():
    """Both builds revalidate; only a checkout also needs to re-hash.

    A packaged bundle cannot change while the app runs, so its hash is safe to
    cache for the process -- but it *does* change when the user upgrades, which
    is why revalidation is not optional there either.
    """
    if getattr(sys, 'frozen', False):
        return RevalidatingStaticHandler
    return SourceCheckoutStaticHandler


class BackgroundAssetHandler(NoCacheHandler):
    @classmethod
    def get_absolute_path(cls, root, path):
        dynamic_root = config.get_gif_dir()
        return super(BackgroundAssetHandler, cls).get_absolute_path(dynamic_root, path)


def twisted():
    app = web.Application([
        (r'/', IndexHandler),
        (r'/about', AboutHandler),
        (r'/ws', SocketHandler),
        (r'/data.json', JsonHandler),
        (r'/api/group', GroupUpdateHandler),
        (r'/api/slot', SlotHandler),
        (r'/api/slot/device-names/clear', SlotDeviceNamesClearHandler),
        (r'/api/slot/device-names', SlotDeviceNamesHandler),
    (r'/api/logs/settings', LogSettingsHandler),
    (r'/api/logs/purge', LogsPurgeHandler),
    (r'/api/logs', LogsHandler),
        (r'/api/config', ConfigHandler),
        (r'/api/pco/sync', PcoSyncHandler),
        (r'/api/pco/preview', PcoPreviewHandler),
        (r'/api/pco/config', PcoConfigHandler),
        (r'/api/pco/services', PcoServicesHandler),
        (r'/api/pco/plans', PcoPlansHandler),
        (r'/api/pco/people', PcoPeopleHandler),
        (r'/api/pco/teams', PcoTeamsHandler),
        (r'/api/pco/notes', PcoNotesHandler),
        (r'/api/backgrounds', BackgroundDirectoryHandler),
        (r'/api/cloud/google-drive/config', GoogleDriveConfigHandler),
        (r'/api/cloud/google-drive/auth/start', GoogleDriveAuthStartHandler),
        (r'/api/cloud/google-drive/auth/complete', GoogleDriveAuthCompleteHandler),
        (r'/api/cloud/google-drive/auth/clear', GoogleDriveAuthClearHandler),
        (r'/api/cloud/google-drive/files', GoogleDriveFilesHandler),
        (r'/oauth/google-drive', GoogleDriveAuthLandingHandler),
        (r'/static/(.*)', static_file_handler(), {'path': config.app_dir('static')}),
        (r'/bg/(.*)', BackgroundAssetHandler, {'path': ''}),
    ])
    # https://github.com/tornadoweb/tornado/issues/2308
    asyncio.set_event_loop(asyncio.new_event_loop())
    app.listen(config.web_port())
    ioloop.PeriodicCallback(SocketHandler.ws_dump, 50).start()
    ioloop.IOLoop.instance().start()
