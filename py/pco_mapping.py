"""Pure helpers that map Planning Center assignments onto Wirelessboard slots.

Planning Center schedules each person to a *team position* whose name carries the
mic name and number -- for example team ``Vocal`` with positions ``Vocal 1``,
``Vocal 2``.  A single position frequently corresponds to more than one
Wirelessboard slot: ``Vocal 1`` is both the handheld/beltpack receiver channel
("Mic 1") and the matching PSM1000 IEM channel ("IEM 1").

This module holds the matching rules only.  It performs no network calls and
reads no global config, so every rule below is unit-testable in isolation.
"""

import re
from typing import Any, Dict, Iterable, List, Optional, Tuple

# Shure receiver types that carry a wireless microphone / bodypack channel.
MIC_SLOT_TYPES = frozenset({'uhfr', 'qlxd', 'ulxd', 'axtd'})

# Shure PSM1000 transmitter -- an in-ear monitor channel.
IEM_SLOT_TYPES = frozenset({'p10t'})

# Words that appear on Wirelessboard slot labels to describe the *device* rather
# than the person's role, mapped to the kind of slot they imply.  Used only by
# the number fallback, so that PCO position "Vocal 1" can still line up with
# slots a user labelled "Mic 1" and "IEM 1".
DEVICE_WORDS: Dict[str, str] = {
    'mic': 'mic',
    'mics': 'mic',
    'microphone': 'mic',
    'microphones': 'mic',
    'hh': 'mic',
    'handheld': 'mic',
    'bp': 'mic',
    'beltpack': 'mic',
    'pack': 'mic',
    'tx': 'mic',
    'ch': 'mic',
    'channel': 'mic',
    'wireless': 'mic',
    'iem': 'iem',
    'iems': 'iem',
    'ear': 'iem',
    'ears': 'iem',
    'inear': 'iem',
    'psm': 'iem',
    'monitor': 'iem',
    'monitors': 'iem',
}

# Slot fields consulted when looking for a label, in priority order.
EXTENDED_ID_FIELD = 'extended_id'
DEVICE_NAME_FIELDS = ('chan_name', 'name', 'chan_name_raw', 'name_raw')

_NON_ALNUM = re.compile(r'[^a-z0-9]+')
_TRAILING_NUMBER = re.compile(r'^(.*?)(\d+)$')


def normalize_label(value: Any) -> str:
    """Case-fold a label and collapse punctuation/whitespace to single spaces.

    ``"Vocal-01 "`` and ``"vocal 01"`` both normalize to ``"vocal 01"`` so that
    cosmetic differences between Planning Center and the Shure hardware do not
    break matching.
    """
    if value is None:
        return ''
    text = str(value).strip().lower()
    if not text:
        return ''
    return _NON_ALNUM.sub(' ', text).strip()


def split_label(value: Any) -> Tuple[str, Optional[int]]:
    """Split a label into its word prefix and trailing number.

    ``"Vocal 1"`` -> ``("vocal", 1)``; ``"IEM"`` -> ``("iem", None)``;
    ``"4"`` -> ``("", 4)``.  Leading zeros are discarded so ``"Mic 01"`` and
    ``"Mic 1"`` compare equal.
    """
    normalized = normalize_label(value)
    if not normalized:
        return ('', None)
    match = _TRAILING_NUMBER.match(normalized)
    if not match:
        return (normalized, None)
    prefix, digits = match.group(1).strip(), match.group(2)
    try:
        number = int(digits)
    except ValueError:  # pragma: no cover - \d+ is always parseable
        return (normalized, None)
    return (prefix, number)


def device_kind_for_prefix(prefix: str) -> Optional[str]:
    """Return ``'mic'``/``'iem'`` when a label prefix names a device kind."""
    if not prefix:
        return None
    words = prefix.split()
    for word in reversed(words):
        kind = DEVICE_WORDS.get(word)
        if kind:
            return kind
    return None


def slot_kind(slot: Dict[str, Any]) -> Optional[str]:
    """Classify a slot as a mic or IEM channel from its configured type."""
    slot_type = str(slot.get('type') or '').strip().lower()
    if slot_type in IEM_SLOT_TYPES:
        return 'iem'
    if slot_type in MIC_SLOT_TYPES:
        return 'mic'
    return None


