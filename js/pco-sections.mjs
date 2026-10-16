/**
 * Planning Center, split into sections that each own their own settings (#179).
 *
 * ⛔⛔ **The rule this file exists to enforce:** *no section writes a key it
 * does not own, and no section is reachable before the connection it depends
 * on.*
 *
 * The panel this replaces put forty `pco-` elements inside one `<form>` behind
 * one Save. `buildPcoPayload()` read every field out of the DOM and posted them
 * together, and `update_pco_config` takes each top-level key it is given and
 * **replaces** it — so there was no way to change one setting without rewriting
 * all of them from whatever the page happened to be holding. A list that failed
 * to populate, or a change made from another board since the panel was opened,
 * was propagated over the stored value.
 *
 * ⭐ The server needs nothing for this. `update_pco_config` already merges at
 * the top level (`merged[key] = value` per key present), so a payload carrying
 * only one section's keys leaves every other section byte-identical. The fault
 * was always on this side.
 */

/**
 * ⛔⛔ `auto_sync` is a **mapping** key and must stay one.
 *
 * It looks like it belongs under Calendar & automation, and the issue lists it
 * there. It cannot go there: `pco_auto_sync.AUTO_SYNC_KEY` is read through
 * `pco_profiles.effective_mapping`, which is what makes it **inherit per rule
 * set** — the maintainer asked for exactly that, so Youth can sync
 * automatically while the main service stays manual. Moving it out of `mapping`
 * would silently take that away.
 *
 * ⚠️ And a *partial* mapping cannot be sent instead, because the server
 * replaces the whole sub-object. So whichever section sends `mapping` owns
 * every leaf in it, `auto_sync` included — which is why the automatic-sync
 * switch sits with the other sync rules rather than with the watch settings.
 */
export const MAPPING_KEYS = [
  'strategy',
  'note_category',
  'note_source',
  'team_name_filter',
  'position_number_fallback',
  'seed_extended_id',
  'clear_unmatched',
  'auto_sync',
];

/**
 * The sections, in rail order, and the top-level `pco.*` keys each one owns.
 *
 * ⛔ Every key exactly once. `ownershipIsExclusive` below is the test that says
 * so, and it is the whole point of the list being data rather than prose.
 */
export const PCO_SECTIONS = [
  {
    id: 'pco-connection',
    label: 'Connection',
    owns: ['auth', 'enabled'],
    controls: ['pco-token', 'pco-secret', 'pco-connect', 'pco-enabled'],
    // ⛔ The only section reachable before a connection exists.
    needsConnection: false,
  },
  {
    id: 'pco-matching',
    label: 'Matching',
    owns: ['services', 'mapping'],
    controls: ['pco-service-type-id', 'pco-team-filter', 'pco-note-category', 'pco-note-source', 'pco-strategy', 'pco-number-fallback', 'pco-seed-extended-id', 'pco-clear-unmatched', 'pco-auto-sync'],
    needsConnection: true,
  },
  {
    id: 'pco-rulesets',
    label: 'Rule sets',
    owns: ['profiles', 'default_profile'],
    controls: ['pco-profile-list', 'pco-profile-add'],
    needsConnection: true,
  },
  {
    id: 'pco-calendar',
    label: 'Calendar & automation',
    owns: ['watch_active_plan', 'watch_interval_seconds', 'watch_grace_minutes'],
    controls: ['pco-watch-active', 'pco-watch-interval', 'pco-watch-grace'],
    needsConnection: true,
  },
  {
    id: 'pco-live',
    label: 'Live options',
    owns: ['live_strip', 'live_timer_mode'],
    controls: ['pco-live-strip', 'pco-live-timer-mode'],
    needsConnection: true,
  },
];

/** Every section id, for the rail and for `IN_PAGE_ITEMS`. */
export const PCO_SECTION_IDS = PCO_SECTIONS.map((s) => s.id);

/** The section that owns a key, or null. */
export function ownerOf(key) {
  const found = PCO_SECTIONS.find((section) => section.owns.includes(key));
  return found ? found.id : null;
}

/**
 * Is a connection actually in place?
 *
 * ⛔ Stored credentials, never the `enabled` switch. `enabled` is the
 * administrator's choice about whether this board uses Planning Center at all,
 * and conflating the two is the bug behind "never flip an admin switch as a
 * side effect": a successful Connect would have read as "turn it on".
 */
export function isConnected(pco) {
  if (!pco || typeof pco !== 'object') {
    return false;
  }
  const auth = pco.auth;
  return !!(auth && typeof auth === 'object' && auth.has_credentials);
}

