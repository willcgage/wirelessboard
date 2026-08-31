BASE_CONST = {}


BASE_CONST['uhfr'] = {
    'DEVICE_CLASS' : 'WirelessMic',
    'PROTOCOL': 'UDP',
    'ch_const' : {
        'battery': 'TX_BAT',
        'quality': 'NOTSUPPORTED',
        'frequency': 'FREQUENCY',
        'name': 'CHAN_NAME',
        'tx_offset': 'NOTQWERT',
        'power_lock': 'NOTQWERT',
        'runtime' : 'NOTQWERT',
    },
    'base_const': {
        'getAll' : [
            '* GET {} CHAN_NAME *',
            '* GET {} BATT_BARS *',
            '* GET {} GROUP_CHAN *'
        ],
        'query' : [
            '* GET {} CHAN_NAME *',
            '* GET {} TX_BAT *',
            '* GET {} GROUP_CHAN *'
        ],
        'meter_stop' : '* METER {} ALL STOP *'
    },
    'DCID_MODEL' : {
        'UR4S' : 1,
        'UR4D' : 2,
    }
}

BASE_CONST['qlxd'] = {
    'DEVICE_CLASS' : 'WirelessMic',
    'PROTOCOL' : 'TCP',
    'ch_const' : {
        'battery': 'BATT_BARS',
        'quality': 'NOTSUPPOTTED',
        'frequency': 'FREQUENCY',
        'audio_level': 'AUDIO_LVL',
        'rf_level': 'RX_RF_LVL',
        'name': 'CHAN_NAME',
        'antenna': 'RF_ANTENNA',
        'tx_offset' : 'TX_OFFSET',
        'power_lock': 'TX_PWR_LOCK',
        'runtime' : 'BATT_RUN_TIME',
        },
    'base_const' : {
        'getAll' : ['< GET {} ALL >'],
        'query' : [
            '< GET {} CHAN_NAME >',
            '< GET {} BATT_BARS >'
        ],
        'meter_stop' : '< SET {} METER_RATE 0 >'
    },
    'DCID_MODEL' : {
        'QLX-DSingle' : 1,
        'QLX-D1GSingle' : 1,
        'QLX-DIsmSingle' : 1,
    }

}

BASE_CONST['ulxd'] = {
    'DEVICE_CLASS' : 'WirelessMic',
    'PROTOCOL': 'TCP',
    'ch_const' : {
        'battery': 'BATT_BARS',
        'quality': 'NOT_SUPPORTED',
        'frequency': 'FREQUENCY',
        'audio_level': 'AUDIO_LVL',
        'rf_level': 'RX_RF_LVL',
        'name': 'CHAN_NAME',
        'antenna': 'RF_ANTENNA',
        'tx_offset' : 'TX_OFFSET',
        'power_lock': 'TX_PWR_LOCK',
        'runtime' : 'BATT_RUN_TIME',
    },
    'base_const': {
        'getAll' : ['< GET {} ALL >'],
        'query' : [
            '< GET {} CHAN_NAME >',
            '< GET {} BATT_BARS >'
        ],
        'meter_stop' : '< SET {} METER_RATE 0 >'
    },
    'DCID_MODEL' : {
        'ULX-DSingle': 1,
        'ULX-D1GSingle' : 1,
        'ULX-DIsmSingle' : 1,
        'ULX-DDual': 2,
        'ULX-D1GDual' : 2,
        'ULX-DIsmDual' : 2,
        'ULX-DQuad': 4,
        'ULX-D1GQuad' : 4,
        'ULX-DIsmQuad' : 4,
    }
}

BASE_CONST['axtd'] = {
    'DEVICE_CLASS' : 'WirelessMic',
    'PROTOCOL': 'TCP',
    'ch_const' : {
        'battery': 'TX_BATT_BARS',
        'quality': 'CHAN_QUALITY',
        'frequency': 'FREQUENCY',
        'audio_level': 'AUDIO_LEVEL_RMS',
        'rf_level': 'RSSI',
        'name': 'CHAN_NAME',
        'antenna': 'ANTENNA_STATUS',
        'tx_offset': 'TX_OFFSET',
        'power_lock': 'TX_LOCK',
        'runtime' : 'TX_BATT_MINS',
    },
    'base_const' : {
        'getAll' : ['< GET {} ALL >'],
        'query' : [
            '< GET {} CHAN_NAME >',
            '< GET {} TX_BATT_BARS >'
        ],
        'meter_stop' : '< SET {} METER_RATE 0 >'
    },
    'DCID_MODEL' : {
        'AD4D': 2,
        'AD4Q': 4,
    }
}

