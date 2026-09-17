'use strict';
/**
 * The one-time import from the tkinter app's SQLite database.
 *
 * This code runs once per user and then never again, which is exactly why it
 * needs tests: there is no second chance to notice it dropped the activity log
 * or turned every NULL due date into the string "null".
 *
 * The round-trip case builds a real database in the old schema and reads it
 * back. It skips itself if node:sqlite is missing, so the suite still passes on
 * a runtime without it - the importer degrades the same way.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Db } = require('../src/main/db');
const { Store } = require('../src/main/store');
const {
  toRecords, toSettings, readLegacyDb, importLegacy, candidatePaths, findLegacyDb,
} = require('../src/main/legacy-import');

let passed = 0;
function test(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfq-import-'));
  try {
    fn(dir);
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL  ${name}\n        ${e.message}`);
    process.exitCode = 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function skip(name, why) {
  console.log(`  skip ${name} (${why})`);
}

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch { /* reported per case below */ }

/** The tkinter schema, verbatim, so the fixture cannot drift from the real one. */
const OLD_SCHEMA = `
  CREATE TABLE rfqs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, company TEXT DEFAULT '',
    phone TEXT DEFAULT '', email TEXT DEFAULT '', status TEXT DEFAULT 'Pending',
    date_created TEXT, created_at TEXT, due_date TEXT, description TEXT DEFAULT ''
  );
  CREATE TABLE activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT, rfq_id INTEGER NOT NULL,
    entry TEXT NOT NULL, ts TEXT
  );
  CREATE TABLE reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, rfq_id INTEGER NOT NULL,
    remind_at TEXT NOT NULL, notified INTEGER DEFAULT 0
  );`;

function buildLegacyDb(file) {
  const db = new DatabaseSync(file);
  db.exec(OLD_SCHEMA);
  db.exec(`
    INSERT INTO rfqs (id, name, company, phone, email, status, date_created, created_at, due_date, description)
    VALUES (4, 'Elroy', 'OK Lutzville', '071 808 7787', '', 'Quoted', '2026-03-10', '2026-03-10 14:54:55', NULL, 'Chint coils'),
           (9, 'Herman', 'Minrite', '', 'h@minrite.com', 'Done', '2026-09-11', '2026-09-11 14:18:24', '2026-09-20', 'POMIN26005895');
    INSERT INTO activity (rfq_id, entry, ts) VALUES
      (4, 'Second note', '2026-04-30 12:12:47'),
      (4, 'RFQ created.', '2026-03-10 14:54:55'),
      (9, 'RFQ created.', '2026-09-11 14:18:24');
    INSERT INTO reminders (rfq_id, remind_at, notified) VALUES (4, '2026-03-12 09:00', 1);
  `);
  db.close();
}

console.log('legacy import');

test('the three tables become one nested record per RFQ', () => {
  const records = toRecords({
    rfqs: [{ id: 1, name: 'A', due_date: null }, { id: 2, name: 'B' }],
    activity: [{ rfq_id: 1, entry: 'note', ts: '2026-01-01 09:00' }],
    reminders: [{ id: 7, rfq_id: 2, remind_at: '2026-01-02 09:00', notified: 1 }],
  });
  assert.strictEqual(records.length, 2);
  assert.strictEqual(records[0].activity.length, 1);
  assert.strictEqual(records[1].reminders[0].notified, true);
});

test('a NULL due date becomes an empty string, never the text "null"', () => {
  assert.strictEqual(toRecords({ rfqs: [{ id: 1, name: 'A', due_date: null }] })[0].dueDate, '');
});

test('history belonging to a deleted RFQ is dropped rather than crashing', () => {
  // The old schema had ON DELETE CASCADE, but a database that lost its
  // foreign_keys PRAGMA somewhere could still hold orphans.
  const records = toRecords({
    rfqs: [{ id: 1, name: 'A' }],
    activity: [{ rfq_id: 99, entry: 'orphan', ts: '2026-01-01 09:00' }],
  });
  assert.strictEqual(records[0].activity.length, 0);
});

