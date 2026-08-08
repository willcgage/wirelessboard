import time
import re
from collections import defaultdict
import logging

from device_config import BASE_CONST

logger = logging.getLogger('micboard.slot')

chart_update_list = []
data_update_list = []


class ChannelDevice:
    def __init__(self, rx, cfg):
        self.rx = rx
        self.cfg = cfg
        self.chan_name_raw = 'SLOT {}'.format(cfg['slot'])
        self.channel = cfg['channel']
        self.timestamp = time.time() - 60
        self.frequency = '000000'
        self.slot = cfg['slot']
        self.raw = defaultdict(dict)
        self.CHCONST = BASE_CONST[self.rx.type]['ch_const']


    def set_frequency(self, frequency):
        if self.rx.type == 'axtd':
            frequency = frequency.lstrip('0')
        self.frequency = frequency[:3] + '.' + frequency[3:]

    def set_chan_name_raw(self, chan_name):
        chan_name = chan_name.replace('_', ' ')
        self.chan_name_raw = chan_name

    def get_chan_name(self):
        name = self.chan_name_raw.split()
        prefix = re.match("([A-Za-z]+)?([-]?)([0-9])+", name[0])

        chan_id = ''
        chan_name = ''

        if prefix:
            chan_id = name[0]
            chan_name = ' '.join(name[1:])
        elif name[0] == 'IEM' and len(name[1]) == 1:
            chan_id = ' '.join(name[:2])
            chan_name = ' '.join(name[2:])
        else:
            chan_name = self.chan_name_raw

        # Who is on this channel beats what the transmitter is called. The
        # assignment only steps aside when there is positive evidence it has
        # gone stale -- a snapshot of the device name taken when it was made,
        # which no longer matches the hardware.
        #
        # This used to require that snapshot to be PRESENT before it would
        # apply the assignment at all, which meant a slot without one showed
        # the device name no matter who was assigned to it. Planning Center
        # never writes one -- _apply_assignments deliberately preserves the
        # hardware naming keys so a sync can never overwrite a channel label --
        # so every PCO-assigned person was displayed as their transmitter, and
        # the photo/video for a slot resolved to the device rather than to the
        # person. Absent evidence is not evidence.
        snapshot = self.cfg.get('chan_name_raw')
        repatched = (
            bool(snapshot)
            and snapshot != self.chan_name_raw
            # A channel still reporting its placeholder has not been re-patched;
            # it has not reported in yet, and dropping the assignment there
            # would lose it every time the board restarts.
            and 'SLOT' not in self.chan_name_raw
        )

        if not repatched:
            if self.cfg.get('extended_id'):
                chan_id = self.cfg['extended_id']
            if self.cfg.get('extended_name'):
                chan_name = self.cfg['extended_name']
        elif self.cfg.get('extended_id') or self.cfg.get('extended_name'):
            # Deliberately not deleted. This used to pop extended_id,
            # extended_name and the snapshot and then save -- from inside a
            # getter that ch_json calls, which every open board triggers every
            # five seconds. A transmitter renamed mid-service destroyed the
            # assignment on disk with no record of what it had been. Ignoring it
            # for display is enough; the operator's configuration is theirs.
            logger.info(
                'Slot %s is assigned to "%s" but its transmitter now reports "%s" '
                '(was "%s"); showing the device name until the assignment is '
                'updated.',
                self.slot, self.cfg.get('extended_name') or self.cfg.get('extended_id'),
                self.chan_name_raw, snapshot)

        return (chan_id, chan_name)

    def parse_raw_ch(self, data):
        split = data.split()
        self.raw[split[2]] = ' '.join(split[3:])

        try:
            if split[0] == 'SAMPLE' and split[2] == 'ALL':
                self.parse_sample(split)
                chart_update_list.append(self.chart_json())

            if split[0] in ['REP', 'REPLY', 'REPORT']:
                self.parse_report(split)

                if self not in data_update_list:
                    data_update_list.append(self)

        except Exception as e:
            print("Index Error(TX): {}".format(data.split()))
            print(e)
