import base64
import logging
import re
from typing import Dict, Any, List, Tuple, Optional

import requests

import config

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

    auth = pco_cfg.get('auth', {})
    token = auth.get('token')
    secret = auth.get('secret')
    if not token or not secret:
        raise PcoConfigError('Missing PCO auth token/secret')

    services = pco_cfg.get('services', {})
    # Service selection is optional; when omitted, we aggregate across all services
    plan_sel = (services.get('plan') or {}).get('select', 'next')
    if plan_sel not in ['next']:
        raise PcoConfigError('Unsupported plan selection mode')

    mapping = pco_cfg.get('mapping', {})
    strategy = mapping.get('strategy', 'note_or_brackets')
    if strategy not in ['note_or_brackets']:
        raise PcoConfigError('Unsupported mapping.strategy')

    return pco_cfg


def _basic_auth_header(token: str, secret: str) -> str:
    raw = f"{token}:{secret}".encode('utf-8')
    return 'Basic ' + base64.b64encode(raw).decode('ascii')


def _find_slot_by_ext_id(ext_id: str) -> Optional[Dict[str, Any]]:
    for slot in (config.config_tree or {}).get('slots', []):
        if slot.get('extended_id') == ext_id:
            return slot
    return None


def _apply_assignments(assignments: List[Tuple[str, str]]) -> int:
    """
    assignments: list of tuples (extended_id, extended_name)
    Returns count of updated slots.
    """
    updated = 0
    for ext_id, ext_name in assignments:
        slot = _find_slot_by_ext_id(ext_id)
        if slot is None:
            continue
        changed = False
        if slot.get('extended_id') != ext_id:
            slot['extended_id'] = ext_id
            changed = True
        if slot.get('extended_name') != ext_name:
            slot['extended_name'] = ext_name
            changed = True
        if changed:
            updated += 1
    if updated:
        try:
            config.save_current_config()
        except Exception as e:
            logging.warning(f"Failed to save config: {e}")
    return updated


# -----------------------
# PCO API helpers
# -----------------------

BASE_URL = 'https://api.planningcenteronline.com/services/v2'


def _http_get(url: str, headers: Dict[str, str], params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=10)
        if resp.status_code != 200:
            logging.warning(f"PCO GET {url} failed: {resp.status_code} {resp.text[:200]}")
            return None
        return resp.json()
    except Exception as e:
        logging.warning(f"PCO request error: {e}")
        return None


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
    except PcoConfigError as e:
        logging.warning(f"PCO services list aborted: {e}")
        return {"ok": False, "error": str(e)}

    auth = pco_cfg['auth']
    headers = { 'Authorization': _basic_auth_header(auth['token'], auth['secret']) }
    data = _http_get(f"{BASE_URL}/service_types", headers, params={"per_page": 200})
    if not data:
        return {"ok": False, "error": "Unable to fetch service types"}
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
    except PcoConfigError as e:
        logging.warning(f"PCO plans list aborted: {e}")
        return {"ok": False, "error": str(e)}

    auth = pco_cfg['auth']
    headers = { 'Authorization': _basic_auth_header(auth['token'], auth['secret']) }

    stid = _resolve_service_type_id(service_type_value, headers)
    if not stid:
        return {"ok": False, "error": "Unable to resolve Service Type"}

    url = f"{BASE_URL}/service_types/{stid}/plans"
    data = _http_get(url, headers, params={"filter": "future", "per_page": 25, "order": "sort_date"})
    if not data:
        return {"ok": False, "error": "Unable to fetch plans"}
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
    except PcoConfigError as e:
        logging.warning(f"PCO plans list aborted: {e}")
        return {"ok": False, "error": str(e)}

    auth = pco_cfg['auth']
    headers = { 'Authorization': _basic_auth_header(auth['token'], auth['secret']) }

    st_data = _http_get(f"{BASE_URL}/service_types", headers, params={"per_page": 200})
    if not st_data:
        return {"ok": False, "error": "Unable to fetch service types"}
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
    """Return people for a specific plan. If service_type is provided, uses scoped URL to avoid redirects."""
    try:
        pco_cfg = get_pco_config()
    except PcoConfigError as e:
        logging.warning(f"PCO people list aborted: {e}")
        return {"ok": False, "error": str(e)}

    auth = pco_cfg['auth']
    headers = { 'Authorization': _basic_auth_header(auth['token'], auth['secret']) }

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
        return {"ok": False, "error": "Unable to fetch plan people"}

    included_maps = _build_included_maps(plan_people.get('included') or [])
    out_people: Dict[str, Dict[str, Any]] = {}
    cat_names: set = set()

    for pp in plan_people.get('data') or []:
        rel = pp.get('relationships') or {}

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
            existing = out_people.get(name)
            if existing:
                merged_team = existing.get("team") or team_name
                # Union notes arrays, preserve order where possible
                seen = set()
                merged_notes: List[str] = []
                for val in (existing.get("notes") or []) + (notes_list or []):
                    if not val:
                        continue
                    key = str(val)
                    if key in seen:
                        continue
                    seen.add(key)
                    merged_notes.append(val)
                out_people[name] = {"name": name, "team": merged_team, "notes": merged_notes}
            else:
                out_people[name] = {"name": name, "team": team_name, "notes": notes_list}

    people_list = sorted(out_people.values(), key=lambda x: (x.get('team') or '', x.get('name') or ''))
    return {"ok": True, "plan_id": plan_id, "people": people_list, "note_categories": sorted(cat_names)}


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


