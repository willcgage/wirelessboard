import base64
import datetime
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import requests

import config
import pco_live
import pco_mapping
import pco_profiles
import sync_diff
from pco_credentials import CredentialError, ensure_credentials

logger = logging.getLogger('micboard.pco')

# Mapping strategies, named for the order in which candidate labels are tried.
#   position         - only the PCO team position name, e.g. "Vocal 1"
#   position_or_note - position, then the note category, then an [ID] in the name
#   note_or_brackets - legacy order: note category, then brackets, then position
SUPPORTED_STRATEGIES = ('position', 'position_or_note', 'note_or_brackets')
DEFAULT_STRATEGY = 'position_or_note'

# Slot keys that hold hardware-supplied naming and must never be overwritten.
DEVICE_NAME_KEYS = ('name', 'name_raw', 'chan_name', 'chan_name_raw')

class PcoConfigError(Exception):
    pass

"""
PCO integration helpers.
Notes:
- This module reads and writes the application's config via config.config_tree
    and persists changes using config.save_current_config().
"""


def get_pco_config() -> Dict[str, Any]:
    pco_cfg = (config.config_tree or {}).get('pco')
    if not pco_cfg:
        raise PcoConfigError('Missing pco configuration block in config.json')

    if not isinstance(pco_cfg, dict):
        raise PcoConfigError('Invalid pco configuration type')

    if not pco_cfg.get('enabled'):
        raise PcoConfigError('PCO integration is disabled (pco.enabled=false)')

    try:
        token, secret, _meta = ensure_credentials(pco_cfg, save_callback=config.save_current_config)
    except CredentialError as exc:
        raise PcoConfigError(str(exc)) from exc

    services = pco_cfg.get('services', {})
    # Service selection is optional; when omitted, we aggregate across all services
    plan_sel = (services.get('plan') or {}).get('select', 'next')
    if plan_sel not in ['next']:
        raise PcoConfigError('Unsupported plan selection mode')

    mapping = pco_cfg.get('mapping', {})
    strategy = mapping.get('strategy') or DEFAULT_STRATEGY
    if strategy not in SUPPORTED_STRATEGIES:
        raise PcoConfigError(
            'Unsupported mapping.strategy: {} (expected one of {})'.format(
                strategy, ', '.join(SUPPORTED_STRATEGIES)))

    note_source = (mapping.get('note_source') or 'auto')
    if note_source not in ['person', 'plan', 'auto']:
        raise PcoConfigError('Unsupported mapping.note_source')

    effective_cfg = dict(pco_cfg)
    effective_cfg['auth'] = {
        'token': token,
        'secret': secret,
        'credential_id': _meta.credential_id,
    }

    return effective_cfg


def _basic_auth_header(token: str, secret: str) -> str:
    raw = f"{token}:{secret}".encode('utf-8')
    return 'Basic ' + base64.b64encode(raw).decode('ascii')


def _configured_slots() -> List[Dict[str, Any]]:
    return [s for s in (config.config_tree or {}).get('slots', []) or [] if isinstance(s, dict)]


def _mapping_options(mapping: Dict[str, Any]) -> Dict[str, Any]:
    """Read the mapping knobs that drive slot resolution."""
    return {
        'strategy': mapping.get('strategy') or DEFAULT_STRATEGY,
        # Lets PCO position "Vocal 1" line up with slots labelled "Mic 1"/"IEM 1".
        # Off by default: it keys on the trailing number alone, so with more than
        # one team scheduled "Vocal 1", "Guitar 1" and "Host 1" all claim "Mic 1".
        'number_fallback': mapping.get('position_number_fallback', False) is True,
        # Off by default: writing extended_id would relabel slots the operator set up.
        'seed_extended_id': mapping.get('seed_extended_id', False) is True,
        # ⛔ Off by default, and it must stay that way. On, a sync makes the
        # board match the plan exactly -- which also takes the spare handheld
        # off the visiting speaker nobody told Planning Center about. The board
        # showing a stale name is bad; the board quietly forgetting a deliberate
        # assignment mid-service is worse, so this is a choice an operator makes
        # rather than a default they discover (#135).
        'clear_unmatched': mapping.get('clear_unmatched', False) is True,
    }


