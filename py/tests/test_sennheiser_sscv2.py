from sennheiser_sscv2 import normalize_battery, normalize_channel


def test_normalize_battery_preserves_percent_and_minutes():
    assert normalize_battery({'type': 'Battery', 'gauge': 73, 'lifetime': 245}) == {
        'battery_percent': 73,
        'battery_minutes': 245,
        'battery_type': 'Battery',
    }


def test_normalize_channel_joins_battery_resource():
    result = normalize_channel(
        {
            'name': 'HOST 1',
            'signalStrengthIndicator': {'value': 81},
            'level': {'value': -12.5},
            'signalQualityIndicator': {'value': 99},
            'diversityIndicator': {'value': 'A'},
            'frequency': {'value': 606.2},
        },
        {'type': 'PrimaryCell', 'gauge': 44, 'lifetime': 90},
    )
    assert result == {
        'name_raw': 'HOST 1',
        'rf_level': 81,
        'audio_level': -12.5,
        'quality': 99,
        'antenna': 'A',
        'frequency': 606.2,
        'battery_percent': 44,
        'battery_minutes': 90,
        'battery_type': 'PrimaryCell',
    }


def test_missing_optional_resources_are_safe():
    assert normalize_channel({'name': 'EMPTY'}) == {
        'name_raw': 'EMPTY',
        'rf_level': None,
        'audio_level': None,
        'quality': None,
        'antenna': None,
        'frequency': None,
    }
