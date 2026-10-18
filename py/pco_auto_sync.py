"""Deciding whether to sync a plan with nobody watching (#140).

This is the half of #140 that reverses a rule. #120's "Keep" list said a sync
stays the operator's action; the maintainer has since decided otherwise, and
the reasons behind the old rule shape this rather than being swept aside:

- A sync **writes `config.json`** and, with `clear_unmatched` on, takes people
  *off* the board. Automatic means it does that unattended.
- A plan that 404s must not be re-polled forever (#73, #90, #94).
- Tornado is single-threaded here, so the caller has to obey the same
  load / resolve / apply split as `PcoSyncHandler`.

⛔ Every rule below is a refusal. The decision to write is made in one place so
that the conditions under which this board edits itself can be read end to end
without following the watcher's control flow.
"""

from typing import Any, Dict, Optional, Set, Tuple

# ⭐ One of the mapping keys, so it inherits like the rest (`effective_mapping`
# in pco_profiles). The maintainer asked for this per profile -- Youth may want
# automatic while the main service stays manual -- and inheritance gives both:
# a board-wide default that any profile can override.
AUTO_SYNC_KEY = 'auto_sync'


def auto_sync_enabled(mapping: Optional[Dict[str, Any]]) -> bool:
    """⚠️ Off unless explicitly, unambiguously on.

    This reaches here from `config.json`, where a string "false" would
    otherwise be truthy and start rewriting a board nobody asked it to.
    """
    if not isinstance(mapping, dict):
        return False
    value = mapping.get(AUTO_SYNC_KEY)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ('1', 'true', 'yes', 'on')
    return value is True


def attempt_key(status: Optional[Dict[str, Any]]) -> Optional[Tuple[str, str]]:
    """What identifies this particular change.

    ⛔ The plan *and* its `updated_at`. Keyed on the plan alone, one failure
    would block the plan for the rest of the service; keyed on nothing, a plan
    that cannot be synced would be retried every two minutes forever, which is
    the failure #73 and #90 are about.
    """
    if not isinstance(status, dict):
        return None
    plan_id = status.get('plan_id')
    updated_at = status.get('updated_at')
    if not plan_id or not updated_at:
        return None
    return (str(plan_id), str(updated_at))


def should_auto_sync(
    status: Optional[Dict[str, Any]],
    mapping: Optional[Dict[str, Any]],
    attempted: Optional[Set[Tuple[str, str]]] = None,
    running: bool = False,
) -> Tuple[bool, str]:
    """Whether to sync now, and why not when the answer is no.

    The reason is returned rather than logged so the caller can put it in front
    of an operator: "the board did nothing and here is what it was waiting for"
    is a different message from silence.
    """
    if running:
        # ⚠️ The watcher wakes every 30s and a sync is several seconds of HTTP.
        # Two overlapping ones would both write config.json.
        return False, 'a sync is already running'

    if not auto_sync_enabled(mapping):
        return False, 'automatic sync is off for this plan'

    if not isinstance(status, dict) or not status:
        return False, 'the plan has not been checked yet'

    if status.get('error'):
        # ⛔ A failed check is not a reason to write to the board. It is not
        # even a reason to think anything changed -- see `check_active_plan`,
        # which deliberately returns no `changed` key when it could not ask.
        return False, 'the last check failed'

    if status.get('finished'):
        # The service is over. Whatever changed, changing the board now helps
        # nobody and may be somebody setting up next week.
        return False, 'the service is over'

    if not status.get('changed'):
        return False, 'nothing has changed'

    key = attempt_key(status)
    if key is None:
        return False, 'the change could not be identified'

    if key in (attempted or set()):
        # ⛔ Tried once, and it did not work. Trying again every two minutes
        # would spend the account's rate limit on a plan that is not going to
        # succeed, and would hide the failure behind its own repetition.
        return False, 'already tried for this version of the plan'

    return True, 'the plan changed and this profile syncs automatically'


def _describe_held(held: Any) -> str:
    """The held slots, named rather than counted.

    ⭐ One person is worth naming: the operator reading this on a phone can
    act on "Christian Nuckels is on Welcome and Vocal 1" and can do nothing
    with "1 slot held". Several, and the count is the honest summary.
    """
    rows = [row for row in (held or []) if isinstance(row, dict)]
    if not rows:
        return ''

    if len(rows) == 1:
        row = rows[0]
        name = str(row.get('name') or '').strip() or 'One person'
        positions = [str(p).strip() for p in (row.get('positions') or []) if str(p).strip()]
        kept = row.get('kept_on')
        where = f" is on {' and '.join(positions)}" if positions else ' is on several positions'
        tail = f', so slot {kept} was left as it is' if kept else ', so nothing was written'
        return f'{name}{where}{tail} — somebody has to say which radio they carry'

    return (
        f'{len(rows)} slots left alone because one person is on several positions'
        ' — somebody has to say which radio they carry'
    )


def describe_outcome(result: Optional[Dict[str, Any]]) -> str:
    """One sentence about what an automatic sync just did.

    ⭐ Says the destructive part out loud. An operator who was not present when
    this ran needs "and took two people off" in the same breath as "synced",
    because that is the half they cannot undo by syncing again (#135).
    """
    if not isinstance(result, dict) or not result.get('ok'):
        error = (result or {}).get('error') if isinstance(result, dict) else None
        return f"Automatic sync failed: {error}" if error else 'Automatic sync failed.'

    updates = int(result.get('updates') or 0)
    cleared = int(result.get('cleared') or 0)
    skipped = len(result.get('skipped') or [])
    # ⛔⛔ `held` is its own list and was not read here at all, so an
    # automatic sync that left a slot alone because one person is on two
    # positions said **nothing about it**. On the venue board's own plan that
    # is the only thing the sync declines to do: Christian Nuckels on Welcome
    # and Vocal 1, `skipped: []`, `held: [...]` -- and the operator who was not
    # in the room read "nothing on the board needed changing".
    held = result.get('held') or []

    if not updates and not cleared:
        # ⚠️ A held slot means the sync ran and chose to write nothing, which
        # is not the same as the board already being right -- and saying
        # "nothing needed changing" ahead of "Christian is on two positions"
        # contradicts itself in one sentence.
        text = ('Synced automatically — nothing was written' if held
                else 'Synced automatically — nothing on the board needed changing')
    else:
        parts = []
        if updates:
            parts.append(f"{updates} slot{'' if updates == 1 else 's'} updated")
        if cleared:
            parts.append(f"{cleared} slot{'' if cleared == 1 else 's'} cleared")
        text = f"Synced automatically — {', '.join(parts)}"

    if skipped:
        # ⛔ Never folded into the count. A contested slot was *not* handled,
        # and it is the one thing here that still needs a person (#141).
        text += (
            f". {skipped} slot{'' if skipped == 1 else 's'} left alone"
            ' (claimed by two people) — these still need checking'
        )

    if held:
        # ⛔ A different sentence, because it is a different decision. Nobody
        # is contesting the slot: one person is on several positions and only
        # they know which radio they are carrying (#260).
        text += '. ' + _describe_held(held)

    return f'{text}.'


def needs_attention(result: Optional[Dict[str, Any]]) -> bool:
    """Whether the operator has to look, even though it synced itself."""
    if not isinstance(result, dict):
        return True
    if not result.get('ok'):
        return True
    # Contested slots were skipped, so somebody has to decide. Cleared slots
    # are reported but not flagged: the admin turned that option on.
    return bool(result.get('skipped'))