def sync_from_pco(plan_id_override: Optional[str] = None) -> Dict[str, Any]:
    """
    Fetch the selected plan, read person notes by configured category, map to (extended_id, extended_name), and apply.
    """
    try:
        pco_cfg = get_pco_config()
    except PcoConfigError as e:
        logging.warning(f"PCO sync aborted: {e}")
        return {"ok": False, "error": str(e)}

    auth = pco_cfg['auth']
    headers = {
        'Authorization': _basic_auth_header(auth['token'], auth['secret'])
    }

    services = pco_cfg.get('services', {})
    plan_select = (services.get('plan') or {}).get('select', 'next')
    mapping = pco_cfg.get('mapping', {})
    category = mapping.get('note_category') or 'Mic / IEM Assignments'
    team_filters = [t.lower() for t in (mapping.get('team_name_filter') or [])]

    plan_id = None
    stid = None
    if plan_id_override:
        plan_id = plan_id_override
    else:
        if plan_select == 'next':
            # If service_type was configured, use that; else find global next
            st_raw = services.get('service_type') if 'service_type' in services else services.get('service_type_id')
            if st_raw:
                stid = _resolve_service_type_id(st_raw, headers)
                if not stid:
                    return {"ok": False, "error": "Unable to resolve Service Type"}
                plan_id = _get_next_plan_id(stid, headers)
            else:
                nxt = _get_next_plan_global(headers)
                if nxt:
                    stid, plan_id = nxt[0], nxt[1]
        else:
            return {"ok": False, "error": "Unsupported plan selection"}

    if not plan_id:
        return {"ok": False, "error": "No plan selected or upcoming plan found"}

    # Prefer service-scoped plan_people path to avoid redirects and 404s. If no stid
    # is known or that fails, try generic and then scan all services as a fallback.
    plan_people = _get_plan_people_with_service(stid, plan_id, headers) if stid else None
    if not plan_people:
        plan_people = _get_plan_people_any(plan_id, headers)
    if not plan_people:
        return {"ok": False, "error": "Unable to fetch plan people"}

    included_maps = _build_included_maps(plan_people.get('included') or [])

    assignments: List[Tuple[str, str]] = []
    for pp in plan_people.get('data') or []:
        rel = pp.get('relationships') or {}
        # team filter
        team_rel = (rel.get('team') or {}).get('data') or {}
        if team_rel:
            team_t = (team_rel.get('type') or '').lower()
            team_id = team_rel.get('id')
            team_obj = included_maps.get(team_t, {}).get(str(team_id)) if team_id else None
            team_name = ((team_obj or {}).get('attributes') or {}).get('name') if team_obj else None
            if team_filters and (not team_name or team_name.lower() not in team_filters):
                continue

        # person name
        person_rel = (rel.get('person') or {}).get('data') or {}
        person_obj = None
        if person_rel:
            p_t = (person_rel.get('type') or '').lower()
            p_id = person_rel.get('id')
            person_obj = included_maps.get(p_t, {}).get(str(p_id)) if p_id else None
        person_name = _person_display_name(person_obj or {})

        # notes
        notes_data = (rel.get('notes') or {}).get('data') or []
        note_objs = []
        for nd in notes_data:
            nd_t = (nd.get('type') or '').lower()
            nd_id = nd.get('id')
            note_objs.append(included_maps.get(nd_t, {}).get(str(nd_id)) if nd_id else None)
        note_text = _get_note_text_for_category([n for n in note_objs if n], included_maps, category)

        ext_id = None
        if note_text:
            ext_id = note_text.strip()
        if not ext_id:
            # fallback to bracketed id in person name
            ext_id = _extract_bracket_id(person_name)

        if ext_id:
            assignments.append((ext_id, person_name))

    # Deduplicate by ext_id, keep last occurrence
    dedup: Dict[str, str] = {}
    for ext_id, name in assignments:
        dedup[ext_id] = name
    dedup_list = [(k, v) for k, v in dedup.items()]

    updates = _apply_assignments(dedup_list)

    return {
        "ok": True,
        "plan_id": plan_id,
        "assignments": len(dedup_list),
        "updates": updates,
        "assignment_details": [{"id": i[0], "name": i[1]} for i in dedup_list]
    }