test('notes come back in the order they were written', () => {
  const records = toRecords({
    rfqs: [{ id: 1, name: 'A' }],
    activity: [
      { rfq_id: 1, entry: 'later', ts: '2026-05-01 09:00' },
      { rfq_id: 1, entry: 'earlier', ts: '2026-01-01 09:00' },
    ],
  });
  assert.deepStrictEqual(records[0].activity.map((a) => a.entry), ['earlier', 'later']);
});

test('records arrive oldest first, so ids are handed out in creation order', () => {
  const records = toRecords({ rfqs: [{ id: 9, name: 'newer' }, { id: 4, name: 'older' }] });
  assert.deepStrictEqual(records.map((r) => r.name), ['older', 'newer']);
});

test('the old settings file translates to the new keys', () => {
  assert.deepStrictEqual(toSettings({
    start_with_windows: true,
    minimize_to_tray: false,
    close_to_tray: true,
    dark_mode: true,
    sort_column: 'date',
    sort_reverse: false,
  }), {
    startWithWindows: true,
    minimizeToTray: false,
    closeToTray: true,
    theme: 'dark',
    sortColumn: 'dateCreated',
    sortReverse: false,
  });
});

test('unknown or missing old settings are left out rather than guessed', () => {
  assert.deepStrictEqual(toSettings({ sort_column: 'colour', whatever: 1 }), {});
  assert.deepStrictEqual(toSettings(null), {});
});

test('the candidate list is exact paths only, never a directory walk', () => {
  const paths = candidatePaths(['C:\\Users\\x\\Desktop']);
  assert.ok(paths.length <= 3);
  assert.ok(paths.every((p) => p.endsWith('rfq_tracker.db')));
});

test('nothing found is an empty string, not a throw', (dir) => {
  assert.strictEqual(findLegacyDb([dir, null, undefined]), '');
});

test('a database found in a candidate folder is reported', (dir) => {
  fs.writeFileSync(path.join(dir, 'rfq_tracker.db'), 'not really a database');
  assert.strictEqual(findLegacyDb([dir]), path.join(dir, 'rfq_tracker.db'));
});

test('a file that is not a database is refused with a message, not an exception', (dir) => {
  const file = path.join(dir, 'rfq_tracker.db');
  fs.writeFileSync(file, 'definitely not sqlite');
  const res = readLegacyDb(file);
  assert.strictEqual(res.ok, false);
  assert.ok(res.error.length > 0);
});

if (!DatabaseSync) {
  skip('a real legacy database imports whole', 'node:sqlite unavailable');
} else {
  test('a real legacy database imports whole', (dir) => {
    const file = path.join(dir, 'rfq_tracker.db');
    buildLegacyDb(file);
    fs.writeFileSync(
      path.join(dir, 'settings.json'),
      JSON.stringify({ dark_mode: true, sort_column: 'due' }),
    );

    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rfq-import-profile-'));
    try {
      const db = new Db(profile);
      const store = new Store(profile);
      const res = importLegacy(file, db, store);

      assert.strictEqual(res.ok, true);
      assert.deepStrictEqual(
        { rfqs: res.rfqs, activity: res.activity, reminders: res.reminders },
        { rfqs: 2, activity: 3, reminders: 1 },
      );

      const [first, second] = db.all();
      assert.strictEqual(first.name, 'Elroy');
      assert.strictEqual(first.dueDate, '');
      assert.deepStrictEqual(first.activity.map((a) => a.entry), ['RFQ created.', 'Second note']);
      assert.strictEqual(first.reminders[0].notified, true);
      assert.strictEqual(second.status, 'Done');
      assert.strictEqual(second.dueDate, '2026-09-20');

      // The preferences came across, and the import will not run twice.
      assert.strictEqual(store.get().theme, 'dark');
      assert.strictEqual(store.get().sortColumn, 'dueDate');
      assert.strictEqual(store.get().legacyImported, true);

      // And the old file is untouched, so the old app still works.
      assert.ok(fs.statSync(file).size > 0);
      assert.strictEqual(readLegacyDb(file).records.length, 2);
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
}

console.log(`\n${passed} passed`);
