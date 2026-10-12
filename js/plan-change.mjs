/**
 * Telling the operator the plan on the board has changed (#140).
 *
 * ⛔ The default answer to "what should happen when the active plan changes".
 * Re-syncing by itself is opt-in, because a sync writes `config.json` and,
 * with `clear_unmatched` on, takes people off the board — doing that
 * mid-service unwatched is a bigger surprise than a line saying it could be
 * done.
 *
 * ⭐ When it *is* on, this bar still has a job: saying what the board did to
 * itself. An automatic sync that leaves no trace is the same board quietly
 * showing different names, which is exactly the thing the watcher exists to
 * stop happening silently.
 *
 * ⚠️ What this says has to survive being read at a glance by somebody holding
 * a microphone. It is one sentence and one action.
 */

/** What an automatic sync last did, or null. */
export function autoSync(planChange) {
  const entry = planChange && typeof planChange === 'object' ? planChange.auto_sync : null;
  return entry && typeof entry === 'object' ? entry : null;
}

/**
 * ⭐ How long an automatic sync's report stays up.
 *
 * Long enough that somebody walking back to the desk sees it, short enough
 * that it is gone by the next service. A failure, or a contested slot, has no
 * expiry at all — those need a person, and a notice that times out is a notice
 * that did not reach them.
 */
export const AUTO_SYNC_NOTICE_SECONDS = 30 * 60;

export function autoSyncStillWorthSaying(planChange, now = Date.now()) {
  const entry = autoSync(planChange);
  if (!entry) {
    return false;
  }
  if (!entry.ok || entry.needs_attention) {
    return true;
  }
  const at = Number(entry.at);
  if (!Number.isFinite(at) || at <= 0) {
    return false;
  }
  return (now / 1000 - at) < AUTO_SYNC_NOTICE_SECONDS;
}

/**
 * Whether the board should be showing a change notice.
 *
 * ⚠️ Takes the clock, because one of the two reasons to show it expires. A
 * function that reads `Date.now()` itself cannot be tested about the moment
 * that matters.
 */
export function shouldNotify(planChange, now = Date.now()) {
  if (!planChange || typeof planChange !== 'object') {
    return false;
  }
  return planChange.changed === true || autoSyncStillWorthSaying(planChange, now);
}

/**
 * How serious the bar is.
 *
 * ⚠️ Three states, not two. A board that synced itself cleanly is *reassuring*
 * and must not wear the same amber as one showing stale names, or the colour
 * stops meaning anything.
 */
export function noticeTone(planChange) {
  const entry = autoSync(planChange);
  if (entry && (!entry.ok || entry.needs_attention)) {
    return 'problem';
  }
  if (planChange && planChange.changed === true) {
    return 'stale';
  }
  return entry ? 'done' : 'stale';
}

/**
 * The notice text, or null when there is nothing to say.
 *
 * ⚠️ Says what it means for the board, not what happened in Planning Center.
 * "Plan 77 updated_at changed" is true and useless; what the operator needs to
 * know is that the names on screen may now be wrong.
 */
export function noticeText(planChange, now = Date.now()) {
  if (!shouldNotify(planChange, now)) {
    return null;
  }
  // ⛔ What the board did to itself comes first. An operator who was not here
  // needs to know the names changed under them before anything else.
  const entry = autoSync(planChange);
  if (entry && entry.summary && !(planChange.changed === true && entry.ok)) {
    return entry.summary;
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
export function noticeKey(planChange, now = Date.now()) {
  if (!shouldNotify(planChange, now)) {
    return '';
  }
  const entry = autoSync(planChange);
  return [
    planChange.plan_id || '',
    planChange.changed ? 1 : 0,
    entry ? entry.at : '',
    noticeTone(planChange),
  ].join(':');
}
