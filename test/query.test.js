'use strict';
/**
 * The list query: filtering, searching, sorting and the win rate.
 *
 * This is the logic that used to live in the tkinter Treeview, where it could
 * only be checked by looking at it. The rules worth pinning down are the ones a
 * reasonable implementation gets wrong: that finished work sinks to the bottom
 * in both sort directions, that blank cells sort last rather than first, and
 * that the win rate ignores everything still in flight.
 *
 * Dates are passed in rather than read from the clock, so these cases do not
 * quietly start failing on a particular Tuesday.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Db } = require('../src/main/db');
const { urgency, daysUntil, reminderString, fromDayString } = require('../src/shared/dates');

let passed = 0;
function test(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfq-query-'));
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

/** A small, deliberately messy set: mixed case, blanks, and finished work. */
function seed(dir) {
  const db = new Db(dir);
  db.create({ name: 'Elroy', company: 'OK Lutzville', status: 'Pending', description: 'Coils', dueDate: '2026-09-19' });
  db.create({ name: 'anna', company: 'Zeta Works', status: 'Quoted', description: 'Timers' });
  db.create({ name: 'Bert', company: '', status: 'Done', description: 'Old job' });
  db.create({ name: 'Cara', company: 'Minrite', status: 'Lost', description: 'Panel' });
  db.create({ name: 'Dawid', company: 'Acme', status: 'Won', description: 'Breakers', dueDate: '2026-09-01' });
  return db;
}

const names = (result) => result.rows.map((r) => r.name);

console.log('list query');

test('with no sort column, the newest RFQ is first', (dir) => {
  const db = seed(dir);
  assert.strictEqual(names(db.query())[0], 'Dawid');
});

test('the status filter only shows what is ticked', (dir) => {
  const db = seed(dir);
  assert.deepStrictEqual(names(db.query({ statuses: ['Pending', 'Quoted'] })).sort(), ['Elroy', 'anna']);
});

test('search covers name, company, phone, email and description', (dir) => {
  const db = seed(dir);
  assert.deepStrictEqual(names(db.query({ search: 'lutz' })), ['Elroy']);
  assert.deepStrictEqual(names(db.query({ search: 'timers' })), ['anna']);
  assert.deepStrictEqual(names(db.query({ search: 'LUTZ' })), ['Elroy']);
});

test('search and filter apply together', (dir) => {
  const db = seed(dir);
  assert.deepStrictEqual(names(db.query({ search: 'o', statuses: ['Done'] })), ['Bert']);
});

test('the totals count everything, the shown count only what passed', (dir) => {
  const db = seed(dir);
  const res = db.query({ statuses: ['Pending'] });
  assert.strictEqual(res.total, 5);
  assert.strictEqual(res.shown, 1);
});

test('finished work sinks to the bottom when sorting', (dir) => {
  const db = seed(dir);
  // Alphabetically Bert and Cara come second and third; being Done and Lost
  // puts them last instead.
  assert.deepStrictEqual(
    names(db.query({ sort: { column: 'name' } })),
    ['anna', 'Dawid', 'Elroy', 'Bert', 'Cara'],
  );
});

test('finished work stays at the bottom when the sort is reversed', (dir) => {
  const db = seed(dir);
  const rows = names(db.query({ sort: { column: 'name', reverse: true } }));
  assert.deepStrictEqual(rows.slice(0, 3), ['Elroy', 'Dawid', 'anna']);
  assert.deepStrictEqual(rows.slice(3).sort(), ['Bert', 'Cara']);
});

test('sorting is case-insensitive, so anna is not filed after Zeta', (dir) => {
  const db = seed(dir);
  assert.strictEqual(names(db.query({ sort: { column: 'name' } }))[0], 'anna');
});

test('blank cells sort last in both directions', (dir) => {
  const db = seed(dir);
  const live = { statuses: ['Pending', 'Quoted', 'Won'] };
  // Only Elroy and Dawid have due dates; anna does not.
  assert.strictEqual(names(db.query({ ...live, sort: { column: 'dueDate' } })).at(-1), 'anna');
  assert.strictEqual(
    names(db.query({ ...live, sort: { column: 'dueDate', reverse: true } })).at(-1),
    'anna',
  );
});

test('an unknown sort column falls back to natural order rather than throwing', (dir) => {
  const db = seed(dir);
  assert.strictEqual(names(db.query({ sort: { column: 'nonsense' } }))[0], 'Dawid');
});

test('the win rate is Won over decided, ignoring everything in flight', (dir) => {
  const db = seed(dir);
  const res = db.query();
  assert.strictEqual(res.won, 1);
  assert.strictEqual(res.lost, 1);
  assert.strictEqual(res.winRate, 50);
});

test('the win rate is null rather than zero when nothing is decided', (dir) => {
  const db = new Db(dir);
  db.create({ name: 'Open one', status: 'Pending' });
  assert.strictEqual(db.query().winRate, null);
});

test('the win rate follows the filter, because it describes what is on screen', (dir) => {
  const db = seed(dir);
  assert.strictEqual(db.query({ statuses: ['Won'] }).winRate, 100);
});

test('due dates are flagged relative to the day passed in', (dir) => {
  const db = seed(dir);
  const today = new Date(2026, 8, 17); // 17 September 2026
  const rows = db.query({ today, dueSoonDays: 3 }).rows;
  const by = Object.fromEntries(rows.map((r) => [r.name, r.urgency]));
  assert.strictEqual(by.Elroy, 'due-soon');   // due the 19th
  assert.strictEqual(by.Dawid, 'overdue');    // due the 1st
  assert.strictEqual(by.anna, '');            // no due date
});

test('the due-soon window is the setting, not a constant', (dir) => {
  const db = seed(dir);
  const today = new Date(2026, 8, 17);
  assert.strictEqual(db.query({ today, dueSoonDays: 0 }).rows.find((r) => r.name === 'Elroy').urgency, '');
});

console.log('\ndates');

test('a day string is read in local time, not as UTC midnight', () => {
  // new Date('2026-09-17') is UTC and prints as the 16th west of Greenwich.
  const d = fromDayString('2026-09-17');
  assert.strictEqual(d.getDate(), 17);
  assert.strictEqual(d.getMonth(), 8);
});

test('an impossible date is rejected rather than rolled forward', () => {
  assert.strictEqual(fromDayString('2026-02-31'), null);
  assert.strictEqual(fromDayString('not a date'), null);
});

test('days until counts whole days, negative when overdue', () => {
  const today = new Date(2026, 8, 17);
  assert.strictEqual(daysUntil('2026-09-17', today), 0);
  assert.strictEqual(daysUntil('2026-09-20', today), 3);
  assert.strictEqual(daysUntil('2026-09-10', today), -7);
  assert.strictEqual(daysUntil('', today), null);
});

test('a missing due date is not late', () => {
  assert.strictEqual(urgency('', 3, new Date(2026, 8, 17)), '');
});

test('a reminder is only accepted with a real date and a real time', () => {
  assert.strictEqual(reminderString('2026-09-17', '9:05'), '2026-09-17 09:05');
  assert.strictEqual(reminderString('2026-09-17', '25:00'), null);
  assert.strictEqual(reminderString('2026-02-31', '09:00'), null);
  assert.strictEqual(reminderString('2026-09-17', ''), null);
});

console.log(`\n${passed} passed`);
