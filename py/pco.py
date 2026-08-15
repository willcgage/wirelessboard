import base64
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import requests

import config
import pco_mapping
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

    Two people scheduled to the same position -- or two positions that collide via
    the number fallback -- would otherwise silently overwrite each other, with the
    last one processed winning.
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
                'winner': claimants[-1]['name'],
            })
    return sorted(conflicts, key=lambda c: (c['slot'] is None, c['slot']))


def _apply_assignments(resolved: List[Dict[str, Any]], options: Dict[str, Any]) -> int:
    """Write ``extended_name`` onto every resolved slot. Returns slots changed.

    Device names (live or manually entered) are preserved exactly as-is so PCO
    can never overwrite a channel label.  ``extended_id`` is left alone unless
    ``mapping.seed_extended_id`` is enabled and the slot has none yet.
    """
    seed_extended_id = options.get('seed_extended_id', False)
    updated = 0

    for entry in resolved:
        ext_name = entry.get('name') or ''
        label = entry.get('label') or ''
        for match in entry.get('_matches') or []:
            slot = match['slot']

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

    if updated:
        try:
            config.save_current_config()
        except Exception as exc:
            logger.warning('Failed to save config: %s', exc)
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


def list_people_for_plan(plan_id: str, service_type_value=None) -> Dict[str, Any]:
    """Return the scheduled assignments on a plan, one row per person *per position*.

    A row is (name, team, position) rather than one row per person: somebody
    rostered to Band and to Vocal Team on the same plan holds two assignments
    and may need a channel for each. Rows are still collapsed across service
    times, so a person scheduled morning and evening appears once.

    ``service_type`` is optional and only avoids a redirect.
    """
    try:
        pco_cfg = get_pco_config()
    except PcoConfigError as exc:
        logger.warning('PCO people list aborted: %s', exc)
        return {"ok": False, "error": str(exc)}

    auth = pco_cfg['auth']
    headers = { 'Authorization': _basic_auth_header(auth['token'], auth['secret']) }

    if _plan_is_known_missing(plan_id):
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
        if _LAST_HTTP_ERROR == 404:
            _remember_missing_plan(plan_id)
            return {"ok": False, "error": PLAN_GONE_ERROR}
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


def list_teams_for_plan(plan_id: str, service_type_value=None) -> Dict[str, Any]:
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

    if _plan_is_known_missing(plan_id):
        return {"ok": False, "error": PLAN_GONE_ERROR}

    stid = _resolve_service_type_id(service_type_value, headers) if service_type_value is not None else None
    plan_people = _get_plan_people_with_service(stid, plan_id, headers) if stid else None
    if not plan_people:
        plan_people = _get_plan_people_any(plan_id, headers)
    if not plan_people:
        if _LAST_HTTP_ERROR == 404:
            _remember_missing_plan(plan_id)
            return {"ok": False, "error": PLAN_GONE_ERROR}
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


def sync_from_pco(plan_id_override: Optional[str] = None, dry_run: bool = False) -> Dict[str, Any]:
    """Read the selected plan and map its people onto Wirelessboard slots.

    Each scheduled person is matched by their PCO team position name (for
    example ``Vocal 1``), falling back to the configured note category and to an
    ``[ID]`` in the person's name.  One position can resolve to several slots --
    typically the mic channel and its matching IEM channel -- and every match
    receives the person's name in ``extended_name``.

    With ``dry_run=True`` nothing is written; the resolved mapping is returned so
    the UI can show what a real sync would do.
    """
    try:
        pco_cfg = get_pco_config()
    except PcoConfigError as exc:
        logger.warning('PCO sync aborted: %s', exc)
        return {"ok": False, "error": str(exc)}

    auth = pco_cfg['auth']
    headers = {
        'Authorization': _basic_auth_header(auth['token'], auth['secret'])
    }

    mapping = pco_cfg.get('mapping', {})
    options = _mapping_options(mapping)
    category = mapping.get('note_category') or 'Mic / IEM Assignments'
    team_filters = [t.strip().lower() for t in (mapping.get('team_name_filter') or []) if t and t.strip()]

    stid, plan_id, error = _select_plan(pco_cfg.get('services', {}), headers, plan_id_override)
    if error:
        return {"ok": False, "error": error}
    if not plan_id:
        return {"ok": False, "error": "No plan selected or upcoming plan found"}

    plan_people = _fetch_plan_people(stid, plan_id, headers)
    if not plan_people:
        return {"ok": False, "error": _fetch_error("Unable to fetch plan people")}

    people = _dedupe_people(_flatten_plan_people(plan_people, category, team_filters))
    resolved, unmatched = resolve_assignments(people, options)
    conflicts = find_conflicts(resolved)

    updates = 0 if dry_run else _apply_assignments(resolved, options)

    for conflict in conflicts:
        logger.warning(
            'PCO sync: slot %s claimed by %s -- "%s" wins',
            conflict['slot'],
            ', '.join(sorted({c['name'] for c in conflict['claimants']})),
            conflict['winner'],
        )

    if unmatched:
        logger.info(
            'PCO sync left %s scheduled %s unmatched (no slot for %s)',
            len(unmatched),
            'person' if len(unmatched) == 1 else 'people',
            ', '.join(sorted({u.get('position') or u.get('name') or '?' for u in unmatched})),
        )

    slots_matched = sum(len(entry.get('slots') or []) for entry in resolved)

    return {
        "ok": True,
        "dry_run": dry_run,
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


def preview_sync(plan_id_override: Optional[str] = None) -> Dict[str, Any]:
    """Dry-run of :func:`sync_from_pco` -- resolves the mapping without saving."""
    return sync_from_pco(plan_id_override, dry_run=True)


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
