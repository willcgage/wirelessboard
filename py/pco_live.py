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


def describe_item(
    attrs: Dict[str, Any],
    times: Dict[str, Any],
    item_id: Any = None,
) -> Dict[str, Any]:
    """One item on the running order, as the strip needs it.

    ⛔ `item_id` is passed in rather than read out of `attrs`. JSON:API puts
    the id beside `attributes`, not inside it, and `item_from` hands back only
    the attributes -- so reading `attrs['id']` is a silent `None` that makes
    "End item on time" quietly never match anything (#121).
    """
    return {
        'id': str(item_id or '') or None,
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


# Planning Center's own three timing modes, by their names (#121). A board that
# invented a fourth would be teaching operators something they then could not
# use anywhere else.
TIMER_MODES = ('full_item_length', 'end_item_on_time', 'end_service_on_time')
DEFAULT_TIMER_MODE = 'full_item_length'

TIMER_LABELS = {
    'full_item_length': 'Full item length',
    'end_item_on_time': 'End item on time',
    'end_service_on_time': 'End service on time',
}


def timer_mode(value: Any) -> str:
    """The configured mode, or Planning Center's default."""
    text = str(value or '').strip().lower()
    return text if text in TIMER_MODES else DEFAULT_TIMER_MODE


def item_timer(
    mode: str,
    *,
    elapsed: Optional[int],
    length: Optional[int],
    scheduled_end: Optional[int] = None,
    service_end: Optional[int] = None,
    now: Optional[float] = None,
) -> Dict[str, Any]:
    """How much time the current item has, under one of Planning Center's modes.

    Returns ``{'seconds', 'over', 'mode', 'known'}`` where ``seconds`` counts
    **down** to zero and then keeps going as ``over``.

    ⭐ Mirrors Live's own behaviour deliberately: the timer runs down, and once
    an item is late it turns over and counts up. An operator who knows Live
    reads this without being taught, which is worth more than any cleverness
    this board could add.

    ⚠️ ``known`` is false whenever the inputs for a mode are missing. A timer
    that silently falls back to a different mode is worse than one that says it
    cannot tell: the number would look right and mean something else.
    """
    mode = timer_mode(mode)

    if mode == 'end_service_on_time':
        remaining = _countdown(service_end, now)
    elif mode == 'end_item_on_time':
        remaining = _countdown(scheduled_end, now)
    else:
        remaining = None if (elapsed is None or not length) else length - elapsed

    if remaining is None:
        return {'seconds': None, 'over': False, 'mode': mode, 'known': False}

    return {
        'seconds': abs(int(remaining)),
        'over': remaining < 0,
        'mode': mode,
        'known': True,
    }


def _countdown(target_epoch: Optional[int], now: Optional[float]) -> Optional[int]:
    if target_epoch is None or now is None:
        return None
    return int(target_epoch - now)


def format_clock(seconds: Optional[int]) -> str:
    """m:ss, or h:mm:ss once it is worth the extra field.

    ⚠️ No leading zero on the minutes under an hour. "5:03" is a duration;
    "05:03" reads as a clock time, and this sits next to one.
    """
    if seconds is None:
        return '--:--'
    total = max(0, int(seconds))
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    if hours:
        return f'{hours}:{minutes:02d}:{secs:02d}'
    return f'{minutes}:{secs:02d}'


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
