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
 * Why this board is paging, or `null` if it is not.
 *
 * ⛔ **One decider, and it answers *why* rather than *whether*** (#202).
 *
 * The maintainer's call was that auto-paging is "a little bit of both"
 * technically -- a state the board enters *and* a setting the operator holds --
 * with the warning that the code must not end up confused about which. It would
 * have: if `micboard.rotation === 'on'` meant "the board is paging" *and* the
 * board could also page while that reads `'off'`, every call site asking the
 * question gets an ambiguous answer and two of them eventually disagree.
 *
 * So the preference is an input to this function and nothing else in the
 * project asks it directly. The two inputs can never contend, because they are
 * resolved in a fixed order:
 *
 *   1. the layout cannot show every channel -> `'required'`. Not the operator's
 *      to switch off: the only alternative is hiding one, and that is the single
 *      failure this display cannot afford.
 *   2. otherwise the stored preference -> `'requested'`. Everything would fit;
 *      the operator asked to cycle the groups anyway.
 *   3. otherwise `null`.
 *
 * ⭐ The return reads correctly as a condition, so a caller that only wants
 * yes-or-no gets the right answer without a second helper existing to drift
 * from this one. That is why `shouldPage` was replaced rather than kept beside
 * it -- two functions answering nearly the same question was the shape of the
 * problem, not the fix.
 *
 * ⚠️ `pageCount > 1` still gates both: a single page is not a rotation, and a
 * board that "pages" through one page would just be a board.
 */
export function pagingReason({ rotationPref, overflows, pageCount } = {}) {
  if (Number(pageCount) <= 1) {
    return null;
  }
  if (overflows === true) {
    return 'required';
  }
  if (rotationPref === 'on') {
    return 'requested';
  }
  return null;
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
 * What a board showing *All channels* calls its own rotation.
 *
 * ⚠️ `rotationLabel` falls back to `Group ${page.group}`, so an implicit page
 * built for the whole board used to read **"Group 0"** -- a group that does not
 * exist, named after an internal sentinel.
 */
export const ALL_CHANNELS_TITLE = 'All channels';

/** The heading for the thing the board is showing. */
function shownTitle(group, groups) {
  const selected = Number(group);
  if (!Number.isFinite(selected) || selected <= 0) {
    return ALL_CHANNELS_TITLE;
  }
  const match = (Array.isArray(groups) ? groups : [])
    .find((g) => Number(g && g.group) === selected);
  return String((match && match.title) || '').trim() || `Group ${selected}`;
}

/**
 * The pages this board should be showing, and why (#215).
 *
 * ⛔⛔ **The two reasons page through different things, and that is the whole
 * point.** The fault this replaces built every page from `config.groups`
 * whatever the board was showing, so a wall set to *All channels* that ran out
 * of room was handed Group 1's slots in Group 1's order -- the operator asked
 * for everything and got somebody else's subset, renamed.
 *
 * The maintainer's rule, 2026-10-14:
 *
 *   "all channels in slot order unless the group has been specified"
 *
 *   required   channels would be lost, so page through **what is on display**:
 *              `shown` in its own order, which `renderGroup` has already made
 *              slot order for *All channels* and the group's order for a group.
 *
 *   requested  everything fits and the operator turned the switch on, so cycle
 *              **the configured groups** -- which is what *Page through groups*
 *              says on the tin, and what per-group `rotate` and `dwell` are for.
 *
 * ⭐ Pure, and it returns both answers together. Deriving `why` and the pages
 * separately is how they came to disagree: `pagingReason` needs a page count,
 * and the page count now depends on the reason, so one function settles both or
 * the circularity gets resolved differently in two places.
 *
 * ⚠️ A selected group's own `dwell` still applies on the forced path -- the
 * operator chose how long that group holds -- but its `rotate` flag does not.
 * `rotate: false` takes a group out of the group cycle; it may never cost the
 * board a channel it is being asked to show.
 */
export function pagesForBoard({
  capacity, shown = [], group = 0, groups = [], rotationPref,
} = {}) {
  const slots = (Array.isArray(shown) ? shown : [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);

  const asked = Number(capacity);
  const size = Number.isFinite(asked) && asked >= 1 ? Math.floor(asked) : Infinity;
  const overflows = slots.length > size;

  const list = Array.isArray(groups) ? groups : [];
  const selected = Number(group) > 0 ? Number(group) : 0;
  const match = list.find((g) => Number(g && g.group) === selected);

  // ⛔ No `rotate` key on the descriptor, deliberately. `rotates()` reads
  // absent as yes, which is the behaviour this path needs: a board that must
  // page has no alternative that keeps every channel visible.
  const forced = overflows
    ? buildPages([{
      group: selected,
      title: shownTitle(selected, list),
      slots,
      dwell: match && match.dwell,
    }], { perPage: size })
    : [];

  const requested = buildPages(list, { perPage: size });

  const why = pagingReason({
    rotationPref,
    overflows,
    pageCount: overflows ? forced.length : requested.length,
  });

  if (!why) {
    return { pages: [], why: null };
  }
  return { pages: why === 'required' ? forced : requested, why };
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
