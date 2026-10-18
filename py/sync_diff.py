"""What a sync would do to the board, slot by slot (#120).

The panel already had a preview, and it answered the wrong question. It listed
the *Planning Center* side -- position, person, team, which slots matched --
which tells an operator what the plan says. What they are about to agree to is
a change to **their board**, and the one thing the preview never showed was who
is on each slot right now.

So this restates the same resolution the other way round: one row per slot,
what is on it, what would be on it, and why.

⛔ Built from the live slot dicts **before anything writes to them**. The same
trap as `clearable` in `finish_sync`: read them afterwards and every "from"
comes back as the value that was just written, so the diff would agree with
itself and tell the operator nothing.
"""

from typing import Any, Dict, Iterable, List, Optional, Set

# In the order a person reads them: what changes first, what does not last.
ACTIONS = ('skipped', 'change', 'assign', 'clear', 'unchanged')

# ⚠️ `skipped` is not a change and not a non-change -- it is the sync declining
# to guess. It sorts first because it is the only row that wants someone to do
# something before the service.
CHANGING = ('skipped', 'change', 'assign', 'clear')


def _name(value: Any) -> str:
    return (value or '').strip() if isinstance(value, str) else ''


def _claimants_by_slot(conflicts: Optional[Iterable[Dict[str, Any]]]) -> Dict[Any, List[str]]:
    out: Dict[Any, List[str]] = {}
    for conflict in conflicts or []:
        names = sorted({
            _name(c.get('name')) for c in (conflict.get('claimants') or []) if _name(c.get('name'))
        })
        out[conflict.get('slot')] = names
    return out


def _multi_position_by_slot(
    entries: Optional[Iterable[Dict[str, Any]]],
) -> Dict[Any, Dict[str, Any]]:
    """Slot number -> the person holding several positions, and which ones."""
    out: Dict[Any, Dict[str, Any]] = {}
    for entry in entries or []:
        positions = [
            p.get('position') or p.get('label') or ''
            for p in entry.get('positions') or []
        ]
        for number in entry.get('slots') or []:
            if number is None:
                continue
            out[number] = {
                'name': entry.get('name') or '',
                'positions': [p for p in positions if p],
            }
    return out


def build_changes(
    resolved: Optional[Iterable[Dict[str, Any]]] = None,
    stale: Optional[Iterable[Dict[str, Any]]] = None,
    conflicts: Optional[Iterable[Dict[str, Any]]] = None,
    skip_slots: Optional[Set] = None,
    multi_position: Optional[Iterable[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """One row per slot the sync touches, in reading order.

    ``resolved`` and ``stale`` are the structures `finish_sync` already has;
    ``skip_slots`` is what `_apply_assignments` will refuse to write.

    ⛔ A slot is skipped for one of two reasons and the row has to say which.
    Contested means several people claim it; multi-position means one person
    claims several (#260). A row that only says "skipped" sends an operator
    looking for the wrong thing, and the reader downstream used to assume the
    contested case and phrase every skip as "claimed by two people" -- which is
    simply false for the other one.
    """
    skip = set(skip_slots or ())
    claimants = _claimants_by_slot(conflicts)
    held = _multi_position_by_slot(multi_position)
    rows: List[Dict[str, Any]] = []
    seen = set()

    for entry in resolved or []:
        incoming = _name(entry.get('name'))
        for match in entry.get('_matches') or []:
            slot = match.get('slot') or {}
            number = slot.get('slot')
            current = _name(slot.get('extended_name'))

            if number in skip:
                action = 'skipped'
            elif current == incoming:
                action = 'unchanged'
            elif current:
                action = 'change'
            else:
                action = 'assign'

            rows.append({
                'slot': number,
                'from': current,
                # ⛔ A skipped slot keeps whatever it has. Reporting the person
                # the sync *would* have written implies it is going to, and a
                # contested slot is precisely the one nobody should trust.
                'to': current if action == 'skipped' else incoming,
                'action': action,
                'position': _name(entry.get('position')),
                'team': _name(entry.get('team')),
                'matched_via': _name(entry.get('matched_via')),
                'describe': slot.get('describe') or '',
                'claimants': claimants.get(number, []),
                'skip_reason': (
                    ('contested' if number in claimants else 'multi-position')
                    if action == 'skipped' else ''
                ),
                # The other positions the same person holds, so the row can say
                # what the operator actually has to decide.
                'held_by': held.get(number, {}),
            })
            seen.add(number)

    for slot in stale or []:
        number = slot.get('slot')
        if number in seen:
            # Belt and braces: a slot that was matched is never also cleared,
            # but a row claiming both would be the worst kind of wrong.
            continue
        rows.append({
            'slot': number,
            'from': _name(slot.get('extended_name')),
            'to': '',
            'action': 'clear',
            'position': '',
            'team': '',
            'matched_via': '',
            'describe': '',
            'claimants': [],
            'skip_reason': '',
            'held_by': {},
        })

    order = {action: i for i, action in enumerate(ACTIONS)}
    rows.sort(key=lambda row: (order.get(row['action'], 99), _slot_key(row['slot'])))
    return rows


def _slot_key(number: Any) -> Any:
    try:
        return (0, int(number))
    except (TypeError, ValueError):
        # A slot number that is not a number still has to sort somewhere
        # rather than raise in the middle of building a preview.
        return (1, str(number))


def changed(rows: Optional[Iterable[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """Only the rows that are not "already correct"."""
    return [row for row in rows or [] if row.get('action') in CHANGING]


def counts(rows: Optional[Iterable[Dict[str, Any]]]) -> Dict[str, int]:
    """How many of each, including the actions with none, so a caller can
    print a stable summary rather than branching on absence."""
    out = {action: 0 for action in ACTIONS}
    for row in rows or []:
        action = row.get('action')
        if action in out:
            out[action] += 1
    return out


def is_noop(rows: Optional[Iterable[Dict[str, Any]]]) -> bool:
    """⭐ Nothing would change.

    Worth saying outright: "0 updates" alongside a table of twelve rows reads
    like a failure, when it usually means the board is already right.
    """
    return not changed(rows)
