/**
 * Connecting to Planning Center as its own action (#120).
 *
 * ⛔ Connecting used to be a side effect of saving the whole form, and the
 * credentials were only ever exercised later — so first-time setup was save →
 * fetch → discover the token was wrong → save again, and a bad token sat in the
 * keyring looking like a good one. Connect checks first and stores second.
 *
 * ⚠️ What "connected" means here is narrower than "authenticated": a Personal
 * Access Token can be perfectly valid and still have no access to Services. The
 * server verifies by listing a service type, so these strings talk about what
 * the board can actually read, not about who you are.
 */

/** Why Connect cannot run yet, or null when it can. */
export function connectBlocker(token, secret) {
  const t = (token || '').trim();
  const s = (secret || '').trim();
  if (!t && !s) {
    return 'Enter the Personal Access Token and its secret, then press Connect.';
  }
  if (!t) {
    return 'Enter the Personal Access Token.';
  }
  if (!s) {
    return 'Enter the Personal Access Secret.';
  }
  return null;
}

/**
 * What to show beside the Connect button once the server has answered.
 *
 * Levels map to the panel's existing status classes, so a warning reads as a
 * warning rather than as a success with small print.
 */
export function connectSummary(resp, { enabled = true } = {}) {
  if (!resp || typeof resp !== 'object') {
    return { level: 'error', text: 'No answer from the board.' };
  }
  if (resp.ok !== true) {
    return { level: 'error', text: resp.error || 'Could not connect to Planning Center.' };
  }
  if (resp.warning) {
    // Authenticated, authorised, and nothing to read. Said plainly, because
    // every later step comes back empty and otherwise looks like a bug.
    return { level: 'warn', text: resp.warning };
  }

  // ⚠️ The name is a courtesy and is often absent: the People API is a
  // different product from Services, and a Services-only token is refused by
  // it. "Connected." on its own is the honest answer in that case, not a
  // degraded one.
  const who = (resp.who || '').trim();
  const connected = who ? `Connected as ${who}.` : 'Connected.';

  // ⛔ Says what is left rather than doing it. Enable PCO is the admin's
  // switch, and connecting is not consent to flip it -- a board may be
  // deliberately out of service. Pointing at the next step keeps that honest
  // without leaving anyone guessing why nothing loads.
  if (!enabled) {
    return { level: 'warn', text: `${connected} Tick Enable PCO and save to start using it.` };
  }
  return { level: 'ok', text: connected };
}

/**
 * Whether the rest of the panel should be usable.
 *
 * ⚠️ Stored credentials count, not just a connection made in this session —
 * reopening the panel must not look like a board that has never been set up.
 */
export function isConnected({ hasStoredCredentials, lastConnect } = {}) {
  if (lastConnect && lastConnect.ok === true) {
    return true;
  }
  return !!hasStoredCredentials;
}

/** The line describing the stored credentials when the panel opens. */
export function storedCredentialsNote(hasStoredCredentials) {
  if (hasStoredCredentials) {
    return 'Credentials are stored on this computer. Enter a new token and secret to replace them.';
  }
  return 'Not connected yet.';
}
