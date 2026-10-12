/**
 * Paging the wall through its groups, when not everything fits (#113).
 *
 * ⛔ **Not a screensaver and not an attract loop.** If every channel fits, the
 * board does not page at all — the timer exists only because the density
 * control (#112) can make the wall smaller than the show. The trigger is the
 * layout's own `scrolls`, so "doesn't fit" means the same thing here as it does
 * to the thing doing the laying out.
 *
 * ⭐ Pages are **groups**, not slices of six. Cutting the channel list into
 * chunks would work and would mean nothing; a page called *Worship* is a thing
 * someone can name, and the order is worth configuring rather than being an
 * accident of slot numbering.
 */

/** How long a page holds, when the group does not say. */
export const DEFAULT_DWELL_SECONDS = 20;

/** Bounds on dwell. A page nobody can read is worse than no rotation. */
const MIN_DWELL = 5;
const MAX_DWELL = 600;

/**
 * Whether this board should be paging at all.
 *
 * ⛔ Three things have to be true, and the overflow is the one that stops this
 * being a screensaver: a board where everything fits never pages, however it is
 * configured.
 */
export function shouldPage({ enabled, overflows, pageCount } = {}) {
  return enabled === true && overflows === true && Number(pageCount) > 1;
}

/** Whether a group takes part in the rotation. */
export function rotates(group) {
  // ⚠️ Absent means yes. A board that turned rotation on and saw nothing
  // because no group had opted in would look broken, and the per-group switch
  // is for taking a group *out*.
  return !group || group.rotate !== false;
}

/** How long one of a group's pages holds, in seconds. */
export function dwellFor(group, fallback = DEFAULT_DWELL_SECONDS) {
  const raw = Number(group && group.dwell);
  const base = Number.isFinite(raw) && raw > 0 ? raw : Number(fallback);
  if (!Number.isFinite(base) || base <= 0) {
    return DEFAULT_DWELL_SECONDS;
  }
  return Math.max(MIN_DWELL, Math.min(base, MAX_DWELL));
}

/**
 * The pages to rotate through.
 *
 * ⚠️ A group with more channels than fit becomes several pages, and **each one
 * holds for the group's full dwell** rather than sharing it. Dividing it makes
 * the biggest groups — the ones with the most to read — flash past fastest,
 * which is backwards.
 */
export function buildPages(groups, { perPage } = {}) {
  if (!Array.isArray(groups)) {
    return [];
  }
  const capacity = Number(perPage);
  const size = Number.isFinite(capacity) && capacity >= 1 ? Math.floor(capacity) : Infinity;

  const pages = [];
  groups.forEach((group) => {
    if (!rotates(group)) {
      return;
    }
    const slots = Array.isArray(group && group.slots)
      ? group.slots.filter((n) => Number.isFinite(Number(n)))
      : [];
    if (!slots.length) {
      // A group with no channels is not a page. An empty wall for twenty
      // seconds reads as a fault.
      return;
    }

    const chunks = [];
    for (let i = 0; i < slots.length; i += size) {
      chunks.push(slots.slice(i, i + size));
    }
    chunks.forEach((chunk, index) => {
      pages.push({
        group: group.group,
        title: String((group && group.title) || '').trim(),
        slots: chunk,
        dwell: dwellFor(group),
        part: index + 1,
        parts: chunks.length,
      });
    });
  });
  return pages;
}

/**
 * The page a channel in trouble is on, or null.
 *
 * ⛔ The failure this whole feature could cause is a channel going critical on
 * a page nobody is looking at. So an alert outranks the timer: the rotation
 * stops at trouble and stays there until it clears.
 *
 * ⚠️ The *first* such page wins and keeps winning while it alerts, so two
 * failing channels on different pages cannot make the board flap between them.
 */
export function alertPageIndex(pages, criticalSlots) {
  if (!Array.isArray(pages) || !Array.isArray(criticalSlots) || !criticalSlots.length) {
    return null;
  }
  const critical = new Set(criticalSlots.map((n) => Number(n)));
  for (let i = 0; i < pages.length; i += 1) {
    if ((pages[i].slots || []).some((slot) => critical.has(Number(slot)))) {
      return i;
    }
  }
  return null;
}

/**
 * Where the rotation should be now.
 *
 * Returns `{ index, held, reason }`. `held` means the timer is being ignored,
 * and `reason` says why so the board can show it rather than looking stuck.
 */
export function nextPage({
  pages, current = 0, criticalSlots = [], interacting = false,
} = {}) {
  const list = Array.isArray(pages) ? pages : [];
  if (!list.length) {
    return { index: 0, held: true, reason: 'nothing to show' };
  }

  const alert = alertPageIndex(list, criticalSlots);
  if (alert !== null) {
    return { index: alert, held: true, reason: 'a channel needs attention' };
  }

  if (interacting) {
    // ⚠️ Somebody is using the board. Moving the page under their hand is the
    // same discourtesy as a dialog stealing focus.
    return { index: clampIndex(current, list.length), held: true, reason: 'in use' };
  }

  return { index: (clampIndex(current, list.length) + 1) % list.length, held: false, reason: '' };
}

function clampIndex(index, length) {
  const n = Number(index);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.floor(n) % length;
}

/** What the board says about where it is in the rotation. */
export function rotationLabel(pages, index) {
  const list = Array.isArray(pages) ? pages : [];
  const page = list[clampIndex(index, Math.max(1, list.length))];
  if (!page) {
    return '';
  }
  const name = page.title || `Group ${page.group}`;
  return page.parts > 1 ? `${name} (${page.part}/${page.parts})` : name;
}