/**
 * Which sections may be interacted with.
 *
 * ⛔ A fact before it is a rule. Service types, teams, note categories and
 * plans are all fetched *from the account*, so before a connection exists every
 * control below Connection has nothing to offer — the panel today lets somebody
 * scroll through them, open the selects and set things anyway.
 */
export function sectionAvailable(sectionId, pco) {
  const section = PCO_SECTIONS.find((s) => s.id === sectionId);
  if (!section) {
    return false;
  }
  return section.needsConnection ? isConnected(pco) : true;
}

/** One honest sentence, rather than a tooltip per control. */
export const NOT_CONNECTED_NOTE = 'Everything here is chosen from lists that live in your '
  + 'Planning Center account, so it stays unavailable until this board is connected.';

function str(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

function bool(value) {
  return value === true;
}

/**
 * Build one section's payload — **only** the keys it owns.
 *
 * ⛔ Throws rather than filtering silently when handed a key it does not own.
 * A payload that quietly drops a field looks exactly like a save that worked,
 * and the fault this whole split exists to remove was invisible for the same
 * reason.
 */
export function payloadFor(sectionId, values = {}) {
  const section = PCO_SECTIONS.find((s) => s.id === sectionId);
  if (!section) {
    throw new Error(`unknown PCO section: ${sectionId}`);
  }
  const stray = Object.keys(values).filter((key) => !section.owns.includes(key));
  if (stray.length) {
    throw new Error(`${sectionId} does not own: ${stray.join(', ')}`);
  }
  const payload = {};
  section.owns.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      payload[key] = values[key];
    }
  });
  return payload;
}

/**
 * The state line each rail item carries, so an administrator sees what is set
 * from one screen instead of opening five panes to find out.
 */
export function pcoStateLine(sectionId, pco) {
  const cfg = pco && typeof pco === 'object' ? pco : {};
  const connected = isConnected(cfg);

  if (sectionId === 'pco-connection') {
    if (!connected) {
      return 'Not connected';
    }
    // ⚠️ Credentials stored and the integration switched off are different
    // states; conflating them is how somebody concludes a sync is broken when
    // it was simply never turned on.
    return cfg.enabled ? 'Connected' : 'Connected, switched off';
  }

  if (!connected) {
    return 'Needs a connection';
  }

  switch (sectionId) {
    case 'pco-matching': {
      const services = cfg.services && typeof cfg.services === 'object' ? cfg.services : {};
      const mapping = cfg.mapping && typeof cfg.mapping === 'object' ? cfg.mapping : {};
      const teams = Array.isArray(mapping.team_name_filter) ? mapping.team_name_filter.length : 0;
      const service = str(services.service_type_name) || (str(services.service_type_id) ? 'Service type set' : '');
      const parts = [];
      if (service) parts.push(service);
      if (teams) parts.push(teams === 1 ? '1 team' : `${teams} teams`);
      return parts.length ? parts.join(' · ') : 'Nothing matched yet';
    }

    case 'pco-rulesets': {
      const profiles = Array.isArray(cfg.profiles) ? cfg.profiles : [];
      if (!profiles.length) {
        return 'None — the board mapping is used';
      }
      return profiles.length === 1 ? '1 rule set' : `${profiles.length} rule sets`;
    }

    case 'pco-calendar': {
      if (!cfg.watch_active_plan) {
        return 'Not watching';
      }
      // ⚠️ "Watching, never fired" is a real and common state, and saying it
      // plainly is the difference between trusting the feature and suspecting
      // it.
      const mapping = cfg.mapping && typeof cfg.mapping === 'object' ? cfg.mapping : {};
      return mapping.auto_sync ? 'Watching, syncs itself' : 'Watching, notifies';
    }

    case 'pco-live': {
      if (!cfg.live_strip) {
        return 'Strip off';
      }
      const mode = str(cfg.live_timer_mode);
      return mode ? `Strip on · ${mode}` : 'Strip on';
    }

    default:
      return null;
  }
}

/**
 * ⛔ A guard with teeth: every key the old single payload wrote must be owned
 * by exactly one section. Used by the test, exported so it cannot rot in a
 * comment.
 */
export function ownershipIsExclusive() {
  const seen = new Map();
  PCO_SECTIONS.forEach((section) => {
    section.owns.forEach((key) => {
      if (seen.has(key)) {
        seen.set(key, [...seen.get(key), section.id]);
      } else {
        seen.set(key, [section.id]);
      }
    });
  });
  const shared = Array.from(seen.entries()).filter(([, owners]) => owners.length > 1);
  return { ok: shared.length === 0, shared };
}
