/**
 * What automation will do without anybody pressing anything (#188 follow-up).
 *
 * ⭐⭐ The question the Calendar & automation section has to answer is *"what
 * happens if I walk away"*, and nothing on screen answered it. The settings
 * said the board watches every 120 seconds; they did not say the watcher was
 * **not armed** — which it is not until a sync has run in this process. A board
 * configured to watch was quietly doing nothing and looked identical to one
 * that was working.
 *
 * ⛔ Lines, not a verdict. The operator is deciding whether to rely on this
 * before a service, and "automation is off" would hide which of four separate
 * things is off. Each line names one fact and says what follows from it.
 *
 * ⚠️ No DOM and no fetch, so the wording is testable on its own — the same
 * split `pco-example.mjs` uses.
 */

/** A line the panel shows: `level` is 'ok' | 'warn' | 'off'. */
const line = (level, text) => ({ level, text });

/** How long ago, in words an operator reads rather than a timestamp. */
export function sinceWords(checkedAt, now = Date.now() / 1000) {
  if (!checkedAt || !Number.isFinite(Number(checkedAt))) return '';
  const seconds = Math.max(0, Math.round(now - Number(checkedAt)));
  if (seconds < 90) return `${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minutes ago`;
  return `${Math.round(minutes / 60)} hours ago`;
}

/**
 * The status lines for a watch report.
 *
 * ⛔ The armed line comes first and is the one that decides whether the rest
 * matters. Everything below it describes a machine that may not be running.
 */
export function watchLines(report, now = Date.now() / 1000) {
  if (!report || report.ok === false) {
    return [line('warn', report?.error || 'Planning Center is not configured.')];
  }

  const out = [];

  if (!report.watching) {
    out.push(line('off', 'This board does not watch the plan. Nothing syncs on its own.'));
    return out;
  }

  if (!report.armed) {
    // ⛔⛔ The fact that was invisible. `_LAST_SYNC` is in memory, so a restart
    // disarms the watcher while every setting still reads "on".
    out.push(line(
      'warn',
      'Watching is on, but nothing is being watched yet — the board has not synced '
      + 'since it started. The first sync is what starts it.',
    ));
    return out;
  }

  const plan = report.plan_id ? `plan ${report.plan_id}` : 'the plan it last synced';
  const rules = report.profile ? ` using the “${report.profile}” rules` : '';
  out.push(line('ok', `Watching ${plan}${rules}.`));

  if (report.interval_seconds) {
    out.push(line('ok', `It looks every ${report.interval_seconds} seconds.`));
  }

  if (report.auto_sync === false) {
    // Watching and reporting, but it will not act.
    out.push(line(
      'warn',
      'Automatic sync is off for these rules, so a change is reported and not applied.',
    ));
  } else if (report.auto_sync) {
    out.push(line(
      report.clear_unmatched ? 'warn' : 'ok',
      report.clear_unmatched
        ? 'A change applies itself, and people the plan no longer names are taken off the board.'
        : 'A change applies itself. Nobody is taken off the board.',
    ));
  }

  if (report.finished) {
    const grace = report.grace_minutes ? ` It stops ${report.grace_minutes} minutes after the service.` : '';
    out.push(line('off', `This service is over, so the board has stopped watching.${grace}`));
  } else if (report.changed) {
    out.push(line('warn', 'The plan has changed since the last sync.'));
  }

  if (report.error) {
    out.push(line('warn', `Last check failed: ${report.error}`));
  }

  const since = sinceWords(report.checked_at, now);
  if (since) out.push(line('ok', `Last looked ${since}.`));

  return out;
}
