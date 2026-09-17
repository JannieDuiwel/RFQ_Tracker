'use strict';
/**
 * Checks GitHub Releases for a newer build.
 *
 * This is the only thing in the app that touches the network, and it is off
 * when `checkForUpdates` is false. It never downloads or installs anything: it
 * returns a version and a URL, the status bar says so, and clicking hands the
 * link to the browser. An app that quietly replaces itself is a bigger promise
 * than this one needs to make.
 *
 * The comparison is the part worth testing, so it is a plain function; the
 * fetch is a thin wrapper around https.get with a short timeout.
 */

const https = require('https');

const REPO = 'JannieDuiwel/RFQ_Tracker';
const TIMEOUT_MS = 8000;

/**
 * Compares two dotted versions, ignoring a leading 'v' and any pre-release
 * suffix. Returns 1 if a is newer, -1 if b is, 0 if they match.
 *
 * Numeric part by part rather than a string compare, because '1.10.0' is newer
 * than '1.9.0' and text ordering says the opposite.
 */
function compareVersions(a, b) {
  const parts = (v) => String(v || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[-+]/)[0]
    .split('.')
    .map((n) => parseInt(n, 10) || 0);

  const pa = parts(a);
  const pb = parts(b);

  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** Pulls the fields we care about out of a GitHub release payload. */
function parseRelease(json, currentVersion) {
  const latest = String(json?.tag_name || '').replace(/^v/i, '');
  if (!latest) return { ok: true, available: false };
  if (compareVersions(latest, currentVersion) <= 0) return { ok: true, available: false };
  return {
    ok: true,
    available: true,
    version: latest,
    url: json.html_url || `https://github.com/${REPO}/releases`,
  };
}

function fetchJson(url) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        // GitHub rejects requests without one, with a 403 that looks like a
        // rate limit and is not.
        'User-Agent': 'RFQ-Tracker',
        Accept: 'application/vnd.github+json',
      },
      timeout: TIMEOUT_MS,
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve({ ok: false, error: `GitHub returned ${res.statusCode}` });
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          resolve({ ok: true, json: JSON.parse(body) });
        } catch {
          resolve({ ok: false, error: 'Unreadable response from GitHub' });
        }
      });
    });

    req.on('timeout', () => req.destroy(new Error('timed out')));
    // Offline is the common case here, and it is not worth a word to the user.
    req.on('error', (e) => resolve({ ok: false, error: String(e.message || e) }));
  });
}

/** Resolves to { available, version, url } - never rejects. */
async function checkForUpdate(currentVersion) {
  const res = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`);
  if (!res.ok) return { ok: false, available: false, error: res.error };
  return parseRelease(res.json, currentVersion);
}

module.exports = { checkForUpdate, compareVersions, parseRelease, REPO };
