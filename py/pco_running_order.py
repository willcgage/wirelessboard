"""When each item of a service was *meant* to happen (#121).

"End Item on Time" is the one of Planning Center's three timer modes this
board could not offer, because the other two are arithmetic on numbers it
already has and this one needs the whole running order: an item's scheduled
end is the service start plus every preceding item's length.

⛔ The point of the mode is that it is allowed to be negative. If the service
is running late, this item's scheduled end is already in the past and the
timer counts up in red -- which is exactly what Live does, and copying it
exactly is worth more than anything cleverer, because an operator who knows
Live reads it without being taught.

Pure on purpose: the fetching and caching are in `pco.py`, and this is the
part with the reasoning in it.
"""

from typing import Any, Dict, Iterable, List, Optional


def _seconds(value: Any) -> int:
    """An item's length.

    ⚠️ Missing reads as zero rather than unknown, and that is Planning Center's
    own meaning: a header has no duration and sits at the same moment as the
    item after it. Treating it as unknown would make every item below a header
    untimeable, which is most of a running order.
    """
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        return 0
    return seconds if seconds > 0 else 0


def build_schedule(
    items: Optional[Iterable[Dict[str, Any]]],
    starts_at: Optional[float],
) -> List[Dict[str, Any]]:
    """Each item with the clock time it was meant to start and end.

    ``items`` must already be in running order -- Planning Center returns them
    that way and reordering them here would invent a service nobody planned.

    ⛔ Returns nothing at all without a start time. Every value in here is the
    start plus an offset, so a missing start does not give approximate answers,
    it gives answers anchored to zero -- a timer counting down to 1970.
    """
    if starts_at is None:
        return []

    schedule: List[Dict[str, Any]] = []
    cursor = int(starts_at)
    for item in items or []:
        if not isinstance(item, dict):
            continue
        length = _seconds(item.get('length'))
        schedule.append({
            'id': str(item.get('id') or ''),
            'title': (item.get('title') or '').strip(),
            'length': length,
            'starts_at': cursor,
            'ends_at': cursor + length,
        })
        cursor += length
    return schedule


def scheduled_end_for(
    schedule: Optional[Iterable[Dict[str, Any]]],
    item_id: Optional[str],
) -> Optional[int]:
    """When this item should have finished, or None.

    ⚠️ None rather than a guess when the item is not in the schedule. An item
    added to the running order after this was cached is exactly the case, and a
    timer that quietly fell back to another mode would show a plausible number
    meaning something else entirely.
    """
    wanted = str(item_id or '')
    if not wanted:
        return None
    for entry in schedule or []:
        if entry.get('id') == wanted:
            return entry.get('ends_at')
    return None


def scheduled_start_for(
    schedule: Optional[Iterable[Dict[str, Any]]],
    item_id: Optional[str],
) -> Optional[int]:
    wanted = str(item_id or '')
    if not wanted:
        return None
    for entry in schedule or []:
        if entry.get('id') == wanted:
            return entry.get('starts_at')
    return None


def total_length(schedule: Optional[Iterable[Dict[str, Any]]]) -> int:
    return sum(_seconds(entry.get('length')) for entry in schedule or [])


def drift_seconds(
    schedule: Optional[Iterable[Dict[str, Any]]],
    item_id: Optional[str],
    actually_started_at: Optional[float],
) -> Optional[int]:
    """How far behind (positive) or ahead (negative) the service is running.

    ⭐ Not shown by itself anywhere yet, but it is the number an operator
    actually wants on a wall and it falls out of this for free. Kept because
    the alternative is recomputing it somewhere that does not have the
    schedule.
    """
    planned = scheduled_start_for(schedule, item_id)
    if planned is None or actually_started_at is None:
        return None
    return int(actually_started_at) - int(planned)


def is_stale(
    schedule: Optional[Iterable[Dict[str, Any]]],
    item_id: Optional[str],
) -> bool:
    """Whether the running order we cached has heard of this item.

    ⛔ The signal to refetch. Somebody adding a song mid-service is normal, and
    the cached order would otherwise go on answering about a service that no
    longer exists for the rest of the morning.
    """
    if not schedule:
        return True
    return scheduled_end_for(schedule, item_id) is None
