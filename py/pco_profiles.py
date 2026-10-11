"""Assignment rules that differ by the kind of plan being synced.

A Sunday morning service and a Wednesday youth night are not the same job. They
use different teams, often a different note category, and frequently a different
set of channels -- but until now Planning Center settings were **one** mapping
block, so whichever shape was configured last was the shape every plan got.

⭐ A profile is a named set of mapping rules. It may be **bound** to a Planning
Center service type, in which case syncing a plan from that service type picks
it with nobody choosing anything; or left **unbound**, in which case an operator
picks it by hand. That is what makes "Christmas Eve" expressible: it shares the
Sunday AM service type, so no automatic rule can tell it apart, and only a
person can say which night it is.

⛔ Nothing here makes a network call or writes anything. It decides which rules
apply; `pco.py` applies them.
"""

from typing import Any, Dict, List, Optional, Tuple

# The keys a profile may override. Anything outside this set is ignored rather
# than silently carried into the mapping, so a typo in config.json cannot turn
# into a rule nobody can find.
MAPPING_KEYS = (
    'strategy',
    'note_category',
    'note_source',
    'team_name_filter',
    'position_number_fallback',
    'seed_extended_id',
    'clear_unmatched',
)


def _as_id(value: Any) -> str:
    """Service type ids arrive as ints from config and strings from the API."""
    if value is None:
        return ''
    return str(value).strip()


def profiles_of(pco_cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Every configured profile, ignoring malformed entries."""
    raw = (pco_cfg or {}).get('profiles')
    if not isinstance(raw, list):
        return []
    return [p for p in raw if isinstance(p, dict) and _as_id(p.get('id'))]


def profile_by_id(pco_cfg: Dict[str, Any], profile_id: Any) -> Optional[Dict[str, Any]]:
    wanted = _as_id(profile_id)
    if not wanted:
        return None
    for profile in profiles_of(pco_cfg):
        if _as_id(profile.get('id')) == wanted:
            return profile
    return None


def profiles_for_service_type(pco_cfg: Dict[str, Any], service_type_id: Any) -> List[Dict[str, Any]]:
    """Profiles bound to this service type, in configured order."""
    wanted = _as_id(service_type_id)
    if not wanted:
        return []
    return [
        p for p in profiles_of(pco_cfg)
        if _as_id(p.get('service_type_id')) == wanted
    ]


def binding_conflicts(pco_cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Service types claimed by more than one profile.

    ⚠️ Reported rather than refused. A half-finished configuration should not
    stop a service, and the first profile wins deterministically -- but an
    operator who thinks they are syncing with "Youth" while "Sunday AM" is
    actually in force needs to be told.
    """
    by_service: Dict[str, List[str]] = {}
    for profile in profiles_of(pco_cfg):
        stid = _as_id(profile.get('service_type_id'))
        if not stid:
            continue
        by_service.setdefault(stid, []).append(
            str(profile.get('name') or profile.get('id'))
        )

    return [
        {'service_type_id': stid, 'profiles': names, 'winner': names[0]}
        for stid, names in sorted(by_service.items())
        if len(names) > 1
    ]


def effective_mapping(pco_cfg: Dict[str, Any], profile: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """The base mapping block with the profile's overrides laid on top.

    ⭐ Profiles **inherit** rather than replace. A profile that only wants a
    different team filter says only that, and still gets every other rule the
    board was set up with. The alternative -- each profile restating all seven
    knobs -- means a knob added later silently differs between profiles, and
    two of those knobs decide whether a sync takes people *off* the board.

    ⚠️ Only keys the profile actually sets are overrides. A key present and
    explicitly null is treated as "not set", because that is what a half-filled
    form sends.
    """
    base = (pco_cfg or {}).get('mapping')
    merged: Dict[str, Any] = dict(base) if isinstance(base, dict) else {}

    overrides = (profile or {}).get('mapping')
    if isinstance(overrides, dict):
        for key in MAPPING_KEYS:
            if key in overrides and overrides[key] is not None:
                merged[key] = overrides[key]
    return merged


def select_profile(
    pco_cfg: Dict[str, Any],
    service_type_id: Any = None,
    profile_override: Any = None,
) -> Tuple[Optional[Dict[str, Any]], str, Optional[str]]:
    """Work out which profile applies.

    Returns ``(profile, reason, error)``. ``profile`` is None when the board's
    plain mapping block applies, which is also what every existing
    configuration gets -- there is no migration and nothing to turn on.

    Order, most specific first:

    1. the profile the operator named for this sync;
    2. a profile bound to this plan's service type;
    3. the configured default profile;
    4. no profile -- the base mapping block.

    ⛔ A named profile that does not exist is an **error**, never a quiet
    fallback. Syncing with different rules than the ones asked for is how the
    wrong person ends up on a microphone, and it would look like the board
    working perfectly.
    """
    if _as_id(profile_override):
        chosen = profile_by_id(pco_cfg, profile_override)
        if not chosen:
            return (None, '', f'No assignment profile named "{_as_id(profile_override)}"')
        return (chosen, 'chosen', None)

    bound = profiles_for_service_type(pco_cfg, service_type_id)
    if bound:
        return (bound[0], 'service_type', None)

    default_id = (pco_cfg or {}).get('default_profile')
    if _as_id(default_id):
        chosen = profile_by_id(pco_cfg, default_id)
        if chosen:
            return (chosen, 'default', None)
        # ⚠️ A default pointing at a deleted profile falls through to the base
        # mapping rather than failing. Unlike an override, nobody asked for it
        # this time, and refusing to sync over a stale setting would be worse
        # than syncing with the board's own rules.
        return (None, 'default_missing', None)

    return (None, 'base', None)


def describe_selection(profile: Optional[Dict[str, Any]], reason: str) -> str:
    """One line for the log and the preview, saying which rules are in force."""
    if not profile:
        if reason == 'default_missing':
            return 'Default assignment profile is missing; using the board settings.'
        return 'Using the board settings.'

    name = str(profile.get('name') or profile.get('id'))
    if reason == 'chosen':
        return f'Using the "{name}" profile.'
    if reason == 'service_type':
        return f'Using the "{name}" profile, matched on this plan\'s service type.'
    if reason == 'default':
        return f'Using the "{name}" profile, the default.'
    return f'Using the "{name}" profile.'