def slot_labels(slot: Dict[str, Any]) -> List[Tuple[str, str]]:
    """Return ``(field, label)`` pairs a slot can be recognised by."""
    labels: List[Tuple[str, str]] = []
    seen = set()
    fields = (EXTENDED_ID_FIELD,) + DEVICE_NAME_FIELDS
    for field in fields:
        label = normalize_label(slot.get(field))
        if label and label not in seen:
            seen.add(label)
            labels.append((field, label))
    return labels


def slot_describe(slot: Dict[str, Any]) -> str:
    """Human-readable slot identifier for previews and log messages."""
    parts = [f"slot {slot.get('slot')}"]
    slot_type = slot.get('type')
    if slot_type:
        parts.append(str(slot_type))
    for field in (EXTENDED_ID_FIELD,) + DEVICE_NAME_FIELDS:
        value = slot.get(field)
        if value:
            parts.append(f'"{value}"')
            break
    return ' '.join(parts)


def match_slots(
    label: Any,
    slots: Iterable[Dict[str, Any]],
    allow_number_fallback: bool = False,
) -> List[Dict[str, Any]]:
    """Find every slot a Planning Center position label refers to.

    A slot serves a *position*, not a team, so a position only auto-matches a
    slot whose own label says so.  Matching runs in three passes and stops at
    the first pass that produces a hit, so a precise match is never diluted by
    a fuzzy one:

    1. ``extended_id`` equals the label (the recommended, explicit setup).
    2. A device/channel name from the receiver equals the label.
    3. Number fallback, **off by default**: the label's trailing number matches
       the slot label's trailing number, and the slot's prefix either equals
       the label's prefix or is a recognised device word ("Mic 1"/"IEM 1" for
       position "Vocal 1").  When the prefix names a device kind, the slot's
       configured type has to agree.

    Pass 3 only holds up when a single team is scheduled.  Position labels are
    unique within a team, not across a plan, so "Vocal 1", "Guitar 1" and
    "Host 1" from three different teams all reduce to trailing number 1 and
    claim the same "Mic 1" slot.  It stays available for single-team setups but
    is no longer the default; anything the first two passes cannot place is
    left unmatched for the operator to assign by hand.

    Every match in the winning pass is returned, which is what lets one PCO
    position fill both a mic slot and an IEM slot -- label both channels with
    the position name and each gets picked up.
    """
    target = normalize_label(label)
    if not target:
        return []

    slot_list = [s for s in slots if isinstance(s, dict)]

    exact_ext: List[Dict[str, Any]] = []
    exact_device: List[Dict[str, Any]] = []
    for slot in slot_list:
        if normalize_label(slot.get(EXTENDED_ID_FIELD)) == target:
            exact_ext.append({'slot': slot, 'via': EXTENDED_ID_FIELD})
            continue
        for field in DEVICE_NAME_FIELDS:
            if normalize_label(slot.get(field)) == target:
                exact_device.append({'slot': slot, 'via': field})
                break

    if exact_ext:
        return exact_ext
    if exact_device:
        return exact_device
    if not allow_number_fallback:
        return []

    target_prefix, target_number = split_label(target)
    if target_number is None:
        return []

    fallback: List[Dict[str, Any]] = []
    for slot in slot_list:
        for field, label_text in slot_labels(slot):
            prefix, number = split_label(label_text)
            if number != target_number:
                continue
            kind = device_kind_for_prefix(prefix)
            if prefix != target_prefix and kind is None:
                continue
            if kind is not None:
                configured = slot_kind(slot)
                if configured is not None and configured != kind:
                    continue
            fallback.append({'slot': slot, 'via': f'number:{field}'})
            break

    return fallback


def plan_person_labels(
    person: Dict[str, Any],
    strategy: str = 'position_or_note',
) -> List[Tuple[str, str]]:
    """Return ``(source, label)`` candidates for one Planning Center person.

    ``person`` is a flattened dict with optional ``position``, ``note`` and
    ``bracket_id`` keys.  Candidates are ordered by the configured strategy;
    the caller tries each until one matches a slot.
    """
    position = (person.get('position') or '').strip()
    note = (person.get('note') or '').strip()
    bracket = (person.get('bracket_id') or '').strip()

    position_first = [('position', position), ('note', note), ('bracket', bracket)]
    note_first = [('note', note), ('bracket', bracket), ('position', position)]

    if strategy == 'position':
        ordered = [('position', position)]
    elif strategy == 'note_or_brackets':
        ordered = note_first
    else:  # 'position_or_note' and any future/unknown value
        ordered = position_first

    return [(source, value) for source, value in ordered if value]
