/**
 * Telling the operator the plan on the board has changed (#140).
 *
 * ⛔ The default, and for now the only, answer to "what should happen when the
 * active plan changes". Re-syncing by itself is opt-in and is a separate
 * decision: a sync writes `config.json` and, with `clear_unmatched` on, takes
 * people off the board — doing that mid-service with nobody watching is a
 * bigger surprise than a line saying it could be done.
 *
 * ⚠️ What this says has to survive being read at a glance by somebody holding
 * a microphone. It is one sentence and one action.
 */

/** Whether the board should be showing a change notice. */
export function shouldNotify(planChange) {
  if (!planChange || typeof planChange !== 'object') {
    return false;
  }
  return planChange.changed === true;
}

/**
 * The notice text, or null when there is nothing to say.
 *
 * ⚠️ Says what it means for the board, not what happened in Planning Center.
 * "Plan 77 updated_at changed" is true and useless; what the operator needs to
 * know is that the names on screen may now be wrong.
 */
export function noticeText(planChange) {
  if (!shouldNotify(planChange)) {
    return null;
  }
  return 'This plan has changed in Planning Center. The names on the board may be out of date.';
}

/**
 * A short note about the watcher itself, or null.
 *
 * ⭐ A failed check is shown *alongside* a standing warning rather than
 * replacing it. A warning that comes and goes with the network is one people
 * stop believing.
 */
export function watchProblem(planChange) {
  if (!planChange || typeof planChange !== 'object' || !planChange.error) {
    return null;
  }
  return `Could not check Planning Center: ${planChange.error}`;
}

/**
 * How long ago the last check was, in words, or null when unknown.
 *
 * ⚠️ Matters because the absence of a warning means "nothing had changed as of
 * the last check", not "nothing has changed". A stale timestamp is the only
 * way to tell those apart.
 */
export function checkedAgo(planChange, now = Date.now()) {
  const at = planChange && Number(planChange.checked_at);
  if (!Number.isFinite(at) || at <= 0) {
    return null;
  }
  const seconds = Math.max(0, Math.round(now / 1000 - at));
  if (seconds < 90) {
    return 'checked just now';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `checked ${minutes} minutes ago`;
  }
  const hours = Math.round(minutes / 60);
  return `checked ${hours} hour${hours === 1 ? '' : 's'} ago`;
}

/**
 * Whether this notice is the same one already on screen.
 *
 * ⛔ A re-render on every payload would retrigger any animation and steal
 * focus from a button somebody is reaching for. The payload arrives several
 * times a second.
 */
export function noticeKey(planChange) {
  if (!shouldNotify(planChange)) {
    return '';
  }
  return `${planChange.plan_id || ''}:${planChange.changed ? 1 : 0}`;
}
