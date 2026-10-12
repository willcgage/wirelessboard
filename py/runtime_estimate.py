"""Working out how long a pack has left, where the receiver will not say (#109).

Bars answer "roughly how full". The question anyone asks during a service is
"will this pack last", and two of the four receiver families coming cannot
answer it — Audio-Technica reports five buckets of 20%, and UHF-R reports bars.

⛔ **Driven by whether a runtime actually arrives, not by a table of which
receiver should have one.** The device config says QLX-D maps `BATT_RUN_TIME`
while #109's table says it reports bars only, and that cannot be settled without
hardware. It also does not need to be: Shure sends 65533/4/5 for
warning/calculating/unknown, so even a receiver that *has* the field spends part
of its life not answering. Estimating whenever there is no number is right in
every one of those cases.

⚠️ **An estimate presented as a measurement is worse than no estimate.** Every
answer here carries where it came from, and the board shows the two differently.
"""

import time
from typing import Any, Dict, List, Optional, Tuple

# How long a sample stays interesting. Long enough to see a bar change on a
# pack that lasts a service; short enough that a rate measured before the
# interval went on does not dominate after it.
WINDOW_SECONDS = 45 * 60

# ⚠️ Below this the fit is noise. A bar changing once gives two points and a
# rate; it does not give a *trustworthy* rate, but it is the honest best and
# the alternative is silence for most of a service.
MIN_SAMPLES = 2

# Levels are 1..5 bars; 255 means the receiver is not saying.
MAX_LEVEL = 5
UNKNOWN_LEVEL = 255


def level_fraction(level: Any) -> Optional[float]:
    """The **bottom** of a bar's range, as a fraction of a full pack.

    ⛔ The bottom, deliberately. Three bars of five means somewhere in 40–59%;
    taking 40% makes the board under-promise, and taking 59% makes it tell
    somebody a nearly flat pack is fine. Only one of those sends a person on
    stage with a microphone that dies.
    """
    try:
        bars = int(level)
    except (TypeError, ValueError):
        return None
    if bars < 1 or bars > MAX_LEVEL:
        return None
    return (bars - 1) / float(MAX_LEVEL)


class RuntimeEstimator:
    """Per transmitter. Keeps a short history and projects to empty."""

    def __init__(self) -> None:
        self.samples: List[Tuple[float, float]] = []   # (timestamp, fraction)
        self.last_level: Optional[int] = None

    def reset(self) -> None:
        self.samples = []
        self.last_level = None

    def record(self, level: Any, now: Optional[float] = None) -> None:
        """Note a battery reading."""
        moment = time.time() if now is None else float(now)

        try:
            bars = int(level)
        except (TypeError, ValueError):
            return
        if bars == UNKNOWN_LEVEL:
            # Not a reading. Keeping the history is right: a receiver that
            # drops out for a minute has not had its battery changed.
            return

        fraction = level_fraction(bars)
        if fraction is None:
            return

        # ⛔ A level that goes *up* is a new pack. Keeping the old drain rate
        # would make a fresh battery read as terminal -- the previous rate
        # applied to a nearly empty pack, now applied to a full one.
        if self.last_level is not None and bars > self.last_level:
            self.samples = []

        self.last_level = bars

        # Only the first moment at a level matters: the pack reached it then,
        # and repeating the same reading for ten minutes would otherwise flatten
        # the measured rate towards zero.
        if not self.samples or self.samples[-1][1] != fraction:
            self.samples.append((moment, fraction))

        self._trim(moment)

    def _trim(self, now: float) -> None:
        cutoff = now - WINDOW_SECONDS
        # ⚠️ Always keeps the last two, however old. A pack that has sat on one
        # bar for an hour still has a rate worth projecting; dropping to a
        # single sample would make the board go quiet exactly when the estimate
        # has had the longest to settle.
        while len(self.samples) > MIN_SAMPLES and self.samples[0][0] < cutoff:
            self.samples.pop(0)

    def minutes_remaining(self, now: Optional[float] = None) -> Optional[int]:
        """Minutes until empty, or None when that cannot honestly be said."""
        if len(self.samples) < MIN_SAMPLES:
            # ⛔ Nothing has changed yet, so there is no drain rate -- only a
            # guess dressed as a number. The board shows bars until then.
            return None

        first_t, first_f = self.samples[0]
        last_t, last_f = self.samples[-1]

        elapsed = last_t - first_t
        dropped = first_f - last_f
        if elapsed <= 0 or dropped <= 0:
            # Flat or rising over the window. A pack that is not draining has
            # no meaningful time to empty.
            return None

        per_second = dropped / elapsed
        moment = time.time() if now is None else float(now)

        # Count the time already spent at the current level: a pack that
        # reached its last bar twenty minutes ago has twenty minutes less left
        # than one that reached it just now.
        since_last = max(0.0, moment - last_t)

        # ⛔ But not forever. A transmitter that stopped reporting an hour ago
        # projects to zero and the board then states, as an estimate, that a
        # pack is flat -- about a channel it has heard nothing from. Past the
        # window the honest answer is that we no longer know.
        if since_last > WINDOW_SECONDS:
            return None
        remaining_fraction = last_f - per_second * since_last
        if remaining_fraction <= 0:
            return 0

        seconds = remaining_fraction / per_second
        # ⚠️ Rounded, not floored. Exact arithmetic that should give 90 minutes
        # lands on 5399.9999 seconds, and flooring turned every clean answer
        # into one minute less. The half-minute this can round up is nothing
        # beside the bucket-bottom rule, which already under-promises by up to
        # a fifth of a pack.
        return int(round(seconds / 60))


def format_runtime(minutes: Optional[int]) -> str:
    """`H:MM`, matching what a reported runtime already looks like on the card."""
    if minutes is None or minutes < 0:
        return ''
    hours, mins = divmod(int(minutes), 60)
    return f'{hours}:{mins:02d}'


def describe(reported: str, estimated_minutes: Optional[int]) -> Dict[str, str]:
    """What the channel publishes: a runtime and where it came from.

    ⚠️ A reported runtime always wins. The receiver knows things the estimator
    cannot -- the chemistry, the transmit power, what the pack did before this
    board saw it.
    """
    if reported:
        return {'runtime': reported, 'runtime_source': 'reported'}

    text = format_runtime(estimated_minutes)
    if text:
        return {'runtime': text, 'runtime_source': 'estimated'}

    return {'runtime': '', 'runtime_source': 'none'}
