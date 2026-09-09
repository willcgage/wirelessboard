"""Pure read-only helpers for Sennheiser SSCv2 responses.

The transport adapter is intentionally not registered yet: EW-DX hardware or a
capture is still required before making network behaviour part of the board.
These helpers keep the documented JSON-to-board mapping deterministic and easy
to test without contacting a receiver.
"""

from typing import Any, Dict, Optional


def _number(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_battery(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Return the common battery fields used by WirelessBoard.

    SSCv2 reports a percentage gauge and minutes of lifetime, unlike Shure's
    five-bar value.  Preserve both units rather than inventing a bar count.
    """
    gauge = _number(payload.get('gauge'))
    lifetime = _number(payload.get('lifetime'))
    result: Dict[str, Any] = {
        'battery_percent': int(gauge) if gauge is not None else None,
        'battery_minutes': int(lifetime) if lifetime is not None else None,
        'battery_type': payload.get('type'),
    }
    return result


def normalize_channel(
    channel: Dict[str, Any],
    battery: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Map documented EW-DX channel resources to a vendor-neutral record."""
    result: Dict[str, Any] = {
        'name_raw': channel.get('name', ''),
        'rf_level': channel.get('signalStrengthIndicator', {}).get('value'),
        'audio_level': channel.get('level', {}).get('value'),
        'quality': channel.get('signalQualityIndicator', {}).get('value'),
        'antenna': channel.get('diversityIndicator', {}).get('value'),
        'frequency': channel.get('frequency', {}).get('value'),
    }
    if battery is not None:
        result.update(normalize_battery(battery))
    return result
