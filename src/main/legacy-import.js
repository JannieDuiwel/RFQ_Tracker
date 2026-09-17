'use strict';
/**
 * Reads the tkinter app's rfq_tracker.db and hands its contents to db.js.
 *
 * This runs once, on the first launch after upgrading, and then never again -
 * so it is allowed to be slow, and it is not allowed to be clever. It reads,
 * it converts, it reports what it found. It never writes to the old file, so
 * the previous version keeps working if this one turns out to be a mistake.
 *
 * node:sqlite is built into the Node that Electron ships (24.x in Electron 44),
 * which is why the app still has zero dependencies. It is marked experimental
 * upstream, so every use of it is inside a try/catch that degrades to "tell the
 * user it could not be read" rather than taking the app down with it.
 */

const fs = require('fs');
const path = require('path');

/** Old column name (what the tkinter settings file stored) to new sort field. */
const SORT_COLUMNS = {
  status: 'status',
  desc: 'description',
  name: 'name',
  company: 'company',
  phone: 'phone',
  email: 'email',
  date: 'dateCreated',
  due: 'dueDate',
};

/**
 * Places a user is likely to have left the old app, checked in order. The
 * tkinter build kept its database beside the .exe, so this is really a list of
 * the folders people unzip things into.
 *
 * Exact paths only, no directory walking: a recursive scan of a home folder to
 * save one file-picker click is not a trade worth making.
 */
function candidatePaths(dirs) {
  const names = ['rfq_tracker.db'];
  const out = [];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of names) {
      out.push(path.join(dir, name));
      // The build script produced dist\RFQ Tracker.exe next to dist\<db>.
      out.push(path.join(dir, 'RFQ_Tracker', 'dist', name));
      out.push(path.join(dir, 'dist', name));
    }
  }
  return out;
}

/** First candidate that exists, or ''. */
function findLegacyDb(dirs) {
  for (const p of candidatePaths(dirs)) {
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch { /* not there, try the next */ }
  }
  return '';
}

/**
 * Converts the three old tables into the nested record shape db.js stores.
 *
 * Exported separately from the file reading so it can be tested on plain
 * objects, with no database involved.
 */
function toRecords({ rfqs = [], activity = [], reminders = [] }) {
  const byRfq = new Map();
  for (const row of rfqs) {
    byRfq.set(row.id, {
      id: row.id,
      description: row.description || '',
      name: row.name || '',
      company: row.company || '',
      phone: row.phone || '',
      email: row.email || '',
      status: row.status || 'Pending',
      dateCreated: row.date_created || '',
      createdAt: row.created_at || '',
      // The old schema allowed NULL here; the new one uses '' for "no due date"
      // so every consumer can treat it as a string.
      dueDate: row.due_date || '',
      activity: [],
      reminders: [],
    });
  }

  for (const row of activity) {
    const rfq = byRfq.get(row.rfq_id);
    if (rfq) rfq.activity.push({ ts: row.ts || '', entry: row.entry || '' });
  }
  for (const row of reminders) {
    const rfq = byRfq.get(row.rfq_id);
    if (rfq) {
      rfq.reminders.push({
        id: row.id,
        remindAt: row.remind_at || '',
        notified: Boolean(row.notified),
      });
    }
  }

  for (const rfq of byRfq.values()) {
    rfq.activity.sort((a, b) => a.ts.localeCompare(b.ts));
    rfq.reminders.sort((a, b) => a.remindAt.localeCompare(b.remindAt));
  }

  // Oldest first, so the imported RFQs get ids in the order they were created
  // and the list's natural "newest first" order still means something.
  return [...byRfq.values()].sort((a, b) => a.id - b.id);
}

/** The old settings.json, translated. Returns a patch, not a whole settings object. */
function toSettings(old) {
  if (!old || typeof old !== 'object') return {};
  const patch = {};
  if (typeof old.start_with_windows === 'boolean') patch.startWithWindows = old.start_with_windows;
  if (typeof old.minimize_to_tray === 'boolean') patch.minimizeToTray = old.minimize_to_tray;
  if (typeof old.close_to_tray === 'boolean') patch.closeToTray = old.close_to_tray;
  if (typeof old.dark_mode === 'boolean') patch.theme = old.dark_mode ? 'dark' : 'light';
  if (SORT_COLUMNS[old.sort_column]) patch.sortColumn = SORT_COLUMNS[old.sort_column];
  if (typeof old.sort_reverse === 'boolean') patch.sortReverse = old.sort_reverse;
  return patch;
}

/** Reads the settings.json the tkinter app kept beside its database. */
function readLegacySettings(dbPath) {
  try {
    const file = path.join(path.dirname(dbPath), 'settings.json');
    return toSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    // No settings file is perfectly normal; the RFQs are what matter.
    return {};
  }
}

/**
 * Reads the three tables out of a legacy database file.
 * Returns { ok, records, settings } or { ok: false, error }.
 */
function readLegacyDb(dbPath) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch (e) {
    return {
      ok: false,
      error: 'This build of Electron has no SQLite support, so the old database '
        + 'cannot be read. Export a CSV from the old app instead.',
    };
  }

  let db = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = (sql) => db.prepare(sql).all();

    const records = toRecords({
      rfqs: rows('SELECT * FROM rfqs'),
      activity: rows('SELECT * FROM activity'),
      reminders: rows('SELECT * FROM reminders'),
    });

    return { ok: true, records, settings: readLegacySettings(dbPath) };
  } catch (e) {
    return { ok: false, error: `Could not read ${path.basename(dbPath)}: ${e.message}` };
  } finally {
    try {
      if (db) db.close();
    } catch { /* already gone */ }
  }
}

/**
 * The whole job: read the file, append what it holds, apply its preferences.
 * `store` is optional - pass it to carry the old settings over too.
 */
function importLegacy(dbPath, db, store) {
  const read = readLegacyDb(dbPath);
  if (!read.ok) return read;

  const counts = db.importRecords(read.records);
  if (store) store.update({ ...read.settings, legacyImported: true });

  return { ok: true, ...counts, source: dbPath };
}

module.exports = {
  findLegacyDb,
  candidatePaths,
  toRecords,
  toSettings,
  readLegacyDb,
  importLegacy,
  SORT_COLUMNS,
};
