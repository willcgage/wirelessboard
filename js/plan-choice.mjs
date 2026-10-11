/**
 * Choosing which plan the board reads (#120).
 *
 * ⛔ The weekly job was the one thing nobody could skip: every week an operator
 * opened the panel and picked this Sunday's plan out of a list, even though
 * `py/pco.py` has had `_get_next_plan_id` and `_get_next_plan_global` all
 * along. Nothing in the interface offered "the next one".
 *
 * ⚠️ The blank option already meant "let the server choose" for Sync and
 * Preview — and "refuse" for Load People, Load Teams and the note preview.
 * One value, two meanings, neither of them written down anywhere. `NEXT_PLAN`
 * replaces the useful half with something named, and blank goes back to
 * meaning "nothing chosen" everywhere.
 */

/** The select value meaning "whatever plan is next, resolved when it matters". */
export const NEXT_PLAN = '__next__';

/** One line naming a plan, from whichever fields Planning Center filled in. */
export function planLabel(plan) {
  if (!plan || typeof plan !== 'object') {
    return '';
  }
  // Scoped to one service type the API omits its name, and most plans carry no
  // title, so joining only the parts present avoids labels like "Aug 2 — ".
  return [plan.service_type_name, plan.short_dates || plan.dates, plan.title]
    .map((part) => (part || '').trim())
    .filter((part) => part)
    .join(' — ');
}

/**
 * What the "next upcoming" option should read.
 *
 * ⭐ Names the plan once it is known. "Next upcoming" alone asks the operator
 * to trust the board about the one fact they came to check; "Next upcoming —
 * Sun, Oct 12" lets them confirm it at a glance and is the whole reason the
 * server resolves it rather than the list being reordered client-side.
 */
export function nextPlanOptionLabel(next) {
  if (!next || next.ok !== true) {
    return 'Next upcoming';
  }
  const label = (next.label || planLabel(next) || '').trim();
  return label ? `Next upcoming — ${label}` : 'Next upcoming';
}

/**
 * The concrete plan id a lookup should use, or '' when nothing is chosen.
 *
 * Load People, Load Teams and the note preview all need a real id, so "next"
 * has to be resolved before they can run.
 */
export function resolvePlanId(selectValue, next) {
  if (selectValue !== NEXT_PLAN) {
    return selectValue || '';
  }
  return (next && next.ok === true && next.plan_id) ? String(next.plan_id) : '';
}

/**
 * The `plan` query param for a sync or preview — null meaning "send none".
 *
 * ⛔ "Next" deliberately sends nothing rather than the id resolved when the
 * panel was opened. A board left up overnight, or over a week, would otherwise
 * sync the plan that was next when somebody last looked. Letting the server
 * resolve it at sync time is the difference between "next upcoming" and "the
 * plan that was next upcoming at some point in the past".
 */
export function syncPlanParam(selectValue) {
  if (!selectValue || selectValue === NEXT_PLAN) {
    return null;
  }
  return selectValue;
}

/** What to say in the log about which plan is being used. */
export function planDescription(selectValue, next) {
  if (selectValue === NEXT_PLAN) {
    const resolved = resolvePlanId(selectValue, next);
    return resolved ? `next upcoming, plan ${resolved}` : 'next upcoming';
  }
  return selectValue ? `plan ${selectValue}` : 'no plan chosen';
}

/**
 * Whether an action needing a concrete plan can run, and what to say if not.
 *
 * ⚠️ "Next upcoming" that has not resolved is a different failure from "you
 * have not chosen a plan", and telling an operator to choose a plan when they
 * already chose one is how a board teaches people to ignore it.
 */
export function planBlocker(selectValue, next) {
  if (resolvePlanId(selectValue, next)) {
    return null;
  }
  if (selectValue === NEXT_PLAN) {
    const why = next && next.error ? ` (${next.error})` : '';
    return `Could not work out which plan is next${why}. Pick one from the list.`;
  }
  return 'Select a plan first.';
}
