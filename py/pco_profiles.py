"""Assignment rules that differ by the kind of plan being synced.

A Sunday morning service and a Wednesday youth night are not the same job. They
use different teams, often a different note category, and frequently a different
set of channels -- but until now Planning Center settings were **one** mapping
block, so whichever shape was configured last was the shape every plan got.

⭐ A profile is a named set of mapping rules, bound to the plan it should apply
to in one of three ways:

1. **a service type** -- exact, and the most specific;
2. **a folder** -- every service type inside it, and inside its subfolders.
   Churches organise Services into folders ("Sunday Morning", "Youth",
   "Special"), and a folder binding is one rule covering all the service types
   filed under it, including ones created later;
3. **nothing** -- the operator picks it by hand.

⛔ **Templates cannot be bound to, and this is not an omission.** Planning
Center copies a template into a plan rather than linking it: their own
documentation says editing a template does not change plans already made from
it, and a plan carries no reference back. So nothing the board can read says
which template a plan came from. A service that differs only by template --
"Christmas Eve", which is an ordinary Sunday AM plan made from a different
template -- is exactly what hand-picking is for, and it is the reason unbound
profiles exist rather than being a lesser case.

⛔ Nothing here makes a network call or writes anything. It decides which rules
apply; `pco.py` applies them, and `pco.folder_chain` is what resolves a service
type's folders.
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


def profiles_for_folder(pco_cfg: Dict[str, Any], folder_id: Any) -> List[Dict[str, Any]]:
    """Profiles bound to this folder, in configured order."""
    wanted = _as_id(folder_id)
    if not wanted:
        return []
    return [p for p in profiles_of(pco_cfg) if _as_id(p.get('folder_id')) == wanted]


def binds_anywhere(pco_cfg: Dict[str, Any]) -> bool:
    """Whether any profile binds to a folder.

    ⚠️ Lets a caller skip the folder walk entirely. It is one HTTP request per
    level on the path an operator is waiting on, and a board whose profiles are
    all service-type-bound or hand-picked must not pay for it.
    """
    return any(_as_id(p.get('folder_id')) for p in profiles_of(pco_cfg))


def binding_conflicts(pco_cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Service types claimed by more than one profile.

    ⚠️ Reported rather than refused. A half-finished configuration should not
    stop a service, and the first profile wins deterministically -- but an
    operator who thinks they are syncing with "Youth" while "Sunday AM" is
    actually in force needs to be told.
    """
    clashes: List[Dict[str, Any]] = []
    for kind, key in (('service_type', 'service_type_id'), ('folder', 'folder_id')):
        grouped: Dict[str, List[str]] = {}
        for profile in profiles_of(pco_cfg):
            value = _as_id(profile.get(key))
            if not value:
                continue
            grouped.setdefault(value, []).append(
                str(profile.get('name') or profile.get('id'))
            )
        for value, names in sorted(grouped.items()):
            if len(names) > 1:
                clashes.append({
                    'kind': kind,
                    f'{kind}_id': value,
                    'profiles': names,
                    'winner': names[0],
                })
    return clashes


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
    folder_ids: Optional[Tuple[str, ...]] = None,
) -> Tuple[Optional[Dict[str, Any]], str, Optional[str]]:
    """Work out which profile applies.

    Returns ``(profile, reason, error)``. ``profile`` is None when the board's
    plain mapping block applies, which is also what every existing
    configuration gets -- there is no migration and nothing to turn on.

    Order, most specific first:

    ``folder_ids`` are the folders above this plan's service type, **nearest
    first** (see ``pco.folder_chain``).

    1. the profile the operator named for this sync;
    2. a profile bound to this plan's service type;
    3. a profile bound to one of its folders, nearest folder first;
    4. the configured default profile;
    5. no profile -- the base mapping block.

    ⭐ Nearest folder first is what makes nesting useful: "Youth" inside
    "Weekend" beats "Weekend", so one general rule can cover a whole tree while
    a single branch overrides it. Walking outwards and stopping at the first
    match is the precedence a stylesheet has, and the one people expect.

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

    for folder_id in (folder_ids or ()):
        in_folder = profiles_for_folder(pco_cfg, folder_id)
        if in_folder:
            return (in_folder[0], 'folder', None)

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
    if reason == 'folder':
        return f'Using the "{name}" profile, matched on the folder this plan\'s service type is in.'
    if reason == 'default':
        return f'Using the "{name}" profile, the default.'
    return f'Using the "{name}" profile.'
