import time
import queue
import socket
from collections import defaultdict
import logging

import vendor
from iem import IEM
from mic import WirelessMic

logger = logging.getLogger('micboard.device')


class ShureNetworkDevice:
    """One receiver on the network.

    ⭐ Holds no protocol knowledge of its own any more: the port, the grammar,
    the commands and the framing all come from `self.adapter`, which
    `py/vendor.py` picks from the device type (#91). The class keeps its name
    for now because renaming it touches every caller and would bury this change
    in churn; it is no longer accurate and is worth fixing separately.
    """

    def __init__(self, ip, type):
        self.ip = ip
        self.type = type
        self.channels = []
        self.rx_com_status = 'DISCONNECTED'
        # When it last stopped answering; None while it is answering or never has.
        self._dropped_at = None
        self.writeQueue = queue.Queue()
        self.f = None
        self.socket_watchdog = int(time.perf_counter())
        self.raw = defaultdict(dict)
        self.adapter = vendor.adapter_for(type)

    def socket_connect(self):
        try:
            if self.adapter.transport(self.type) == 'TCP':
                self.f = socket.socket(socket.AF_INET, socket.SOCK_STREAM) #TCP
                self.f.settimeout(.2)
                self.f.connect((self.ip, self.adapter.PORT))


            elif self.adapter.transport(self.type) == 'UDP':
                self.f = socket.socket(socket.AF_INET, socket.SOCK_DGRAM) #UDP

            self.set_rx_com_status('CONNECTING')
            self.enable_metering(.1)

            for string in self.get_all():
                self.writeQueue.put(string)
        except socket.error as e:
            self.set_rx_com_status('DISCONNECTED')

        self.socket_watchdog = int(time.perf_counter())


    def socket_disconnect(self):
        if self.f is not None:
            self.f.close()
            self.f = None
        self.set_rx_com_status('DISCONNECTED')
        self.socket_watchdog = int(time.perf_counter())


    def fileno(self):
        if self.f is None:
            raise RuntimeError('Socket is not connected')
        return self.f.fileno()

    def set_rx_com_status(self, status):
        """Record the link state, and say so when the receiver comes or goes.

        ⛔⛔ This used to be a bare assignment, so a receiver dropping out in the
        middle of a service left nothing behind: the log's `device` source was
        empty on the venue board after five days. Afterwards, nobody could say
        whether a pack or a receiver had gone.

        ⚠️ Transitions only. `CONNECTED` is set again on every packet read, and
        a receiver that is switched off fails to connect every twenty seconds;
        neither is news. What is logged is answering -> not answering, and back.
        """
        previous = self.rx_com_status
        self.rx_com_status = status
        if status == previous:
            return
        if status == 'CONNECTED':
            if getattr(self, "_dropped_at", None) is not None:
                logger.info('Receiver %s (%s) is answering again after %ds',
                            self.ip, self.type, int(time.monotonic() - self._dropped_at))
                self._dropped_at = None
            else:
                logger.info('Receiver %s (%s) connected', self.ip, self.type)
        elif previous == 'CONNECTED':
            self._dropped_at = time.monotonic()
            logger.warning('Receiver %s (%s) stopped answering', self.ip, self.type)

    def add_channel_device(self, cfg):
        if self.adapter.device_class(self.type) == 'WirelessMic':
            self.channels.append(WirelessMic(self, cfg))
        elif self.adapter.device_class(self.type) == 'IEM':
            self.channels.append(IEM(self, cfg))

    def get_device_by_channel(self, channel):
        return next((x for x in self.channels if x.channel == int(channel)), None)

    def parse_raw_rx(self, data):
        self.adapter.parse(self, data)

    def get_channels(self):
        channels = []
        for channel in self.channels:
            channels.append(channel.channel)
        return channels

    def get_all(self):
        return self.adapter.get_all(self.type, self.get_channels())

    def get_query_strings(self):
        return self.adapter.query(self.type, self.get_channels())

    def enable_metering(self, interval):
        for command in self.adapter.meter_start(self.type, self.get_channels(), interval):
            self.writeQueue.put(command)

    def disable_metering(self):
        for command in self.adapter.meter_stop(self.type, self.get_channels()):
            self.writeQueue.put(command)

    def net_json(self):
        ch_data = []
        for channel in self.channels:
            data = channel.ch_json()
            if self.rx_com_status == 'DISCONNECTED':
                data['status'] = 'RX_COM_ERROR'
            ch_data.append(data)
        data = {
            'ip': self.ip, 'type': self.type, 'status': self.rx_com_status,
            'raw': self.raw, 'tx': ch_data
        }
        return data
