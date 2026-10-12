"""Where the service has got to, when Planning Center Live is running (#121).

⛔ **Live is often not running.** The maintainer runs it for some events and not
others, and plenty of churches never run it at all. Everything here is built so
that "not running" is a first-class answer rather than an error or, worse, a
stale position shown as though it were current.

⭐ There is no "is it running" flag in the API. The `can_*` fields on the Live
resource are permissions, not session state. The honest test is **whether there
is a current item time carrying a `live_start_at`** — if Live has never been
started on this plan, that edge returns nothing.

This module shapes the answer. `pco.py` owns the HTTP.
"""

from typing import Any, Dict, List, Optional

# What `state` can be, and what each one means on screen.
#
#   off        - the strip is not enabled; nothing is polled
#   no_plan    - enabled, but nothing has been synced to watch
#   not_running- Live has never been started on this plan
#   running    - there is a current item
#   stale      - we had a position, and updates have stopped arriving
#   error      - we could not ask
STATES = ('off', 'no_plan', 'not_running', 'running', 'stale', 'error')

# How long without a successful poll before a position stops being trustworthy.
# ⚠️ Generous on purpose: a single missed poll is a blip, and a strip that
# flickers between "running" and "stale" is worse than one that lags.
STALE_AFTER_SECONDS = 90


def _seconds(value: Any) -> Optional[int]:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n


def item_from(included: List[Dict[str, Any]], item_id: Any) -> Dict[str, Any]:
    """Pull one Item out of an API response's `included` block."""
    wanted = str(item_id or '')
    if not wanted:
        return {}
    for entry in included or []:
        if str(entry.get('type') or '').lower() == 'item' and str(entry.get('id')) == wanted:
            return entry.get('attributes') or {}
    return {}


def describe_item(attrs: Dict[str, Any], times: Dict[str, Any]) -> Dict[str, Any]:
    """One item on the running order, as the strip needs it."""
    return {
        'title': (attrs.get('title') or '').strip(),
        'type': (attrs.get('item_type') or '').strip(),
        # `length` is the planned duration in seconds. `length_offset` is how
        # far the running order has drifted, and is not the same question.
        'length': _seconds(times.get('length')),
        'started_at': times.get('live_start_at') or None,
    }


def live_state(
    *,
    enabled: bool,
    plan_id: Optional[str],
    current: Optional[Dict[str, Any]],
    asked_at: Optional[float] = None,
    now: Optional[float] = None,
    error: Optional[str] = None,
) -> str:
    """Which of `STATES` the strip is in.

    ⚠️ Order matters. "Not enabled" beats everything, then "nothing to watch",
    then a hard error, then whether we have a position, then whether that
    position is still fresh. Getting this order wrong is how a disabled strip
    starts reporting errors about a plan nobody asked it to follow.
    """
    if not enabled:
        return 'off'
    if not plan_id:
        return 'no_plan'
    if error:
        return 'error'
    if not current or not current.get('started_at'):
        return 'not_running'

    if asked_at and now and (now - asked_at) > STALE_AFTER_SECONDS:
        return 'stale'
    return 'running'


def state_label(state: str, *, age_seconds: Optional[int] = None) -> str:
    """What the strip says about itself.

    ⛔ Every one of these says something true and specific. "Live not running"
    is a different fact from "we cannot reach Planning Center", and a board
    showing the second as the first teaches its operator that the strip is
    decorative.
    """
    if state == 'no_plan':
        return 'No plan synced'
    if state == 'not_running':
        return 'Live not running'
    if state == 'error':
        return 'Cannot reach Planning Center'
    if state == 'stale':
        if age_seconds and age_seconds >= 60:
            minutes = int(round(age_seconds / 60))
            return f'No update for {minutes} minute{"" if minutes == 1 else "s"}'
        return 'No recent update'
    return ''


def elapsed_seconds(started_at_epoch: Optional[float], now: float) -> Optional[int]:
    """How long the current item has been running."""
    if not started_at_epoch:
        return None
    return max(0, int(now - started_at_epoch))


def running_over(elapsed: Optional[int], length: Optional[int]) -> Optional[int]:
    """Seconds past the planned length, or None when that cannot be said.

    ⚠️ Only positive. "Three minutes left" and "three minutes over" are
    different statements and the second is the one worth colouring; a single
    signed number invites a strip that shouts at every item for most of its
    duration.
    """
    if elapsed is None or not length or length <= 0:
        return None
    over = elapsed - length
    return over if over > 0 else None