def resolve_assignments(
    people: List[Dict[str, Any]],
    options: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Work out which slots each Planning Center person maps to.

    ``people`` are flattened records with ``name``/``team``/``position``/``note``/
    ``bracket_id`` keys.  Returns ``(resolved, unmatched)``; a resolved entry can
    reference several slots, which is how one PCO position fills both a mic
    channel and its matching IEM channel.
    """
    slots = _configured_slots()
    strategy = options.get('strategy') or DEFAULT_STRATEGY
    number_fallback = options.get('number_fallback', False)

    resolved: List[Dict[str, Any]] = []
    unmatched: List[Dict[str, Any]] = []

    for person in people:
        candidates = pco_mapping.plan_person_labels(person, strategy)
        matches: List[Dict[str, Any]] = []
        used_source = None
        used_label = None
        for source, label in candidates:
            matches = pco_mapping.match_slots(label, slots, number_fallback)
            if matches:
                used_source, used_label = source, label
                break

        if not matches:
            unmatched.append({
                'name': person.get('name') or '',
                'team': person.get('team') or '',
                'position': person.get('position') or '',
                'note': person.get('note') or '',
                'tried': [label for _source, label in candidates],
            })
            continue

        resolved.append({
            'name': person.get('name') or '',
            'team': person.get('team') or '',
            'position': person.get('position') or '',
            'note': person.get('note') or '',
            'label': used_label,
            'matched_via': used_source,
            'slots': [{
                'slot': m['slot'].get('slot'),
                'type': m['slot'].get('type'),
                'extended_id': m['slot'].get('extended_id'),
                'kind': pco_mapping.slot_kind(m['slot']),
                'via': m['via'],
                'describe': pco_mapping.slot_describe(m['slot']),
            } for m in matches],
            '_matches': matches,
        })

    return (resolved, unmatched)


def find_conflicts(resolved: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Report slots claimed by more than one person.

    Two people scheduled to the same position -- or two positions that collide
    via the number fallback -- used to silently overwrite each other, with
    whichever was processed last winning.

    ⛔ **A contested slot is now skipped, not guessed at.** Last-one-wins put a
    name on the board that was right half the time and looked exactly as
    authoritative as one that was right. For a board whose whole job is who has
    which microphone, "these two both claim HH-4, so it has been left alone" is
    an answer an operator can act on in ten seconds; a confident wrong name is
    one nobody knows to question.

    ⚠️ The same rule whether the sync was pressed or automatic. A preview has
    to predict the sync, and two conflict behaviours depending on how a sync
    was triggered would make the preview lie.
    """
    claims: Dict[Any, List[Dict[str, str]]] = {}
    for entry in resolved:
        for slot_info in entry.get('slots') or []:
            claims.setdefault(slot_info.get('slot'), []).append({
                'name': entry.get('name') or '',
                'label': entry.get('label') or '',
            })

    conflicts: List[Dict[str, Any]] = []
    for slot_number, claimants in claims.items():
        distinct = {c['name'] for c in claimants}
        if len(distinct) > 1:
            conflicts.append({
                'slot': slot_number,
                'claimants': claimants,
                # No winner any more. Kept as an explicit field rather than
                # removed, so anything still reading it gets "nobody" instead
                # of a KeyError or, worse, a stale name.
                'winner': None,
                'skipped': True,
            })
    return sorted(conflicts, key=lambda c: (c['slot'] is None, c['slot']))


def conflicted_slots(conflicts: List[Dict[str, Any]]) -> set:
    """The slot numbers a sync must leave alone."""
    return {c.get('slot') for c in (conflicts or []) if c.get('slot') is not None}


def slots_to_clear(resolved: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Slots carrying somebody the new plan does not account for.

    ⭐ Only slots that actually have a name: an empty slot is already clear, and
    counting it would make "4 slots will be cleared" meaningless.

    ⚠️ The person, never the position. `extended_id` is what the *next* sync
    matches on and is often something the operator set deliberately, so a slot
    keeps its role when the person leaves it.
    """
    matched = set()
    for entry in resolved:
        for match in entry.get('_matches') or []:
            number = match.get('slot', {}).get('slot')
            if number is not None:
                matched.add(number)

    stale = []
    for slot in _configured_slots():
        number = slot.get('slot')
        if number in matched:
            continue
        if (slot.get('extended_name') or '').strip():
            stale.append(slot)
    return stale


def _clear_unmatched(stale: List[Dict[str, Any]]) -> int:
    """Take the people off the given slots. Returns the count.

    ⚠️ Takes the list rather than deriving it, so the caller can report the
    names it is about to remove. Does not save -- the caller does, once.
    """
    for slot in stale:
        slot.pop('extended_name', None)

    if stale:
        logger.info(
            'PCO sync cleared %s slot%s this plan does not fill: %s',
            len(stale),
            '' if len(stale) == 1 else 's',
            ', '.join(str(slot.get('slot')) for slot in stale),
        )
    return len(stale)


def _apply_assignments(
    resolved: List[Dict[str, Any]],
    options: Dict[str, Any],
    skip_slots: Optional[set] = None,
) -> int:
    """Write ``extended_name`` onto every resolved slot. Returns slots changed.

    Device names (live or manually entered) are preserved exactly as-is so PCO
    can never overwrite a channel label.  ``extended_id`` is left alone unless
    ``mapping.seed_extended_id`` is enabled and the slot has none yet.

    ⛔ ``skip_slots`` are contested slots (see `find_conflicts`). They are left
    exactly as they are: not written, and -- because a contested slot *was*
    matched -- not cleared by `clear_unmatched` either. Both a guessed name and
    a blank are answers the board would be inventing.
    """
    seed_extended_id = options.get('seed_extended_id', False)
    skip = skip_slots or set()
    updated = 0

    for entry in resolved:
        ext_name = entry.get('name') or ''
        label = entry.get('label') or ''
        for match in entry.get('_matches') or []:
            slot = match['slot']
            if slot.get('slot') in skip:
                continue

            # Snapshot hardware naming before mutating the slot.
            preserved_names = {key: slot.get(key) for key in DEVICE_NAME_KEYS}

            changed = False
            if seed_extended_id and label and not slot.get('extended_id'):
                slot['extended_id'] = label
                changed = True
            if slot.get('extended_name') != ext_name:
                slot['extended_name'] = ext_name
                changed = True

            # Restore preserved device naming to prevent accidental overwrite.
            for key, value in preserved_names.items():
                if value is None:
                    slot.pop(key, None)
                else:
                    slot[key] = value

            if changed:
                updated += 1

    # ⚠️ Does not save. `finish_sync` writes config.json once, after this and
    # after the clears -- before #135 this saved here and the clear saved again,
    # which is two full rewrites of the one file a bad save has destroyed before.
    return updated


# -----------------------
# PCO API helpers
# -----------------------

BASE_URL = 'https://api.planningcenteronline.com/services/v2'


# Status of the most recent failed request, so a caller that only receives None
# can still say why it failed. These calls are serialized on the IOLoop, so
# there is no interleaving to account for.
_LAST_HTTP_ERROR: Optional[int] = None


def _http_get(url: str, headers: Dict[str, str], params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    global _LAST_HTTP_ERROR
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=10)
        if resp.status_code != 200:
            _LAST_HTTP_ERROR = resp.status_code
            logger.warning('PCO GET %s failed: %s %s', url, resp.status_code, resp.text[:200])
            return None
        _LAST_HTTP_ERROR = None
        return resp.json()
    except Exception as exc:
        _LAST_HTTP_ERROR = None
        logger.warning('PCO request error: %s', exc)
        return None


# A plan that has rolled off the schedule answers 404 to everything, and each
# lookup pays for two of them: the service-scoped URL and then the global
# fallback. The PCO panel polls, so a board left running past a plan's date
# re-paid that indefinitely -- the ~20s freezes in #73. A 404 is a definitive
# answer, unlike a timeout or a connection error, which may well be transient,
# so it is the one worth remembering.
#
# Short-lived on purpose: a plan can reappear (a typo'd id corrected upstream,
# a plan un-deleted), and five minutes of stale "gone" is a far smaller problem
# than a board that will not notice for the rest of the service.
_MISSING_PLAN_TTL_SECONDS = 300
_MISSING_PLANS: Dict[str, float] = {}

PLAN_GONE_ERROR = (
    'That plan no longer exists in Planning Center. Pick a current plan; the '
    'board will keep using the channel names it already has until you do.'
)

# The plan is there; its roster is not readable. Overwhelmingly the ordinary
# cause is that nobody has been scheduled on it yet, which is not an error and
# must not be reported as a missing plan.
PLAN_PEOPLE_UNREADABLE_ERROR = (
    'Planning Center has this plan, but no scheduled people could be read from '
    'it. If nobody is scheduled on it yet, that is expected -- add them in '
    'Planning Center. Otherwise check that this token can see the plan\'s '
    'service type.'
)


def _plan_is_really_gone(plan_id: str, headers: Dict[str, str]) -> bool:
    """Ask about the plan itself, instead of trusting the people sweep.

    ⛔ **The sweep is not evidence.** `_get_plan_people_any` tries the generic
    path, then the plan's own service type, then *every* service type over three
    endpoints each, then generic team_members. Whatever `_LAST_HTTP_ERROR` holds
    afterwards is the status of whichever probe happened to run last, and a 404
    from that only says the last endpoint had nothing. A plan with nobody
    scheduled on it ends the sweep exactly the same way as a deleted plan.

    Treating those two as one is how a live plan got recorded as gone -- and the
    answer is remembered for five minutes (#73), so the mistake stuck. Until #90
    it was also served straight back to the operator, which is what made a new
    plan look like it needed a restart to load.

    One request, only on the failure path, and only when the sweep's last word
    was a 404: a timeout or a 500 is not evidence of anything either.
    """
    _http_get(f"{BASE_URL}/plans/{plan_id}", headers, params={})
    return _LAST_HTTP_ERROR == 404


# Where a service type sits in the Services folder tree (#120 profiles).
#
# ⭐ Cached because the shape of a church's folders changes about never, while a
# sync asks for it every time -- and the walk is one request per level, on the
# path an operator is waiting on. Ten minutes is long enough that a Sunday's
# syncs pay for it once and short enough that reorganising folders does not
# need a restart.
_FOLDER_CHAIN: Dict[str, Tuple[float, Tuple[str, ...]]] = {}
_FOLDER_CHAIN_TTL_SECONDS = 600

# ⛔ A folder tree should be a handful deep. The limit is not a tuning knob, it
# is a guard against a cycle in the data turning a sync into an infinite loop
# of HTTP calls -- which on a single-threaded server is the whole board gone.
_FOLDER_CHAIN_MAX_DEPTH = 12


def _parent_folder_id(payload: Optional[Dict[str, Any]]) -> Optional[str]:
    """The Folder a service type or folder hangs from, if any.

    Reads `relationships.parent` and accepts it only when it really is a
    Folder: a service type's parent is a Folder, but nothing promises that
    stays true, and silently treating some other resource as a folder would
    match profiles to the wrong plans.
    """
    if not payload:
        return None
    rel = ((payload.get('data') or {}).get('relationships') or {})
    for key in ('parent', 'folder'):
        data = (rel.get(key) or {}).get('data') or {}
        if not data:
            continue
        if str(data.get('type') or '').lower() != 'folder':
            continue
        folder_id = data.get('id')
        if folder_id is not None:
            return str(folder_id)
    return None


def folder_chain(service_type_id: Any, headers: Dict[str, str]) -> Tuple[str, ...]:
    """Folder ids above a service type, nearest first, then its ancestors.

    Empty when the service type sits at the top level, which is the common case
    for a church that never made folders.
    """
    stid = str(service_type_id or '').strip()
    if not stid:
        return ()

    cached = _FOLDER_CHAIN.get(stid)
    if cached and time.monotonic() < cached[0]:
        return cached[1]

    chain: List[str] = []
    current = _parent_folder_id(_http_get(f"{BASE_URL}/service_types/{stid}", headers))
    seen = set()
    while current and current not in seen and len(chain) < _FOLDER_CHAIN_MAX_DEPTH:
        chain.append(current)
        seen.add(current)
        current = _parent_folder_id(_http_get(f"{BASE_URL}/folders/{current}", headers))

    result = tuple(chain)
    _FOLDER_CHAIN[stid] = (time.monotonic() + _FOLDER_CHAIN_TTL_SECONDS, result)
    return result


def forget_folder_chains() -> None:
    """Drop the folder cache. For tests, and for a config save that may have
    changed which service type is in play."""
    _FOLDER_CHAIN.clear()


def _plan_is_known_missing(plan_id) -> bool:
    if plan_id is None:
        return False
    expires = _MISSING_PLANS.get(str(plan_id))
    if expires is None:
        return False
    if time.monotonic() >= expires:
        _MISSING_PLANS.pop(str(plan_id), None)
        return False
    return True


def _remember_missing_plan(plan_id) -> None:
    if plan_id is not None:
        _MISSING_PLANS[str(plan_id)] = time.monotonic() + _MISSING_PLAN_TTL_SECONDS


def _forget_missing_plan(plan_id) -> None:
    """Called whenever a lookup succeeds, so a plan is never stuck as missing."""
    if plan_id is not None:
        _MISSING_PLANS.pop(str(plan_id), None)


def _short_circuit_missing(plan_id, force: bool) -> bool:
    """Whether to answer "gone" from memory instead of asking Planning Center.

    â­ The cache exists to stop *polling* re-paying two 404s for a plan that has
    rolled off the schedule (#73). It was never meant to answer an operator.

    That distinction was missing, and it is the whole of the bug reported from a
    board on 2026-08-30: pick a plan, press Load People, get "that plan no
    longer exists" -- and press it again, and again, and get the same answer
    without a single request leaving the machine, because the entry is consulted
    before the network and lasts five minutes. Nothing the operator could do
    cleared it. Restarting did, which is why it read as "Wirelessboard has to be
    restarted to load a new plan's people".

    So an explicit request forgets what it thinks it knows and goes and looks. A
    poll still gets the cheap answer.
    """
    if force:
        _forget_missing_plan(plan_id)
        return False
    return _plan_is_known_missing(plan_id)


def _fetch_error(default: str) -> str:
    """Explain the last failure rather than only reporting that there was one.

    A rejected token and an unreachable API both surfaced as the same "Unable to
    fetch..." string, so telling them apart meant reading the server log.
    """
    status = _LAST_HTTP_ERROR
    if status in (401, 403):
        return (
            'Planning Center rejected these credentials ({}). PCO credentials are kept '
            'in this computer\'s system keyring rather than in config.json, so a token '
            'entered on another machine does not carry across -- re-enter the PAT here. '
            'If it was entered on this machine, check it has not been revoked in PCO.'
        ).format(status)
    if status is not None:
        return '{} (Planning Center returned {})'.format(default, status)
    return default


def _http_get_collection(url: str, headers: Dict[str, str], params: Optional[Dict[str, Any]] = None) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    data = _http_get(url, headers, params)
    if not data:
        return ([], [])
    return ((data.get('data') or []), (data.get('included') or []))


def _get_next_plan_id(service_type_id: int, headers: Dict[str, str]) -> Optional[str]:
    # Try to fetch future plans and pick the first upcoming
    url = f"{BASE_URL}/service_types/{service_type_id}/plans"
    params_candidates = [
        {"filter": "future", "per_page": 1, "order": "sort_date"},
        {"filter": "future", "per_page": 1},
        {"per_page": 1},
    ]
    for params in params_candidates:
        data = _http_get(url, headers, params)
        if not data:
            continue
        arr = data.get('data') or []
        if arr:
            return arr[0].get('id')
    return None


def _get_next_plan_global(headers: Dict[str, str]) -> Optional[Tuple[int, str]]:
    data = _http_get(f"{BASE_URL}/service_types", headers, params={"per_page": 200})
    if not data:
        return None
    best: Optional[Tuple[int, str, str]] = None  # (stid, plan_id, sort_date)
    for item in (data.get('data') or []):
        stid = item.get('id')
        try:
            stid_int = int(stid)
        except Exception:
            continue
        plans = _http_get(f"{BASE_URL}/service_types/{stid}/plans", headers, params={"filter": "future", "per_page": 1, "order": "sort_date"})
        if not plans:
            continue
        arr = plans.get('data') or []
        if not arr:
            continue
        pid = arr[0].get('id')
        sort_date = ((arr[0].get('attributes') or {}).get('sort_date') or '')
        if pid:
            if best is None:
                best = (stid_int, pid, sort_date)
            else:
                # Compare ISO-like sort_date strings lexicographically
                if sort_date and best[2] and sort_date < best[2]:
                    best = (stid_int, pid, sort_date)
    if best is None:
        return None
    return (best[0], best[1])


def list_service_types() -> Dict[str, Any]:
    try:
        pco_cfg = get_pco_config()
    except PcoConfigError as exc:
        logger.warning('PCO services list aborted: %s', exc)
        return {"ok": False, "error": str(exc)}

    auth = pco_cfg['auth']
    headers = { 'Authorization': _basic_auth_header(auth['token'], auth['secret']) }
    data = _http_get(f"{BASE_URL}/service_types", headers, params={"per_page": 200})
    if not data:
        return {"ok": False, "error": _fetch_error("Unable to fetch service types")}
    services = []
    for item in (data.get('data') or []):
        attrs = item.get('attributes') or {}
        services.append({
            "id": item.get('id'),
            "name": attrs.get('name')
        })
    return {"ok": True, "services": services}


def list_folders() -> Dict[str, Any]:
    """The Services folders, so a profile can be bound to one by name (#139).

    ⚠️ Returns a flat list with each folder's parent, not a tree. The panel
    needs to show "Weekend / Youth" so two folders called "Youth" in different
    places can be told apart, and a flat list with parents lets it build that
    without this function deciding how deep is too deep to display.
    """
    try:
        pco_cfg = get_pco_config()
    except PcoConfigError as exc:
        logger.warning('PCO folders list aborted: %s', exc)
        return {"ok": False, "error": str(exc)}

    auth = pco_cfg['auth']
    headers = {'Authorization': _basic_auth_header(auth['token'], auth['secret'])}
    data = _http_get(f"{BASE_URL}/folders", headers, params={"per_page": 200})
    if data is None:
        return {"ok": False, "error": _fetch_error("Unable to fetch folders")}

    folders = []
    for item in (data.get('data') or []):
        attrs = item.get('attributes') or {}
        folders.append({
            "id": item.get('id'),
            "name": attrs.get('name') or '',
            "parent_id": _parent_folder_id({'data': item}),
        })
    # ⚠️ An account with no folders is a normal answer, not a failure. Most
    # churches have none, and the panel has to say "no folders" rather than
    # "could not fetch folders".
    return {"ok": True, "folders": folders}


def list_plans_for_service(service_type_value) -> Dict[str, Any]:
    """Return upcoming plans (basic info) for a given service type (name or ID)."""
    try:
        pco_cfg = get_pco_config()
    except PcoConfigError as exc:
        logger.warning('PCO plans list aborted: %s', exc)
        return {"ok": False, "error": str(exc)}

    auth = pco_cfg['auth']
    headers = { 'Authorization': _basic_auth_header(auth['token'], auth['secret']) }

    stid = _resolve_service_type_id(service_type_value, headers)
    if not stid:
        return {"ok": False, "error": "Unable to resolve Service Type"}

    url = f"{BASE_URL}/service_types/{stid}/plans"
    data = _http_get(url, headers, params={"filter": "future", "per_page": 25, "order": "sort_date"})
    if not data:
        return {"ok": False, "error": _fetch_error("Unable to fetch plans")}
    plans = []
    for item in (data.get('data') or []):
        attrs = item.get('attributes') or {}
        plans.append({
            "id": item.get('id'),
            "title": attrs.get('title'),
            "dates": attrs.get('dates'),
            "short_dates": attrs.get('short_dates'),
            "sort_date": attrs.get('sort_date'),
            "service_type_id": stid
        })
    return {"ok": True, "plans": plans}


PEOPLE_BASE_URL = 'https://api.planningcenteronline.com/people/v2'


def verify_credentials(token: str, secret: str) -> Dict[str, Any]:
    """Do these credentials work for what this board actually does? (#120)

    ⭐ Asks for a service type rather than "who are you". A Personal Access
    Token can authenticate perfectly and still have no access to Services, and
    a board that reports "Connected" on such a token has told the operator the
    opposite of the truth. Listing one service type is the smallest call that
    exercises the permission every other call here depends on.
    """
    if not token or not secret:
        return {"ok": False, "error": "Enter both the Personal Access Token and its secret."}

    headers = {'Authorization': _basic_auth_header(token, secret)}
    data = _http_get(f"{BASE_URL}/service_types", headers, params={"per_page": 1})
    if data is None:
        return {"ok": False, "error": _fetch_error('Unable to reach Planning Center')}

    service_types = data.get('data') or []
    if not service_types:
        # Authenticated, authorised, and nothing to read. Worth saying, because
        # every later step will come back empty and look like a bug.
        return {
            "ok": True,
            "who": _connected_as(headers),
            "service_types": 0,
            "warning": "Connected, but this account can see no service types in Services.",
        }

    return {
        "ok": True,
        "who": _connected_as(headers),
        "service_types": len(service_types),
    }


def _connected_as(headers: Dict[str, str]) -> str:
    """A name for the account, or '' when it cannot be had.

    ⚠️ Never fatal. The People API is a different product from Services and a
    Services-only token is refused by it, so a board that failed Connect over a
    missing display name would reject credentials that work perfectly.
    """
    data = _http_get(f"{PEOPLE_BASE_URL}/me", headers)
    if not data:
        return ''
    attrs = (data.get('data') or {}).get('attributes') or {}
    return (attrs.get('name') or '').strip()


def store_credentials(token: str, secret: str, checked: Dict[str, Any]) -> Dict[str, Any]:
    """Put verified credentials in the keyring. Call only after `verify_credentials`.

    ⛔ Writes config.json, so this belongs on the IOLoop beside every other
    writer of that file -- see `PcoConnectHandler` for the split, and
    `PcoSyncHandler` for why it exists at all. The network half is
    `verify_credentials`, which writes nothing and runs on a worker.

    ⛔ The order matters as much as the thread. Storing first and checking
    afterwards is what made the old flow save → fetch → find out it was wrong →
    save again, and it leaves a bad token in the keyring looking like a good one.
    """
    token = (token or '').strip()
    secret = (secret or '').strip()

    if not checked.get('ok'):
        return checked

    try:
        # ⛔ Stores the credentials and nothing else. `enabled` is the admin's
        # switch: if they turned it on it stays on, if they turned it off it
        # stays off, and a save is what changes it. Connecting is not consent
        # to enable -- an admin may well be re-storing a token on a board they
        # have deliberately taken out of service.
        #
        # ⚠️ `update_pco_config` merges, so leaving the key out preserves
        # whatever is there. Do not "helpfully" add `enabled` back.
        config.update_pco_config({'auth': {'token': token, 'secret': secret}})
    except Exception as exc:  # noqa: BLE001
        logger.warning('Storing PCO credentials failed: %s', exc)
        return {"ok": False, "error": f'Credentials are valid but could not be stored: {exc}'}

    who = checked.get('who') or ''
    logger.info('PCO credentials verified and stored%s', f' for {who}' if who else '')
    return {
        "ok": True,
        "who": who,
        "service_types": checked.get('service_types', 0),
        "warning": checked.get('warning'),
    }


def _plan_label(attrs: Dict[str, Any]) -> str:
    """One line naming a plan, from whichever of its fields PCO filled in.

    Most plans carry no title, and a scoped list omits the service type name,
    so joining only the parts that are present avoids labels like "Aug 2 — ".
    """
    parts = [attrs.get('short_dates') or attrs.get('dates'), attrs.get('title')]
    return ' — '.join(part.strip() for part in parts if part and part.strip())


def plan_schedule(limit: int = 10) -> Dict[str, Any]:
    """The upcoming plans and which rules each one will get (#140).

    ⭐ The only way to check a rule set *before* a service rather than after.
    "What will the board do on Sunday" is otherwise unanswerable without
    actually syncing, which writes.

    ⚠️ Read-only and deliberately cheap. The plans list already carries each
    plan's `service_type_id`, so resolving a profile per plan costs nothing
    beyond the folder walk -- and that is cached per service type, so a church
    with four of them pays four walks per ten minutes however many plans are
    listed.
    """
    try:
        pco_cfg = get_pco_config()
    except PcoConfigError as exc:
        logger.warning('PCO schedule aborted: %s', exc)
        return {"ok": False, "error": str(exc)}

    auth = pco_cfg['auth']
    headers = {'Authorization': _basic_auth_header(auth['token'], auth['secret'])}

    services = pco_cfg.get('services', {})
    st_raw = services.get('service_type') if 'service_type' in services else services.get('service_type_id')
    listed = list_plans_for_service(st_raw) if st_raw else list_plans()
    if not listed.get('ok'):
        return listed

    walk = pco_profiles.binds_anywhere(pco_cfg)
    entries = []
    for plan in (listed.get('plans') or [])[:max(0, int(limit or 0))]:
        stid = plan.get('service_type_id')
        folders = ()
        if walk and stid and not pco_profiles.profiles_for_service_type(pco_cfg, stid):
            folders = folder_chain(stid, headers)

        profile, reason, _error = pco_profiles.select_profile(pco_cfg, stid, None, folders)
        entries.append({
            "plan_id": plan.get('id'),
            "label": _plan_label(plan) or plan.get('short_dates') or plan.get('dates') or '',
            "sort_date": plan.get('sort_date'),
            "service_type_id": stid,
            "service_type_name": plan.get('service_type_name') or '',
            "profile": _profile_report(profile, reason),
        })

    return {
        "ok": True,
        "plans": entries,
        "profile_conflicts": pco_profiles.binding_conflicts(pco_cfg),
    }


def next_plan() -> Dict[str, Any]:
    """Which plan "next upcoming" means right now (#120).

    ⭐ Goes through `_select_plan`, the same helper a sync uses, rather than
    taking the first row of the plans list. The two can disagree -- the list is
    scoped to the chosen service type while `_select_plan` falls back to
    scanning every service type when none is chosen -- and a board that offers
    "next upcoming" has to name the plan the sync will actually read. Offering
    one and syncing another is worse than not offering it.
    """
    try:
        pco_cfg = get_pco_config()
    except PcoConfigError as exc:
        logger.warning('PCO next-plan lookup aborted: %s', exc)
        return {"ok": False, "error": str(exc)}

    auth = pco_cfg['auth']
    headers = {'Authorization': _basic_auth_header(auth['token'], auth['secret'])}

    stid, plan_id, error = _select_plan(pco_cfg.get('services', {}), headers)
    if error:
        return {"ok": False, "error": error}
    if not plan_id:
        return {"ok": False, "error": "No upcoming plan found"}

    # The label is a convenience, not the answer. A plan that resolves but
    # whose detail call fails is still the plan the sync will read, so report
    # the id either way rather than failing the whole lookup over a title.
    attrs: Dict[str, Any] = {}
    detail = _http_get(f"{BASE_URL}/plans/{plan_id}", headers)
    if detail:
        attrs = (detail.get('data') or {}).get('attributes') or {}

    return {
        "ok": True,
        "plan_id": plan_id,
        "service_type_id": stid,
        "title": attrs.get('title') or '',
        "dates": attrs.get('dates') or '',
        "short_dates": attrs.get('short_dates') or '',
        "label": _plan_label(attrs),
    }


def list_plans() -> Dict[str, Any]:
    """Return upcoming plans across all service types (aggregated)."""
    try:
        pco_cfg = get_pco_config()
    except PcoConfigError as exc:
        logger.warning('PCO plans list aborted: %s', exc)
        return {"ok": False, "error": str(exc)}

    auth = pco_cfg['auth']
    headers = { 'Authorization': _basic_auth_header(auth['token'], auth['secret']) }

    st_data = _http_get(f"{BASE_URL}/service_types", headers, params={"per_page": 200})
    if not st_data:
        return {"ok": False, "error": _fetch_error("Unable to fetch service types")}
    out: List[Dict[str, Any]] = []
    for item in (st_data.get('data') or []):
        stid = item.get('id')
        stname = ((item.get('attributes') or {}).get('name') or '')
        plans = _http_get(f"{BASE_URL}/service_types/{stid}/plans", headers, params={"filter": "future", "per_page": 5, "order": "sort_date"})
        for p in (plans.get('data') or []) if plans else []:
            attrs = p.get('attributes') or {}
            out.append({
                "id": p.get('id'),
                "title": attrs.get('title'),
                "dates": attrs.get('dates'),
                "short_dates": attrs.get('short_dates'),
                "sort_date": attrs.get('sort_date'),
                "service_type_id": stid,
                "service_type_name": stname,
            })
    # Sort by date ascending
    out.sort(key=lambda x: (x.get('sort_date') or ''))
    return {"ok": True, "plans": out}


def _get_plan_people_with_service(service_type_id: int, plan_id: str, headers: Dict[str, str]) -> Optional[Dict[str, Any]]:
    url = f"{BASE_URL}/service_types/{service_type_id}/plans/{plan_id}/plan_people"
    params = {"include": "person,team,notes,notes.note_category", "per_page": 200}
    return _http_get(url, headers, params)


def list_people_for_plan(plan_id: str, service_type_value=None, force: bool = False) -> Dict[str, Any]:
    """Return the scheduled assignments on a plan, one row per person *per position*.

    A row is (name, team, position) rather than one row per person: somebody
    rostered to Band and to Vocal Team on the same plan holds two assignments
    and may need a channel for each. Rows are still collapsed across service
    times, so a person scheduled morning and evening appears once.

    ``service_type`` is optional and only avoids a redirect. ``force`` marks the
    request as an operator's, which skips the missing-plan memory -- see
    `_short_circuit_missing`.
    """
    try:
        pco_cfg = get_pco_config()
    except PcoConfigError as exc:
        logger.warning('PCO people list aborted: %s', exc)
        return {"ok": False, "error": str(exc)}

    auth = pco_cfg['auth']
    headers = { 'Authorization': _basic_auth_header(auth['token'], auth['secret']) }

    if _short_circuit_missing(plan_id, force):
        return {"ok": False, "error": PLAN_GONE_ERROR}

    plan_people = None
    stid = None
    if service_type_value is not None:
        stid = _resolve_service_type_id(service_type_value, headers)
    if stid:
        plan_people = _get_plan_people_with_service(stid, plan_id, headers)
    if not plan_people:
        # Try generic, then robust fallback across all service types
        plan_people = _get_plan_people_any(plan_id, headers)
    if not plan_people:
        # Only a 404 is worth a second look; anything else stays a plain failure
        # and costs no extra request.
        if _LAST_HTTP_ERROR == 404:
            if _plan_is_really_gone(plan_id, headers):
                _remember_missing_plan(plan_id)
                return {"ok": False, "error": PLAN_GONE_ERROR}
            return {"ok": False, "error": PLAN_PEOPLE_UNREADABLE_ERROR}
        return {"ok": False, "error": _fetch_error("Unable to fetch plan people")}

    _forget_missing_plan(plan_id)

    included_maps = _build_included_maps(plan_people.get('included') or [])
    # Keyed by (name, team, position), not by name. One person can be scheduled
    # to several teams on the same plan -- a vocalist who also hosts -- and each
    # of those is a separate assignment that may need its own channel. Keying on
    # the name alone kept whichever team was seen first and silently discarded
    # the rest, so a vocalist rostered under Band as well would disappear from
    # the Vocal Team roster and could not be assigned a microphone at all.
    out_people: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    cat_names: set = set()

    for pp in plan_people.get('data') or []:
        rel = pp.get('relationships') or {}

        # The team position name carries the mic name and number, e.g. "Vocal 1".
        position = ((pp.get('attributes') or {}).get('team_position_name') or '').strip()

        # Resolve team name
        team_rel = (rel.get('team') or {}).get('data') or {}
        team_obj = None
        if team_rel:
            team_obj = included_maps.get((team_rel.get('type') or '').lower(), {}).get(str(team_rel.get('id')))
        team_name = ((team_obj or {}).get('attributes') or {}).get('name') if team_obj else None

        # Resolve person name
        person_rel = (rel.get('person') or {}).get('data') or {}
        person_obj = None
        if person_rel:
            person_obj = included_maps.get((person_rel.get('type') or '').lower(), {}).get(str(person_rel.get('id')))
        name = _person_display_name(person_obj or {})

        # Collect note objects
        notes_data = (rel.get('notes') or {}).get('data') or []
        note_objs: List[Dict[str, Any]] = []
        for nd in notes_data:
            nd_t = (nd.get('type') or '').lower()
            nd_id = nd.get('id')
            if nd_id:
                obj = included_maps.get(nd_t, {}).get(str(nd_id))
                if obj:
                    note_objs.append(obj)
        if not any(note_objs):
            note_objs = _collect_note_like_objects(rel, included_maps)
        # If still empty, try following the relationship link for notes
        if not any(note_objs):
            notes_link = ((rel.get('notes') or {}).get('links') or {}).get('related')
            if notes_link:
                items, inc = _http_get_collection(notes_link, headers, params={"include": "note_category", "per_page": 200})
                local_maps = _build_included_maps(inc or [])
                # convert to included-like objects with attributes
                tmp_objs: List[Dict[str, Any]] = []
                for it in items:
                    tmp_objs.append(it)
                # stitch category_name where possible and build list
                built: List[Dict[str, Any]] = []
                for nobj in tmp_objs:
                    nattrs = nobj.get('attributes') or {}
                    nrels = nobj.get('relationships') or {}
                    if not nattrs:
                        continue
                    if not nattrs.get('category_name'):
                        try:
                            rel2 = (nrels.get('note_category') or {}).get('data') or {}
                            cid = rel2.get('id')
                            found = None
                            if cid:
                                found = local_maps.get('note_category', {}).get(str(cid)) or included_maps.get('note_category', {}).get(str(cid))
                            if found:
                                nattrs['category_name'] = ((found.get('attributes') or {}).get('name') or '').strip()
                        except Exception:
                            pass
                    built.append({"attributes": nattrs, "relationships": nrels})
                note_objs = built

        valid_notes = [n for n in note_objs if n]
        notes_list = _extract_all_notes(valid_notes, included_maps)
        # Also include PlanPerson attributes.notes string if present
        try:
            pp_attrs = pp.get('attributes') or {}
            pp_note = (pp_attrs.get('notes') or '').strip()
            if pp_note:
                notes_list = (notes_list or []) + [pp_note]
        except Exception:
            pass

        # collect category names present
        for n in valid_notes:
            attrs2 = n.get('attributes') or {}
            cat = (attrs2.get('category_name') or '').strip()
            if not cat:
                try:
                    rel_nc = ((n.get('relationships') or {}).get('note_category') or {}).get('data') or {}
                    cat_id = rel_nc.get('id')
                    if cat_id:
                        for t, items in included_maps.items():
                            if 'note_category' in t:
                                found = items.get(str(cat_id))
                                if found:
                                    cat = ((found.get('attributes') or {}).get('name') or '').strip()
                                    break
                except Exception:
                    pass
            if cat:
                cat_names.add(cat)

        if name:
            entry_key = (name, team_name or '', position)
            existing = out_people.get(entry_key)
            if existing:
                # Same person, same team, same position: one row scheduled to
                # several service times. Union the notes and keep a single row,
                # which is what stops a slot being written twice.
                seen = set()
                merged_notes: List[str] = []
                for val in (existing.get("notes") or []) + (notes_list or []):
                    if not val:
                        continue
                    note_key = str(val)
                    if note_key in seen:
                        continue
                    seen.add(note_key)
                    merged_notes.append(val)
                existing["notes"] = merged_notes
            else:
                out_people[entry_key] = {
                    "name": name,
                    "team": team_name or '',
                    "position": position,
                    "notes": notes_list,
                }

    people_list = sorted(
        out_people.values(),
        key=lambda x: (x.get('team') or '', x.get('name') or '', x.get('position') or ''))

    # Apply optional team name filters (case-insensitive substring match)
    mapping = pco_cfg.get('mapping') or {}
    filters = [f.strip().lower() for f in mapping.get('team_name_filter') or [] if f and f.strip()]
    if filters:
        people_list = [p for p in people_list if any(f in (p.get('team') or '').lower() for f in filters)]

    return {"ok": True, "plan_id": plan_id, "people": people_list, "note_categories": sorted(cat_names)}


def list_teams_for_plan(plan_id: str, service_type_value=None, force: bool = False) -> Dict[str, Any]:
    """Return every team scheduled on a plan, with how many people are on each.

    Deliberately ignores ``mapping.team_name_filter``.  This is what populates
    the team chooser, so it has to report the teams the operator has *not*
    picked as well -- filtering here would make a team impossible to re-add
    once it had been excluded.

    Counts distinct people rather than plan_people rows, because one person can
    hold several positions on the same team across service times.
    """
    try:
        pco_cfg = get_pco_config()
    except PcoConfigError as exc:
        logger.warning('PCO team list aborted: %s', exc)
        return {"ok": False, "error": str(exc)}

    auth = pco_cfg['auth']
    headers = {'Authorization': _basic_auth_header(auth['token'], auth['secret'])}

    if _short_circuit_missing(plan_id, force):
        return {"ok": False, "error": PLAN_GONE_ERROR}

    stid = _resolve_service_type_id(service_type_value, headers) if service_type_value is not None else None
    plan_people = _get_plan_people_with_service(stid, plan_id, headers) if stid else None
    if not plan_people:
        plan_people = _get_plan_people_any(plan_id, headers)
    if not plan_people:
        # Same rule as the people lookup: the sweep's trailing 404 is not
        # evidence about the plan, so ask the plan itself before condemning it.
        if _LAST_HTTP_ERROR == 404:
            if _plan_is_really_gone(plan_id, headers):
                _remember_missing_plan(plan_id)
                return {"ok": False, "error": PLAN_GONE_ERROR}
            return {"ok": False, "error": PLAN_PEOPLE_UNREADABLE_ERROR}
        return {"ok": False, "error": _fetch_error("Unable to fetch plan people")}

    _forget_missing_plan(plan_id)

    included_maps = _build_included_maps(plan_people.get('included') or [])
    members: Dict[str, set] = {}
    positions: Dict[str, set] = {}

    for pp in plan_people.get('data') or []:
        rel = pp.get('relationships') or {}

        team_rel = (rel.get('team') or {}).get('data') or {}
        team_obj = None
        if team_rel:
            team_obj = included_maps.get((team_rel.get('type') or '').lower(), {}).get(str(team_rel.get('id')))
        team_name = (((team_obj or {}).get('attributes') or {}).get('name') or '').strip()
        if not team_name:
            continue

        person_rel = (rel.get('person') or {}).get('data') or {}
        person_obj = None
        if person_rel:
            person_obj = included_maps.get((person_rel.get('type') or '').lower(), {}).get(str(person_rel.get('id')))
        name = _person_display_name(person_obj or {})

        members.setdefault(team_name, set())
        positions.setdefault(team_name, set())
        if name:
            members[team_name].add(name)
        position = ((pp.get('attributes') or {}).get('team_position_name') or '').strip()
        if position:
            positions[team_name].add(position)

    selected = [t.strip().lower() for t in ((pco_cfg.get('mapping') or {}).get('team_name_filter') or []) if t and t.strip()]

    teams = [{
        "name": team,
        "people": len(members[team]),
        "positions": sorted(positions[team]),
        # Mirrors _team_matches_filters: case-insensitive substring match.
        "selected": any(f in team.lower() for f in selected),
    } for team in sorted(members)]

    return {"ok": True, "plan_id": plan_id, "teams": teams, "filter_active": bool(selected)}


def _resolve_service_type_id(service_type_value, headers: Dict[str, str]) -> Optional[int]:
    """Resolve a service_type value (name or numeric) to an integer ID.
    - If numeric or numeric string: return as int.
    - Else: fetch service_types and match by attributes.name (case-insensitive).
    """
    if service_type_value is None:
        return None
    # numeric ID
    try:
        return int(service_type_value)
    except (TypeError, ValueError):
        pass
    # look up by name
    url = f"{BASE_URL}/service_types"
    data = _http_get(url, headers, params={"per_page": 200})
    if not data:
        return None
    target = str(service_type_value).strip().lower()
    for item in data.get('data') or []:
        attrs = item.get('attributes') or {}
        name = (attrs.get('name') or '').strip().lower()
        if name == target:
            try:
                return int(item.get('id'))
            except (TypeError, ValueError):
                continue
    return None


def _get_plan_people(plan_id: str, headers: Dict[str, str]) -> Optional[Dict[str, Any]]:
    # Include person, team, notes, and note_category if available
    url = f"{BASE_URL}/plans/{plan_id}/plan_people"
    params = {
        "include": "person,team,notes,notes.note_category",
        "per_page": 200
    }
    return _http_get(url, headers, params)


def _get_plan_notes(plan_id: str, headers: Dict[str, str]) -> Optional[Dict[str, Any]]:
    url = f"{BASE_URL}/plans/{plan_id}/notes"
    params = {
        "include": "note_category",
        "per_page": 200
    }
    return _http_get(url, headers, params)


def _get_plan_notes_with_service(service_type_id: int, plan_id: str, headers: Dict[str, str]) -> Optional[Dict[str, Any]]:
    url = f"{BASE_URL}/service_types/{service_type_id}/plans/{plan_id}/notes"
    params = {
        "include": "note_category",
        "per_page": 200
    }
    return _http_get(url, headers, params)


def _get_team_members(plan_id: str, headers: Dict[str, str]) -> Optional[Dict[str, Any]]:
    url = f"{BASE_URL}/plans/{plan_id}/team_members"
    params = {
        "include": "person,team,notes,notes.note_category",
        "per_page": 200
    }
    return _http_get(url, headers, params)


def _get_team_members_with_service(service_type_id: int, plan_id: str, headers: Dict[str, str]) -> Optional[Dict[str, Any]]:
    url = f"{BASE_URL}/service_types/{service_type_id}/plans/{plan_id}/team_members"
    params = {
        "include": "person,team,notes,notes.note_category",
        "per_page": 200
    }
    return _http_get(url, headers, params)


def _build_included_maps(included: List[Dict[str, Any]]) -> Dict[str, Dict[str, Dict[str, Any]]]:
    maps: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for item in included or []:
        t = (item.get('type') or '').lower()
        i = item.get('id')
        if not t or not i:
            continue
        if t not in maps:
            maps[t] = {}
        maps[t][str(i)] = item
    return maps


def _get_note_text_for_category(note_objs: List[Dict[str, Any]], maps: Dict[str, Dict[str, Dict[str, Any]]], category_name: str) -> Optional[str]:
    # Try to match by explicit related note_category name first
    cat_lower = (category_name or '').strip().lower()
    for n in note_objs or []:
        rel = ((n.get('relationships') or {}).get('note_category') or {}).get('data') or {}
        cat_id = rel.get('id')
        if cat_id:
            # note category type name in included may vary; scan all types that look like categories
            for t in maps.keys():
                if 'note_category' in t:
                    found = maps[t].get(str(cat_id))
                    if found:
                        name = ((found.get('attributes') or {}).get('name') or '').strip().lower()
                        if name == cat_lower:
                            # Prefer 'content' or 'value' attribute names
                            attrs = n.get('attributes') or {}
                            return (attrs.get('content') or attrs.get('value') or attrs.get('name') or '').strip()
    # Fallback: some APIs include category_name directly on the note attributes
    for n in note_objs or []:
        attrs = n.get('attributes') or {}
        c = (attrs.get('category_name') or '').strip().lower()
        if c == cat_lower:
            return (attrs.get('content') or attrs.get('value') or attrs.get('name') or '').strip()
    return None


def _extract_all_notes(note_objs: List[Dict[str, Any]], maps: Dict[str, Dict[str, Dict[str, Any]]]) -> List[str]:
    out: List[str] = []
    for n in note_objs or []:
        if not n:
            continue
        attrs = n.get('attributes') or {}
        text = (attrs.get('content') or attrs.get('value') or attrs.get('name') or '').strip()
        cat_name = ''
        try:
            rel = ((n.get('relationships') or {}).get('note_category') or {}).get('data') or {}
            cat_id = rel.get('id')
            if cat_id:
                for t, items in maps.items():
                    if 'note_category' in t:
                        found = items.get(str(cat_id))
                        if found:
                            cat_name = ((found.get('attributes') or {}).get('name') or '').strip()
                            break
        except Exception:
            pass
        if not cat_name:
            cat_name = (attrs.get('category_name') or '').strip()
        if text:
            out.append(f"{cat_name}: {text}" if cat_name else text)
    return out


def _collect_note_like_objects(rel: Dict[str, Any], maps: Dict[str, Dict[str, Dict[str, Any]]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if not isinstance(rel, dict):
        return out
    for key, obj in rel.items():
        data = (obj or {}).get('data')
        items: List[Dict[str, Any]]
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict) and data:
            items = [data]
        else:
            items = []
        for it in items:
            t = (it.get('type') or '').lower()
            i = it.get('id')
            inc = maps.get(t, {}).get(str(i)) if i is not None else None
            if not inc:
                continue
            attrs = inc.get('attributes') or {}
            rels = inc.get('relationships') or {}
            has_note_attr = any(k in attrs for k in ('content', 'value', 'category_name'))
            has_note_rel = 'note_category' in rels
            if ('note' in t) or has_note_attr or has_note_rel:
                out.append(inc)
    return out


def _extract_bracket_id(text: str) -> Optional[str]:
    if not text:
        return None
    m = re.search(r"\[\s*([^\]]+?)\s*\]", text)
    if not m:
        return None
    return m.group(1).strip()


def _person_display_name(p_item: Dict[str, Any]) -> str:
    attrs = (p_item.get('attributes') or {})
    first = attrs.get('first_name') or ''
    last = attrs.get('last_name') or ''
    name = (attrs.get('name') or '').strip()
    if name:
        return name
    return f"{first} {last}".strip()


def _get_plan_people_any(plan_id: str, headers: Dict[str, str]) -> Optional[Dict[str, Any]]:
    """Try to fetch plan_people for a plan id using generic path first,
    then fall back to checking all service_types for a scoped path.
    """
    # Try generic path first
    data = _get_plan_people(plan_id, headers)
    if data:
        return data

    # Try resolving the plan's service_type directly and fetch scoped path
    stid = _get_plan_service_type_id(plan_id, headers)
    if stid is not None:
        # First, try via the relationship link on the plan detail
        via_rel = _get_plan_people_via_relationship(plan_id, headers, stid)
        if via_rel:
            return via_rel
        data = _get_plan_people_with_service(stid, plan_id, headers)
        if data:
            return data
        # Try team_members endpoints as alternative
        data = _get_team_members_with_service(stid, plan_id, headers)
        if data:
            return data
    st_data = _http_get(f"{BASE_URL}/service_types", headers, params={"per_page": 200})
    if not st_data:
        return None
    for item in (st_data.get('data') or []):
        stid = item.get('id')
        try:
            stid_int = int(stid)
        except Exception:
            continue
        # try via relationship on plan detail scoped to this service_type
        via_rel = _get_plan_people_via_relationship(plan_id, headers, stid_int)
        if via_rel:
            return via_rel
        data = _get_plan_people_with_service(stid_int, plan_id, headers)
        if data:
            return data
        data = _get_team_members_with_service(stid_int, plan_id, headers)
        if data:
            return data
    # As last resort, try generic team_members
    data = _get_team_members(plan_id, headers)
    if data:
        return data
    return None


# What the board last synced, so a change in Planning Center can be noticed
# (#140). In memory on purpose: it describes this run of the server, not the
# configuration, and writing it would mean a config save per sync -- on the one
# file whose corruption once left a server that could not start.
_LAST_SYNC: Dict[str, Any] = {}


def plan_updated_at(plan_id: str, headers: Dict[str, str]) -> Optional[str]:
    """Planning Center's own `updated_at` for a plan.

    ⭐ One request, and it answers *whether* something changed without any
    diffing. What changed is a separate question, and `preview_sync` already
    answers it -- including which people a re-sync would take off the board.
    """
    if not plan_id:
        return None
    data = _http_get(f"{BASE_URL}/plans/{plan_id}", headers)
    if not data:
        return None
    attrs = (data.get('data') or {}).get('attributes') or {}
    return (attrs.get('updated_at') or '').strip() or None


def record_sync(plan_id: Optional[str], updated_at: Optional[str], profile_id: Optional[str]) -> None:
    """Remember what was synced, for change detection to compare against.

    ⚠️ Clears the watch as well. Syncing is what makes a plan the active one,
    so a board that stopped watching last Sunday's finished service starts
    again for this one -- without it, watching would end permanently at the
    first service after a restart.
    """
    if not plan_id:
        return
    _PLAN_WATCH.clear()
    _LAST_SYNC.clear()
    _LAST_SYNC.update({
        'plan_id': str(plan_id),
        'updated_at': updated_at or '',
        'profile_id': profile_id or '',
        'at': time.time(),
    })


def last_sync() -> Dict[str, Any]:
    """What the board last put on screen. Empty before the first sync."""
    return dict(_LAST_SYNC)


def forget_last_sync() -> None:
    _LAST_SYNC.clear()


def _watching_active_plan(pco_cfg: Dict[str, Any]) -> bool:
    """Whether the board should notice the active plan changing (#140).

    ⛔ Off by default. It costs a request per sync plus a poll, and it exists to
    support a policy -- notify, or re-sync automatically -- that #120 settled as
    the operator's to choose rather than the board's to assume.
    """
    return (pco_cfg or {}).get('watch_active_plan', False) is True


# What the most recent watch found, for the board payload to carry. Separate
# from `_LAST_SYNC`, which is what was applied; this is what has happened since.
_PLAN_WATCH: Dict[str, Any] = {}


# When a plan's service is over, keyed by plan id. Cached for the life of the
# plan being watched: times are set when the plan is built and almost never
# move, while the watcher would otherwise ask every two minutes all afternoon.
_PLAN_END: Dict[str, Tuple[float, Optional[str], bool]] = {}
_PLAN_END_TTL_SECONDS = 900


def _parse_iso(value: Optional[str]) -> Optional[datetime.datetime]:
    """Planning Center timestamps, which end in Z rather than +00:00."""
    if not value:
        return None
    text = str(value).strip()
    if text.endswith('Z'):
        text = text[:-1] + '+00:00'
    try:
        parsed = datetime.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime.timezone.utc)
    return parsed


def plan_end(plan_id: str, headers: Dict[str, str]) -> Tuple[Optional[str], bool]:
    """When a plan's service is scheduled to end, and whether it already has.

    Returns ``(ends_at, finished)``. ``finished`` is true when Planning Center
    Live has actually ended a service time -- ``live_ends_at`` is only set when
    somebody ran Live, which is the minority of services here, so the scheduled
    end is the path that has to work.

    ⚠️ Takes the **latest** end across the plan's times. A plan with a 9am and
    an 11am service is one plan, and the board is watching it until the last
    one is over.
    """
    key = str(plan_id or '')
    if not key:
        return (None, False)

    cached = _PLAN_END.get(key)
    if cached and time.monotonic() < cached[0]:
        return (cached[1], cached[2])

    data = _http_get(f"{BASE_URL}/plans/{key}/plan_times", headers, params={"per_page": 50})
    latest: Optional[datetime.datetime] = None
    finished = False
    for item in ((data or {}).get('data') or []):
        attrs = item.get('attributes') or {}
        if attrs.get('live_ends_at'):
            finished = True
        ends = _parse_iso(attrs.get('ends_at'))
        if ends and (latest is None or ends > latest):
            latest = ends

    result = (latest.isoformat() if latest else None, finished)
    if data is not None:
        # ⛔ A failed lookup is not cached. Caching "we do not know when this
        # ends" for fifteen minutes would stop the watcher reconsidering after
        # a blip, and the consequence of getting this wrong is a board that
        # silently stops watching during a service.
        _PLAN_END[key] = (time.monotonic() + _PLAN_END_TTL_SECONDS, result[0], result[1])
    return result


def forget_plan_ends() -> None:
    _PLAN_END.clear()


def watch_grace_minutes(pco_cfg: Optional[Dict[str, Any]] = None) -> int:
    """How long after a service's scheduled end to keep watching.

    Services run over. Watching for a while past the scheduled end is the point
    of this being a setting rather than a constant -- and the cost of being
    generous is a handful of extra requests, while the cost of being mean is a
    board that stops noticing changes during the service it was bought for.
    """
    raw = (pco_cfg or {}).get('watch_grace_minutes')
    try:
        minutes = int(raw)
    except (TypeError, ValueError):
        return 60
    return max(0, min(minutes, 24 * 60))


def watch_has_finished(pco_cfg: Dict[str, Any], plan_id: str, headers: Dict[str, str]) -> Optional[str]:
    """Why watching should stop for this plan, or None to keep going.

    ⛔ Returns None whenever it cannot tell. A plan with no times, or a lookup
    that failed, keeps the watcher running: over-polling costs a few requests,
    while stopping early means the board quietly stops noticing changes in the
    middle of the service it exists for.
    """
    ends_at, finished = plan_end(plan_id, headers)
    if finished:
        return 'the service has ended in Planning Center Live'

    ends = _parse_iso(ends_at)
    if not ends:
        return None

    grace = watch_grace_minutes(pco_cfg)
    deadline = ends + datetime.timedelta(minutes=grace)
    if datetime.datetime.now(datetime.timezone.utc) < deadline:
        return None

    if grace:
        return f'the service ended more than {grace} minutes ago'
    return 'the service has ended'


def _live_enabled(pco_cfg: Dict[str, Any]) -> bool:
    """⛔ Off by default, and it must stay that way. Live is not running for
    most services here, and a strip nobody asked for that spends API calls
    saying "Live not running" is worse than no strip."""
    return (pco_cfg or {}).get('live_strip', False) is True


def _item_time(payload: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """One ItemTime from a Live edge, with its Item folded in.

    Returns None when the edge is empty, which is what Planning Center gives
    for a plan Live has never been started on -- the only honest test for "is
    it running", since the API has no flag for it.
    """
    data = (payload or {}).get('data')
    if not data:
        return None
    if isinstance(data, list):
        data = data[0] if data else None
    if not data:
        return None

    times = data.get('attributes') or {}
    item_id = (((data.get('relationships') or {}).get('item') or {}).get('data') or {}).get('id')
    attrs = pco_live.item_from((payload or {}).get('included') or [], item_id)
    return pco_live.describe_item(attrs, times)


def live_status() -> Dict[str, Any]:
    """Where the service has got to, or why that cannot be said (#121).

    ⚠️ Follows the plan the board last synced, not the next upcoming one. The
    strip is about what is on screen now.

    ⛔ Every failure is reported as a state rather than an exception: a strip
    that disappears when the network hiccups is one nobody trusts to mean
    anything when it is absent.
    """
    try:
        pco_cfg = get_pco_config()
    except PcoConfigError:
        return {'state': 'off'}

    if not _live_enabled(pco_cfg):
        return {'state': 'off'}

    plan_id = last_sync().get('plan_id')
    if not plan_id:
        return {'state': 'no_plan', 'label': pco_live.state_label('no_plan')}

    auth = pco_cfg['auth']
    headers = {'Authorization': _basic_auth_header(auth['token'], auth['secret'])}

    params = {'include': 'item'}
    current_raw = _http_get(f"{BASE_URL}/plans/{plan_id}/live/current_item_time", headers, params)
    if current_raw is None:
        return {
            'state': 'error',
            'label': pco_live.state_label('error'),
            'plan_id': plan_id,
            'detail': _fetch_error('Unable to read the live position'),
        }

    current = _item_time(current_raw)
    # ⚠️ Only asked for when something is actually running. A plan nobody has
    # started Live on would otherwise pay for two requests a tick, forever.
    nxt = None
    if current and current.get('started_at'):
        nxt = _item_time(
            _http_get(f"{BASE_URL}/plans/{plan_id}/live/next_item_time", headers, params))

    asked_at = time.time()
    state = pco_live.live_state(
        enabled=True, plan_id=plan_id, current=current, asked_at=asked_at, now=asked_at)

    started = _parse_iso(current.get('started_at')) if current else None
    elapsed = pco_live.elapsed_seconds(started.timestamp() if started else None, asked_at)

    # ⚠️ Only fetched for the mode that needs it. "End service on time" is the
    # one that counts to the end of the service; the other two never look at
    # it, and `plan_end` is cached anyway so a long service pays once.
    mode = pco_live.timer_mode(pco_cfg.get('live_timer_mode'))
    service_end = None
    if mode == 'end_service_on_time':
        ends_at, _finished = plan_end(plan_id, headers)
        parsed_end = _parse_iso(ends_at)
        service_end = int(parsed_end.timestamp()) if parsed_end else None

    timer = pco_live.item_timer(
        mode,
        elapsed=elapsed,
        length=(current or {}).get('length'),
        service_end=service_end,
        now=asked_at,
    )

    return {
        'state': state,
        'label': pco_live.state_label(state),
        'plan_id': plan_id,
        'current': current,
        'next': nxt,
        'elapsed': elapsed,
        'over_by': pco_live.running_over(elapsed, (current or {}).get('length')),
        'timer': timer,
        'timer_label': pco_live.TIMER_LABELS.get(mode, ''),
        'clock': pco_live.format_clock(timer.get('seconds')),
        'asked_at': asked_at,
    }


def watch_interval_seconds(pco_cfg: Optional[Dict[str, Any]] = None) -> int:
    """How often to ask Planning Center whether the active plan changed.

    ⚠️ Deliberately slow. A plan edited an hour before a service is normal; a
    plan edited in the sixty seconds an operator would notice is not, and every
    poll is a request against an account's rate limit for the whole day, not
    just during a service. Two minutes is frequent enough that a change found
    at the end of rehearsal is still actionable.
    """
    raw = (pco_cfg or {}).get('watch_interval_seconds')
    try:
        seconds = int(raw)
    except (TypeError, ValueError):
        return 120
    # Floored rather than rejected: a config asking for 5 seconds is a mistake,
    # not a reason to refuse to watch at all.
    return max(30, min(seconds, 3600))


def plan_watch_status() -> Dict[str, Any]:
    """What the watcher last found. Empty when it has never run."""
    return dict(_PLAN_WATCH)


def forget_plan_watch() -> None:
    _PLAN_WATCH.clear()


def run_plan_watch() -> Dict[str, Any]:
    """One pass of the watcher. Returns what it found, and remembers it.

    ⛔ Every HTTP call and no writes, so it belongs on a worker -- see
    `start_plan_watch`. It reports; it never syncs.
    """
    try:
        pco_cfg = get_pco_config()
    except PcoConfigError:
        # Not an error worth repeating in the log every two minutes. A board
        # with PCO off simply has nothing to watch.
        _PLAN_WATCH.clear()
        return {}

    if not _watching_active_plan(pco_cfg):
        _PLAN_WATCH.clear()
        return {}

    # ⚠️ The caller wakes often and this decides whether to act, so changing
    # the interval takes effect without restarting the server.
    last = _PLAN_WATCH.get('checked_at')
    if last and (time.time() - last) < watch_interval_seconds(pco_cfg):
        return plan_watch_status()

    # ⭐ Stop once the service is over. A board left running all week would
    # otherwise poll Planning Center every two minutes about a plan nobody is
    # looking at any more, which is the account's rate limit spent on nothing.
    #
    # ⚠️ Any standing warning is kept. If the plan changed during the service,
    # that is still true afterwards, and retracting it the moment the service
    # ends would remove the notice at exactly the moment somebody might come
    # back to find out why the board looked wrong.
    remembered = last_sync()
    plan_id = remembered.get('plan_id')
    if plan_id:
        auth = pco_cfg['auth']
        headers = {'Authorization': _basic_auth_header(auth['token'], auth['secret'])}
        over = watch_has_finished(pco_cfg, plan_id, headers)
        if over:
            if not _PLAN_WATCH.get('finished'):
                logger.info('PCO: no longer watching plan %s -- %s', plan_id, over)
            _PLAN_WATCH['finished'] = over
            _PLAN_WATCH['checked_at'] = time.time()
            return plan_watch_status()

    result = check_active_plan()
    if result.get('ok') and result.get('known'):
        _PLAN_WATCH.clear()
        _PLAN_WATCH.update({
            'changed': bool(result.get('changed')),
            'plan_id': result.get('plan_id'),
            'checked_at': time.time(),
        })
        if result.get('changed'):
            logger.info(
                'PCO: plan %s has changed in Planning Center since it was synced',
                result.get('plan_id'),
            )
    elif not result.get('ok'):
        # ⚠️ Keeps any previous "changed" rather than replacing it with a
        # failure. A flaky network must not quietly retract a warning the
        # operator has already been shown.
        _PLAN_WATCH['error'] = result.get('error') or 'Unable to check the plan'
        _PLAN_WATCH['checked_at'] = time.time()
    return plan_watch_status()


def check_active_plan() -> Dict[str, Any]:
    """Has the plan on the board changed in Planning Center since it was synced?

    ⚠️ Answers about the plan the board **last synced**, not the plan nearest
    today. Those differ exactly when somebody syncs early, and the honest
    question is "is what is on screen still right", not "is there a newer plan".

    ⛔ Reports. Never syncs. Whether a change is applied automatically or waits
    for an admin is a policy decision made above this, and #120's rule that a
    sync is the operator's action is only reversed where the operator has asked
    for it.
    """
    remembered = last_sync()
    if not remembered.get('plan_id'):
        return {"ok": True, "known": False, "changed": False,
                "reason": "Nothing has been synced yet this run."}

    try:
        pco_cfg = get_pco_config()
    except PcoConfigError as exc:
        return {"ok": False, "error": str(exc)}

    auth = pco_cfg['auth']
    headers = {'Authorization': _basic_auth_header(auth['token'], auth['secret'])}

    current = plan_updated_at(remembered['plan_id'], headers)
    if current is None:
        # Could not ask. Not the same as "unchanged", and saying so stops a
        # dead network reading as a quiet all-clear.
        return {"ok": False, "known": True, "plan_id": remembered['plan_id'],
                "error": _fetch_error('Unable to check the plan')}

    was = remembered.get('updated_at') or ''
    changed = bool(was) and current != was
    return {
        "ok": True,
        "known": True,
        "changed": changed,
        "plan_id": remembered['plan_id'],
        "synced_at": remembered.get('at'),
        "profile_id": remembered.get('profile_id') or None,
        "updated_at": current,
        "previous_updated_at": was or None,
    }


def _get_plan_service_type_id(plan_id: str, headers: Dict[str, str]) -> Optional[int]:
    """Resolve the service_type id for a given plan id by querying the plan resource.
    Uses relationships and included service_type if available.
    """
    url = f"{BASE_URL}/plans/{plan_id}"
    # Ask to include service_type for a more robust resolution path
    data = _http_get(url, headers, params={"include": "service_type"})
    if not data:
        return None
    # First check relationships
    try:
        rel = (data.get('data') or {}).get('relationships') or {}
        st_rel = (rel.get('service_type') or {}).get('data') or {}
        st_id = st_rel.get('id')
        if st_id is not None:
            return int(st_id)
    except Exception:
        pass
    # Fallback: inspect included
    try:
        for inc in (data.get('included') or []):
            if (inc.get('type') or '').lower().endswith('service_type'):
                st_id = inc.get('id')
                if st_id is not None:
                    return int(st_id)
    except Exception:
        pass
    return None


def _get_plan_people_via_relationship(plan_id: str, headers: Dict[str, str], stid_hint: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """Fetch the plan detail and follow the relationships link to plan_people/team_members.
    stid_hint: when provided, fetch plan detail via service-scoped path which avoids redirects.
    """
    plan_data = None
    if stid_hint is not None:
        plan_data = _http_get(f"{BASE_URL}/service_types/{stid_hint}/plans/{plan_id}", headers, params={})
    if not plan_data:
        plan_data = _http_get(f"{BASE_URL}/plans/{plan_id}", headers, params={})
    if not plan_data:
        return None
    rel = ((plan_data.get('data') or {}).get('relationships') or {})
    link = None
    # try likely relationship names
    for key in ['plan_people', 'team_members', 'people']:
        obj = rel.get(key) or {}
        links = obj.get('links') or {}
        link = links.get('related') or links.get('self')
        if link:
            break
    if not link:
        return None
    # Follow the link; ensure we include related resources
    params = {"include": "person,team,notes,notes.note_category", "per_page": 200}
    return _http_get(link, headers, params)


def _team_matches_filters(team_name: Optional[str], team_filters: List[str]) -> bool:
    """Case-insensitive substring match, as documented for mapping.team_name_filter."""
    if not team_filters:
        return True
    haystack = (team_name or '').lower()
    return any(f in haystack for f in team_filters if f)


def _select_plan(
    services: Dict[str, Any],
    headers: Dict[str, str],
    plan_id_override: Optional[str] = None,
) -> Tuple[Optional[int], Optional[str], Optional[str]]:
    """Resolve which plan to read.

    Returns ``(service_type_id, plan_id, error)`` -- exactly one of ``plan_id``
    or ``error`` is set.
    """
    if plan_id_override:
        return (None, plan_id_override, None)

    plan_select = (services.get('plan') or {}).get('select', 'next')
    if plan_select != 'next':
        return (None, None, 'Unsupported plan selection')

    # If a service type was configured, use it; otherwise scan for the global next plan.
    st_raw = services.get('service_type') if 'service_type' in services else services.get('service_type_id')
    if st_raw:
        stid = _resolve_service_type_id(st_raw, headers)
        if not stid:
            return (None, None, 'Unable to resolve Service Type')
        return (stid, _get_next_plan_id(stid, headers), None)

    nxt = _get_next_plan_global(headers)
    if not nxt:
        return (None, None, 'No plan selected or upcoming plan found')
    return (nxt[0], nxt[1], None)


def _fetch_plan_people(stid: Optional[int], plan_id: str, headers: Dict[str, str]) -> Optional[Dict[str, Any]]:
    """Prefer the service-scoped plan_people path to avoid redirects and 404s."""
    plan_people = _get_plan_people_with_service(stid, plan_id, headers) if stid else None
    if not plan_people:
        plan_people = _get_plan_people_any(plan_id, headers)
    return plan_people


def _flatten_plan_people(
    plan_people: Dict[str, Any],
    category: str,
    team_filters: List[str],
) -> List[Dict[str, Any]]:
    """Reduce the PCO plan_people payload to the fields mapping cares about.

    Planning Center carries the mic name and number on the team position
    (``PlanPerson.attributes.team_position_name``), which is why that value is
    captured here alongside the legacy note/bracket sources.
    """
    included_maps = _build_included_maps(plan_people.get('included') or [])
    people: List[Dict[str, Any]] = []

    for pp in plan_people.get('data') or []:
        attrs = pp.get('attributes') or {}
        rel = pp.get('relationships') or {}

        team_rel = (rel.get('team') or {}).get('data') or {}
        team_name = None
        if team_rel:
            team_t = (team_rel.get('type') or '').lower()
            team_id = team_rel.get('id')
            team_obj = included_maps.get(team_t, {}).get(str(team_id)) if team_id else None
            team_name = ((team_obj or {}).get('attributes') or {}).get('name') if team_obj else None
        if not _team_matches_filters(team_name, team_filters):
            continue

        person_rel = (rel.get('person') or {}).get('data') or {}
        person_obj = None
        if person_rel:
            p_t = (person_rel.get('type') or '').lower()
            p_id = person_rel.get('id')
            person_obj = included_maps.get(p_t, {}).get(str(p_id)) if p_id else None
        person_name = _person_display_name(person_obj or {})
        # PlanPerson.name is a usable fallback when the person include is absent.
        if not person_name:
            person_name = (attrs.get('name') or '').strip()

        notes_data = (rel.get('notes') or {}).get('data') or []
        note_objs = []
        for nd in notes_data:
            nd_t = (nd.get('type') or '').lower()
            nd_id = nd.get('id')
            if nd_id:
                note_objs.append(included_maps.get(nd_t, {}).get(str(nd_id)))
        note_text = _get_note_text_for_category(
            [n for n in note_objs if n], included_maps, category)

        people.append({
            'name': person_name,
            'team': team_name or '',
            'position': (attrs.get('team_position_name') or '').strip(),
            'note': (note_text or '').strip(),
            'bracket_id': _extract_bracket_id(person_name) or '',
        })

    return people


def _dedupe_people(people: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Collapse duplicate rows for the same position, keeping the last one.

    A person scheduled to several service times shows up once per time; without
    this the same slot would be written repeatedly.
    """
    deduped: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    for person in people:
        key = (
            pco_mapping.normalize_label(person.get('position')),
            pco_mapping.normalize_label(person.get('note')),
            pco_mapping.normalize_label(person.get('name')),
        )
        deduped[key] = person
    return list(deduped.values())


# A sync is three jobs with different constraints, and #79 is about telling them
# apart. Splitting them lets the slow one move off the IOLoop while the two that
# touch config.json stay on it, so nothing new can race the file
# (config-durability history is why that matters).
#
#   begin_sync    loads config. MAY WRITE config.json -- ensure_credentials
#                 migrates credentials into the keyring through a save callback.
#                 â›” Caller must run this on the IOLoop.
#   resolve_sync  every HTTP call and all the matching. Writes nothing.
#                 âœ… Safe on a worker, and the only slow part.
#   finish_sync   applies the result. The single write. â›” IOLoop.
#
# sync_from_pco still chains all three, so every existing caller and test sees
# exactly what it did before.


def begin_sync() -> Dict[str, Any]:
    """Load the PCO config for a sync.

    â›” May write config.json, so it belongs on the IOLoop rather than a worker.
    """
    try:
        return {"ok": True, "config": get_pco_config()}
    except PcoConfigError as exc:
        logger.warning('PCO sync aborted: %s', exc)
        return {"ok": False, "error": str(exc)}


def resolve_sync(
    pco_cfg: Dict[str, Any],
    plan_id_override: Optional[str] = None,
    profile_override: Optional[str] = None,
) -> Dict[str, Any]:
    """Fetch the plan and work out which slot each person belongs in.

    Every network call lives here, and nothing here writes -- which is what
    makes it safe to run away from the IOLoop.
    """
    auth = pco_cfg['auth']
    headers = {
        'Authorization': _basic_auth_header(auth['token'], auth['secret'])
    }

    stid, plan_id, error = _select_plan(pco_cfg.get('services', {}), headers, plan_id_override)
    if error:
        return {"ok": False, "error": error}
    if not plan_id:
        return {"ok": False, "error": "No plan selected or upcoming plan found"}

    # ⭐ The rules have to be chosen before anything is read, because they
    # decide which note category and which teams are read in the first place.
    #
    # ⚠️ An explicitly chosen plan arrives without its service type, so
    # matching a bound profile costs one extra lookup. Only on that path, only
    # when a binding could actually apply, and it is off the IOLoop like every
    # other call here.
    if stid is None and not profile_override and pco_profiles.profiles_of(pco_cfg):
        stid = _get_plan_service_type_id(plan_id, headers)

    # ⚠️ The folder walk is one request per level. Only taken when some profile
    # actually binds to a folder and nothing more specific could already have
    # won -- a board whose profiles are all service-type-bound or hand-picked
    # pays nothing for a feature it is not using.
    folders: Tuple[str, ...] = ()
    if (
        stid is not None
        and not profile_override
        and not pco_profiles.profiles_for_service_type(pco_cfg, stid)
        and pco_profiles.binds_anywhere(pco_cfg)
    ):
        folders = folder_chain(stid, headers)

    profile, profile_reason, profile_error = pco_profiles.select_profile(
        pco_cfg, stid, profile_override, folders)
    if profile_error:
        return {"ok": False, "error": profile_error}

    mapping = pco_profiles.effective_mapping(pco_cfg, profile)

    # ⛔ `get_pco_config` validates the board's own mapping, but a profile can
    # override `strategy` and `note_source` and never passes through it. An
    # unsupported strategy produces no labels at all, so every person comes
    # back unmatched and the board looks like it simply found nobody -- the
    # failure that is hardest to tell from a real empty plan. Checked here,
    # where the profile that caused it can be named, and only for the profile
    # actually in force.
    mapping_error = _validate_mapping(mapping, profile)
    if mapping_error:
        return {"ok": False, "error": mapping_error}

    options = _mapping_options(mapping)
    category = mapping.get('note_category') or 'Mic / IEM Assignments'
    team_filters = [t.strip().lower() for t in (mapping.get('team_name_filter') or []) if t and t.strip()]

    plan_people = _fetch_plan_people(stid, plan_id, headers)
    if not plan_people:
        return {"ok": False, "error": _fetch_error("Unable to fetch plan people")}

    people = _dedupe_people(_flatten_plan_people(plan_people, category, team_filters))
    resolved, unmatched = resolve_assignments(people, options)
    conflicts = find_conflicts(resolved)

    return {
        "ok": True,
        "plan_id": plan_id,
        "service_type_id": stid,
        # ⚠️ Captured only when the board is actually watching for changes.
        # It is one more request on the path an operator is waiting on, and a
        # board that never asks "has this plan changed" must not pay for the
        # answer -- the same rule the folder walk follows.
        "plan_updated_at": (
            plan_updated_at(plan_id, headers) if _watching_active_plan(pco_cfg) else None
        ),
        "options": options,
        "category": category,
        "profile": _profile_report(profile, profile_reason),
        "profile_conflicts": pco_profiles.binding_conflicts(pco_cfg),
        "resolved": resolved,
        "unmatched": unmatched,
        "conflicts": conflicts,
        "people": people,
    }


def _validate_mapping(mapping: Dict[str, Any], profile: Optional[Dict[str, Any]]) -> Optional[str]:
    """Reject rules that would silently match nobody. Returns an error or None."""
    where = 'the board settings'
    if profile:
        where = 'profile "{}"'.format(profile.get('name') or profile.get('id'))

    strategy = mapping.get('strategy') or DEFAULT_STRATEGY
    if strategy not in SUPPORTED_STRATEGIES:
        return 'Unsupported strategy "{}" in {} (expected one of {})'.format(
            strategy, where, ', '.join(SUPPORTED_STRATEGIES))

    note_source = mapping.get('note_source') or 'auto'
    if note_source not in ('person', 'plan', 'auto'):
        return 'Unsupported note source "{}" in {}'.format(note_source, where)

    return None


def _profile_binding(profile: Optional[Dict[str, Any]]) -> Optional[str]:
    """How a profile is attached, for the panel to show beside its name."""
    if not profile:
        return None
    if profile.get('service_type_id'):
        return 'service_type'
    if profile.get('folder_id'):
        return 'folder'
    return None


def _profile_report(profile: Optional[Dict[str, Any]], reason: str) -> Dict[str, Any]:
    """What the board says about which rules it used.

    ⚠️ Always present, even when no profile applied. "Using the board
    settings." is a real answer; an absent field would leave the operator to
    infer it, and the whole point of profiles is that which rules ran is no
    longer obvious from the screen.
    """
    return {
        "id": (profile or {}).get('id') or None,
        "name": (profile or {}).get('name') or (profile or {}).get('id') or None,
        "reason": reason,
        "bound_to": _profile_binding(profile),
        "description": pco_profiles.describe_selection(profile, reason),
    }


def finish_sync(resolution: Dict[str, Any], dry_run: bool = False) -> Dict[str, Any]:
    """Apply a resolution and describe what happened.

    â›” `_apply_assignments` is the one thing in a sync that writes config.json,
    so this belongs on the IOLoop beside every other writer of that file.
    """
    if not resolution or not resolution.get('ok'):
        return resolution or {"ok": False, "error": "Unable to resolve the plan"}

    options = resolution['options']
    category = resolution['category']
    profile = resolution.get('profile') or {}
    resolved = resolution['resolved']
    unmatched = resolution['unmatched']
    conflicts = resolution['conflicts']
    people = resolution['people']
    plan_id = resolution['plan_id']

    # Reported either way, so a preview can say what a real sync would take off
    # the board -- which is the half of this that an operator needs to see
    # before agreeing to it.
    #
    # ⛔ Snapshot the names here, before anything clears them. `slots_to_clear`
    # hands back the live slot dicts, so reading `extended_name` off them after
    # the clear reports every name as empty -- a preview would be right and a
    # real sync would report "cleared 4 slots: None, None, None, None".
    stale = slots_to_clear(resolved) if options.get('clear_unmatched') else []
    clearable = [
        {"slot": slot.get('slot'), "name": slot.get('extended_name')}
        for slot in stale
    ]

    # ⛔ Built here, in the same breath as `clearable` and for the same reason:
    # it reads `extended_name` off the live slot dicts, so after
    # `_apply_assignments` every "from" would be the value just written and the
    # diff would agree with itself (#120).
    skipped_slots = conflicted_slots(conflicts)
    changes = sync_diff.build_changes(
        resolved,
        stale=stale,
        conflicts=conflicts,
        skip_slots=skipped_slots,
    )

    cleared = 0
    if not dry_run:
        updates = _apply_assignments(resolved, options, skipped_slots)
        if stale:
            cleared = _clear_unmatched(stale)
        if updates or cleared:
            try:
                config.save_current_config()
            except Exception as exc:  # noqa: BLE001
                logger.warning('Failed to save config after the sync: %s', exc)
    else:
        updates = 0

    for conflict in conflicts:
        logger.warning(
            'PCO sync: slot %s claimed by %s -- left alone, nobody written',
            conflict['slot'],
            ', '.join(sorted({c['name'] for c in conflict['claimants']})),
        )

    if profile.get('description'):
        logger.info('PCO sync: %s', profile['description'])

    for clash in (resolution.get('profile_conflicts') or []):
        logger.warning(
            'PCO profiles: service type %s is claimed by %s -- "%s" wins',
            clash.get('service_type_id'),
            ', '.join(clash.get('profiles') or []),
            clash.get('winner'),
        )

    if unmatched:
        logger.info(
            'PCO sync left %s scheduled %s unmatched (no slot for %s)',
            len(unmatched),
            'person' if len(unmatched) == 1 else 'people',
            ', '.join(sorted({u.get('position') or u.get('name') or '?' for u in unmatched})),
        )

    slots_matched = sum(len(entry.get('slots') or []) for entry in resolved)

    # ⚠️ Only a real sync changes what is on the board, so only a real sync
    # resets what change detection compares against. A preview that recorded
    # here would make the next check report "no change" about a plan nobody
    # ever applied.
    if not dry_run:
        record_sync(plan_id, resolution.get('plan_updated_at'), profile.get('id'))

    return {
        "ok": True,
        "dry_run": dry_run,
        "cleared": cleared,
        "clearable": clearable,
        # ⭐ The board's side of the same resolution: one row per slot, who is
        # on it, who would be. ⛔ Identical for a preview and for the sync that
        # follows, which is the only way "Apply does what Preview showed" can
        # be more than a hope (#120).
        "changes": changes,
        "changes_counts": sync_diff.counts(changes),
        # ⚠️ Named, not just counted. "1 conflict" tells an operator something
        # is wrong; "slot 4: Dave and Fatai both claim it, left alone" tells
        # them what to do about it before the service starts.
        "skipped": [
            {"slot": c.get('slot'),
             "claimants": sorted({x.get('name') or '' for x in c.get('claimants') or []})}
            for c in conflicts
        ],
        # ⚠️ Which rules ran is no longer obvious from the screen once profiles
        # exist, so every sync and every preview says so.
        "profile": profile,
        "profile_conflicts": resolution.get('profile_conflicts') or [],
        "plan_id": plan_id,
        "strategy": options['strategy'],
        "note_category": category,
        "people": len(people),
        "assignments": len(resolved),
        "slots_matched": slots_matched,
        "updates": updates,
        "unmatched": unmatched,
        "conflicts": conflicts,
        "assignment_details": [{
            "id": entry.get('label') or '',
            "name": entry.get('name') or '',
            "team": entry.get('team') or '',
            "position": entry.get('position') or '',
            "note": entry.get('note') or '',
            "matched_via": entry.get('matched_via') or '',
            "slots": entry.get('slots') or [],
        } for entry in resolved],
    }


def sync_from_pco(
    plan_id_override: Optional[str] = None,
    dry_run: bool = False,
    profile_override: Optional[str] = None,
) -> Dict[str, Any]:
    """Read the selected plan and map its people onto Wirelessboard slots.

    Each scheduled person is matched by their PCO team position name (for
    example ``Vocal 1``), falling back to the configured note category and to an
    ``[ID]`` in the person's name.  One position can resolve to several slots --
    typically the mic channel and its matching IEM channel -- and every match
    receives the person's name in ``extended_name``.

    With ``dry_run=True`` nothing is written; the resolved mapping is returned so
    the UI can show what a real sync would do.

    All three phases in order. The Tornado handler calls them separately so the
    network half can leave the IOLoop (#79); everything else -- tests, any other
    caller -- goes on using this and sees no change.
    """
    started = begin_sync()
    if not started.get('ok'):
        return started

    resolution = resolve_sync(started['config'], plan_id_override, profile_override)
    return finish_sync(resolution, dry_run=dry_run)


def preview_sync(
    plan_id_override: Optional[str] = None,
    profile_override: Optional[str] = None,
) -> Dict[str, Any]:
    """Dry-run of :func:`sync_from_pco` -- resolves the mapping without saving."""
    return sync_from_pco(plan_id_override, dry_run=True, profile_override=profile_override)


def notes_for_plan(plan_id_override: Optional[str] = None, source_override: Optional[str] = None) -> Dict[str, Any]:
    """
    Fetch notes for the configured category.
    source: 'person', 'plan', or 'auto' (try plan notes first, then people notes). Defaults to mapping.note_source or 'auto'.
    Read-only preview for the UI.
    """
    try:
        pco_cfg = get_pco_config()
    except PcoConfigError as exc:
        logger.warning('PCO notes preview aborted: %s', exc)
        return {"ok": False, "error": str(exc)}

    auth = pco_cfg['auth']
    headers = {
        'Authorization': _basic_auth_header(auth['token'], auth['secret'])
    }

    mapping = pco_cfg.get('mapping', {})
    category = mapping.get('note_category') or 'Mic / IEM Assignments'
    team_filters = [t.strip().lower() for t in (mapping.get('team_name_filter') or []) if t and t.strip()]
    source_raw = source_override or mapping.get('note_source') or 'auto'
    source = (source_raw or 'auto').lower()
    if source not in ['person', 'plan', 'auto']:
        source = 'auto'

    stid, plan_id, error = _select_plan(pco_cfg.get('services', {}), headers, plan_id_override)
    if error:
        return {"ok": False, "error": error}
    if not plan_id:
        return {"ok": False, "error": "No plan selected or upcoming plan found"}

    def _collect_plan_notes() -> Tuple[List[Dict[str, Any]], Optional[str]]:
        plan_notes = _get_plan_notes_with_service(stid, plan_id, headers) if stid else None
        if not plan_notes:
            plan_notes = _get_plan_notes(plan_id, headers)
        if not plan_notes:
            return ([], "Unable to fetch plan notes")

        included_maps = _build_included_maps(plan_notes.get('included') or [])
        collected: List[Dict[str, Any]] = []
        for item in (plan_notes.get('data') or []):
            attrs = item.get('attributes') or {}
            rels = item.get('relationships') or {}
            text = (attrs.get('content') or attrs.get('value') or attrs.get('name') or '').strip()
            cat_name = ''
            try:
                rel_nc = (rels.get('note_category') or {}).get('data') or {}
                cat_id = rel_nc.get('id')
                if cat_id:
                    for t, items in included_maps.items():
                        if 'note_category' in t:
                            found = items.get(str(cat_id))
                            if found:
                                cat_name = ((found.get('attributes') or {}).get('name') or '').strip()
                                break
            except Exception:
                pass
            if not cat_name:
                cat_name = (attrs.get('category_name') or '').strip()
            if cat_name.lower() != (category or '').lower():
                continue
            if text:
                collected.append({
                    "person": '',
                    "team": '',
                    "position": '',
                    "note": text,
                    "ext_id": '',
                })
        return (collected, None)

    def _collect_person_notes() -> Tuple[List[Dict[str, Any]], Optional[str]]:
        plan_people = _fetch_plan_people(stid, plan_id, headers)
        if not plan_people:
            return ([], "Unable to fetch plan people")

        collected: List[Dict[str, Any]] = []
        for person in _flatten_plan_people(plan_people, category, team_filters):
            # The position name is the primary identifier now, so a row is worth
            # showing whenever any of the three sources produced something.
            ext_id = person.get('position') or person.get('note') or person.get('bracket_id')
            if not (person.get('note') or ext_id):
                continue
            collected.append({
                "person": person.get('name') or '',
                "team": person.get('team') or '',
                "position": person.get('position') or '',
                "note": person.get('note') or '',
                "ext_id": ext_id or '',
            })
        return (collected, None)

    notes_out: List[Dict[str, Any]] = []
    resolved_source = source
    last_error: Optional[str] = None

    if source == 'plan':
        notes_out, last_error = _collect_plan_notes()
    elif source == 'person':
        notes_out, last_error = _collect_person_notes()
    else:  # auto
        plan_notes_out, err_plan = _collect_plan_notes()
        if plan_notes_out:
            notes_out = plan_notes_out
            resolved_source = 'plan'
            last_error = err_plan
        else:
            person_notes_out, err_person = _collect_person_notes()
            notes_out = person_notes_out
            resolved_source = 'person'
            last_error = err_person if err_person else err_plan

    if last_error and not notes_out:
        return {"ok": False, "error": last_error}

    return {
        "ok": True,
        "plan_id": plan_id,
        "note_category": category,
        "note_source": resolved_source,
        "notes": notes_out,
        "count": len(notes_out),
    }
