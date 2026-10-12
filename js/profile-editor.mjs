/**
 * Editing the assignment rule sets (#139).
 *
 * The server side has had profiles since #139, but they could only be created
 * by editing `config.json` by hand — which on a board whose whole audience is
 * a volunteer on a Sunday morning means they did not exist.
 *
 * ⛔ Everything here is about one risk: a profile that *looks* configured and
 * matches nothing. A binding to a folder that was renamed, two profiles
 * claiming the same service type, a name with no rules under it — each of
 * those syncs happily and quietly uses the board's settings instead, which is
 * the failure mode #139's error-on-unknown-profile rule exists to avoid and
 * which an editor can reintroduce by being careless.
 */

/** The mapping keys a profile may override, in the order the panel shows them. */
export const OVERRIDABLE = [
  { key: 'strategy', label: 'Assignment source' },
  { key: 'note_category', label: 'Note category' },
  { key: 'note_source', label: 'Note source' },
  { key: 'team_name_filter', label: 'Teams' },
  { key: 'position_number_fallback', label: 'Number fallback' },
  { key: 'seed_extended_id', label: 'Fill empty slot IDs' },
  { key: 'clear_unmatched', label: 'Clear unfilled slots' },
  // ⛔ The reason this list is per profile at all (#140): Youth may re-sync
  // itself while the main service waits for a person.
  { key: 'auto_sync', label: 'Re-sync by itself' },
];

/** A stable id from a name: lowercase, hyphenated, no surprises in a URL. */
export function slugify(name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug;
}

/** A unique id for `name`, avoiding every id already in `existing`. */
export function uniqueId(name, existing = []) {
  const taken = new Set(existing.map((p) => (p && p.id ? String(p.id) : '')));
  const base = slugify(name) || 'profile';
  if (!taken.has(base)) {
    return base;
  }
  // ⚠️ Ids are what a sync names when it refuses an unknown profile, so they
  // have to stay stable and distinct even when two profiles share a name.
  for (let n = 2; n < 999; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now()}`;
}

/** How a profile is attached: 'service_type', 'folder' or 'manual'. */
export function bindingKind(profile) {
  if (!profile || typeof profile !== 'object') {
    return 'manual';
  }
  if (String(profile.service_type_id || '').trim()) {
    return 'service_type';
  }
  if (String(profile.folder_id || '').trim()) {
    return 'folder';
  }
  return 'manual';
}

/** The mapping keys this profile actually overrides. */
export function overriddenKeys(profile) {
  const mapping = (profile && profile.mapping) || {};
  return OVERRIDABLE
    .map((entry) => entry.key)
    .filter((key) => key in mapping && mapping[key] !== null && mapping[key] !== undefined);
}

/**
 * One line describing a profile, for the list.
 *
 * ⭐ Names what it is bound to, not just that it is bound. "Bound to a folder"
 * is useless when the question is which folder — and a binding pointing at a
 * folder that no longer exists is the main way a profile goes quietly dead.
 */
export function describeBinding(profile, { serviceTypes = [], folders = [] } = {}) {
  const kind = bindingKind(profile);
  if (kind === 'manual') {
    return 'Chosen by hand';
  }

  if (kind === 'service_type') {
    const id = String(profile.service_type_id);
    const match = serviceTypes.find((s) => String(s.id) === id);
    return match ? `Service type: ${match.name}` : `Service type ${id} — not found in Planning Center`;
  }

  const id = String(profile.folder_id);
  const match = folders.find((f) => String(f.id) === id);
  return match ? `Folder: ${folderPath(match, folders)}` : `Folder ${id} — not found in Planning Center`;
}

/**
 * "Weekend / Youth" for a nested folder.
 *
 * ⚠️ Two folders can share a name in different places, and a picker showing
 * both as "Youth" is a coin toss. Guards against a cycle in the data for the
 * same reason the server-side walk does.
 */
export function folderPath(folder, folders = []) {
  const names = [];
  const seen = new Set();
  let current = folder;
  while (current && !seen.has(String(current.id))) {
    seen.add(String(current.id));
    names.unshift(current.name || String(current.id));
    const parentId = current.parent_id;
    current = parentId ? folders.find((f) => String(f.id) === String(parentId)) : null;
  }
  return names.join(' / ');
}

/** True when a binding points at something Planning Center no longer has. */
export function bindingIsDangling(profile, { serviceTypes = [], folders = [] } = {}) {
  const kind = bindingKind(profile);
  if (kind === 'service_type') {
    return !serviceTypes.some((s) => String(s.id) === String(profile.service_type_id));
  }
  if (kind === 'folder') {
    return !folders.some((f) => String(f.id) === String(profile.folder_id));
  }
  return false;
}

/**
 * What is wrong with a profile, or null.
 *
 * Returns the single most important problem rather than a list: a form that
 * reports four things at once teaches people to skim.
 */
export function validateProfile(profile, others = []) {
  const name = String((profile && profile.name) || '').trim();
  if (!name) {
    return 'Give the rule set a name.';
  }

  const id = String((profile && profile.id) || '').trim();
  if (others.some((p) => p && String(p.id) === id && p !== profile)) {
    return 'Another rule set already has that id.';
  }
  if (others.some((p) => p && p !== profile && String(p.name || '').trim().toLowerCase() === name.toLowerCase())) {
    return 'Another rule set is already called that.';
  }

  if (String((profile && profile.service_type_id) || '').trim()
      && String((profile && profile.folder_id) || '').trim()) {
    // Both would never be ambiguous in practice -- service type wins -- but a
    // form that lets you set two bindings and silently honours one is a form
    // that will be misread.
    return 'Bind to a service type or a folder, not both.';
  }

  const clash = others.find((p) => {
    if (!p || p === profile) return false;
    const kind = bindingKind(profile);
    if (kind === 'manual') return false;
    return bindingKind(p) === kind
      && String(p[`${kind}_id`] || '') === String(profile[`${kind}_id`] || '');
  });
  if (clash) {
    // ⛔ The quiet one. Two profiles on one binding is not an error at sync
    // time -- the first wins -- so without saying so here an operator can
    // believe "Youth" is in force while "Sunday AM" actually is.
    return `"${clash.name || clash.id}" is already bound to that; the first one would win.`;
  }

  if (!overriddenKeys(profile).length) {
    return 'This rule set changes nothing yet — it would behave exactly like the board settings.';
  }

  return null;
}

/** Strip a profile down to what should be stored. */
export function cleanProfile(profile) {
  const out = {
    id: String((profile && profile.id) || '').trim(),
    name: String((profile && profile.name) || '').trim(),
  };
  const kind = bindingKind(profile);
  if (kind === 'service_type') {
    out.service_type_id = String(profile.service_type_id).trim();
  } else if (kind === 'folder') {
    out.folder_id = String(profile.folder_id).trim();
  }

  // ⚠️ Only keys actually overridden are stored. Writing every key with the
  // board's current value would freeze this profile against a later change to
  // the board settings, which is the opposite of how inheritance should work.
  const mapping = {};
  overriddenKeys(profile).forEach((key) => { mapping[key] = profile.mapping[key]; });
  out.mapping = mapping;
  return out;
}

/** The profiles list ready for `api/pco/config`, dropping unusable entries. */
export function toPayload(profiles) {
  if (!Array.isArray(profiles)) {
    return [];
  }
  return profiles
    .filter((p) => p && String(p.id || '').trim() && String(p.name || '').trim())
    .map(cleanProfile);
}
