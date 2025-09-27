import json
import os
import asyncio
import socket
import logging
from typing import Any, cast

from tornado import websocket, web, ioloop, escape

import shure
import config as config_module
import discover
import offline
import pco

config = cast(Any, config_module)


# https://stackoverflow.com/questions/5899497/checking-file-extension
def file_list(extension):
    files = []
    dir_list = os.listdir(config.get_gif_dir())
    # print(fileList)
    for file in dir_list:
        if file.lower().endswith(extension):
            files.append(file)
    return files

# Its not efficecent to get the IP each time, but for now we'll assume server might have dynamic IP
def localURL():
    if 'local_url' in config.config_tree:
        return config.config_tree['local_url']
    try:
        ip = socket.gethostbyname(socket.gethostname())
        return 'http://{}:{}'.format(ip, config.config_tree['port'])
    except:
        return 'https://github.com/willcgage/wirelessboard'
    return 'https://github.com/willcgage/wirelessboard'

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
        'receivers': data, 'url': url, 'gif': gifs, 'jpg': jpgs, 'mp4': mp4s,
        'config': config.config_tree, 'discovered': discovered
    }, sort_keys=True, indent=4)


def micboard_json(network_devices):
    """Legacy alias for compatibility."""
    return wirelessboard_json(network_devices)

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
            except:
                logging.warning("WS Error")

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
            print(slot_update)


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

class ConfigHandler(web.RequestHandler):
    def get(self):
        self.write("hi - slot")

    def post(self):
        data = json.loads(self.request.body)
        print(data)
        self.write('{}')
        config.reconfig(data)

class GroupUpdateHandler(web.RequestHandler):
    def get(self):
        self.write("hi - group")

    def post(self):
        data = json.loads(self.request.body)
        config.update_group(data)
        print(data)
        self.write(data)

class WirelessboardReloadConfigHandler(web.RequestHandler):
    def post(self):
        print("RECONFIG")
        config.reconfig(config.config_tree.get("slots", []))
        self.write("restarting")

class MicboardReloadConfigHandler(WirelessboardReloadConfigHandler):
    """Legacy alias for compatibility with prior imports."""
    pass


class PcoSyncHandler(web.RequestHandler):
    def post(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        plan_override = self.get_query_argument('plan', default=None)
        result = pco.sync_from_pco(plan_override)
        self.write(json.dumps(result))


class PcoConfigHandler(web.RequestHandler):
    def get(self):
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        pco_cfg = config.config_tree.get('pco') or {}
        self.write(json.dumps({"ok": True, "pco": pco_cfg}))

    def post(self):
        try:
            data = json.loads(self.request.body)
        except Exception:
            self.set_status(400)
            self.write('{"ok": false, "error": "Invalid JSON"}')
            return
        config.update_pco_config(data)
        self.set_header('Content-Type', 'application/json')
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.write('{"ok": true}')


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

# https://stackoverflow.com/questions/12031007/disable-static-file-caching-in-tornado
class NoCacheHandler(web.StaticFileHandler):
    def set_extra_headers(self, path):
        # Disable cache
        self.set_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')


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
        (r'/api/config', ConfigHandler),
        (r'/api/pco/sync', PcoSyncHandler),
        (r'/api/pco/config', PcoConfigHandler),
        (r'/api/pco/services', PcoServicesHandler),
        (r'/api/pco/plans', PcoPlansHandler),
        (r'/api/pco/people', PcoPeopleHandler),
    # (r'/restart/', WirelessboardReloadConfigHandler),
        (r'/static/(.*)', web.StaticFileHandler, {'path': config.app_dir('static')}),
        (r'/bg/(.*)', NoCacheHandler, {'path': config.get_gif_dir()})
    ])
    # https://github.com/tornadoweb/tornado/issues/2308
    asyncio.set_event_loop(asyncio.new_event_loop())
    app.listen(config.web_port())
    ioloop.PeriodicCallback(SocketHandler.ws_dump, 50).start()
    ioloop.IOLoop.instance().start()