# SLX-D and SLX-D+ speak the same command grammar as ULX-D on the same port, but
# report a different set of properties and -- the trap -- a different SAMPLE
# layout. See `parse_sample` in mic.py.
#
# ⛔ Neither reports antenna/diversity, channel quality, TX offset or power lock:
# those properties simply do not exist in their command set, so the card's info
# drawer will show less for these than for a ULX-D. That is the device, not a
# gap in this table.
#
# ⚠️ SLX-D blocks third-party command strings **by default**. The operator has to
# allow them in Advanced Settings > Controller Access or the receiver will
# connect and then answer nothing.
#
# Documented at https://www.shure.com/en-US/docs/commandstrings/SLXD
_SLXD_CH_CONST = {
    'battery': 'TX_BATT_BARS',      # 000-005, 255 unknown -- same semantics as ULX-D bars
    'runtime': 'TX_BATT_MINS',      # 00000-65532 minutes; 65533/4/5 are warning/calculating/unknown
    'name': 'CHAN_NAME',            # SET takes 8 chars; the device always REPs 31, space padded
    'frequency': 'FREQUENCY',
    'audio_level': 'AUDIO_LEVEL_RMS',
    'rf_level': 'RSSI',
    'quality': 'NOTSUPPORTED',
    'antenna': 'NOTSUPPORTED',
    'tx_offset': 'NOTSUPPORTED',
    'power_lock': 'NOTSUPPORTED',
}

_SLXD_BASE_CONST = {
    'getAll': ['< GET {} ALL >'],
    'query': [
        '< GET {} CHAN_NAME >',
        '< GET {} TX_BATT_BARS >'
    ],
    # 5 digits, as the SLX-D documentation writes it.
    'meter_stop': '< SET {} METER_RATE 00000 >'
}

BASE_CONST['slxd'] = {
    'DEVICE_CLASS': 'WirelessMic',
    'PROTOCOL': 'TCP',
    'ch_const': dict(_SLXD_CH_CONST),
    'base_const': dict(_SLXD_BASE_CONST),
    # ⏳ Empty on purpose: the DCID model strings a real SLX-D announces are not
    # known, and guessing them would make discovery claim receivers it cannot
    # drive. Add to a slot by IP until one has been seen on a network.
    'DCID_MODEL': {}
}

# Separate type because it is a separate product (the Make/Model design in #91
# treats `type` as the model). Identical for everything the board reads today;
# SLX-D+ additionally exposes encryption, interference and link properties, and
# goes up to four channels where SLX-D has two.
BASE_CONST['slxdplus'] = {
    'DEVICE_CLASS': 'WirelessMic',
    'PROTOCOL': 'TCP',
    'ch_const': dict(_SLXD_CH_CONST),
    'base_const': dict(_SLXD_BASE_CONST),
    'DCID_MODEL': {}
}

BASE_CONST['p10t'] = {
    'DEVICE_CLASS' : 'IEM',
    'PROTOCOL': 'TCP',
    'ch_const' : {
        'frequency': 'FREQUENCY',
        'audio_level_l': 'AUDIO_IN_LVL_L',
        'audio_level_r': 'AUDIO_IN_LVL_R',
        'name': 'CHAN_NAME',
        'tx_offset': 'TX_OFFSET'
    },
    'base_const' : {
        'getAll' : [
            '< GET {} CHAN_NAME >\r\n',
            '< GET {} FREQUENCY >\r\n'
        ],
        'query' : ['< GET {} CHAN_NAME >\r\n'],
        'meter_stop' : '< SET {} METER_RATE 0 >'
    },
    'DCID_MODEL' : {
        'PSM1KTx': 2,
    }
}
