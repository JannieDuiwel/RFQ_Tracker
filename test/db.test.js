'use strict';
/**
 * The RFQ store: creating, editing, deleting, and the history that hangs off a
 * record.
 *
 * These are the cases where losing or mangling data is possible, so they are
 * worth having: that an edit cannot rewrite a record's creation time, that a
 * status change writes itself into the log, that deleting an RFQ takes its
 * reminders with it, and that a corrupt file is copied aside rather than
 * silently replaced.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Db } = require('../src/main/db');

let passed = 0;
function test(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfq-db-'));
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

const sample = (over = {}) => ({
  name: 'Elroy', company: 'OK Lutzville', phone: '071 808 7787',
  email: '', description: 'Chint coils', ...over,
});

console.log('rfq store');

test('a new RFQ gets an id, a created stamp and an opening log entry', (dir) => {
  const rfq = new Db(dir).create(sample());
  assert.strictEqual(rfq.id, 1);
  assert.match(rfq.createdAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.strictEqual(rfq.activity.length, 1);
  assert.strictEqual(rfq.activity[0].entry, 'RFQ created.');
});

test('an unknown status falls back to Pending rather than being stored', (dir) => {
  assert.strictEqual(new Db(dir).create(sample({ status: 'Maybe' })).status, 'Pending');
});

test('records survive a reload', (dir) => {
  new Db(dir).create(sample());
  const db = new Db(dir);
  assert.strictEqual(db.all().length, 1);
  assert.strictEqual(db.all()[0].company, 'OK Lutzville');
});

test('ids keep counting up after a reload', (dir) => {
  new Db(dir).create(sample());
  const second = new Db(dir).create(sample({ name: 'Second' }));
  assert.strictEqual(second.id, 2);
});

test('a stale nextId in the file cannot hand out a taken id', (dir) => {
  const db = new Db(dir);
  db.create(sample());
  db.create(sample({ name: 'Second' }));
  const file = path.join(dir, 'rfqs.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.nextId = 1;
  fs.writeFileSync(file, JSON.stringify(raw));
  assert.strictEqual(new Db(dir).create(sample({ name: 'Third' })).id, 3);
});

test('an edit cannot rewrite the creation stamp or the history', (dir) => {
  const db = new Db(dir);
  const rfq = db.create(sample());
  const edited = db.update(rfq.id, {
    name: 'Elroy B', createdAt: '1999-01-01 00:00:00', activity: [],
  });
  assert.strictEqual(edited.name, 'Elroy B');
  assert.strictEqual(edited.createdAt, rfq.createdAt);
  assert.strictEqual(edited.activity.length, 1);
});

test('a status change logs itself', (dir) => {
  const db = new Db(dir);
  const rfq = db.create(sample());
  const after = db.setStatus(rfq.id, 'Quoted');
  assert.strictEqual(after.status, 'Quoted');
  assert.match(after.activity.at(-1).entry, /Pending.*Quoted/);
});

test('an edit that leaves the status alone logs nothing', (dir) => {
  const db = new Db(dir);
  const rfq = db.create(sample());
  assert.strictEqual(db.update(rfq.id, { phone: '021 000 0000' }).activity.length, 1);
});

test('an unknown status is refused rather than stored', (dir) => {
  const db = new Db(dir);
  const rfq = db.create(sample());
  assert.strictEqual(db.setStatus(rfq.id, 'Nearly'), null);
  assert.strictEqual(db.get(rfq.id).status, 'Pending');
});

test('duplicating copies the contact but not the history or the status', (dir) => {
  const db = new Db(dir);
  const rfq = db.create(sample({ status: 'Won' }));
  db.addActivity(rfq.id, 'Quote 1234 sent');
  const copy = db.duplicate(rfq.id);
  assert.strictEqual(copy.company, 'OK Lutzville');
  assert.strictEqual(copy.status, 'Pending');
  assert.strictEqual(copy.activity.length, 1);
  assert.notStrictEqual(copy.id, rfq.id);
});

test('deleting an RFQ takes its notes and reminders with it', (dir) => {
  const db = new Db(dir);
  const rfq = db.create(sample());
  db.addActivity(rfq.id, 'note');
  db.addReminder(rfq.id, '2026-01-01 09:00');
  assert.strictEqual(db.remove(rfq.id), true);
  assert.strictEqual(new Db(dir).all().length, 0);
});

test('deleting something that is not there is false, not a throw', (dir) => {
  assert.strictEqual(new Db(dir).remove(999), false);
});

test('an empty note is not added', (dir) => {
  const db = new Db(dir);
  const rfq = db.create(sample());
  assert.strictEqual(db.addActivity(rfq.id, '   '), null);
  assert.strictEqual(db.get(rfq.id).activity.length, 1);
});

test('reminders sort by when they fire, not when they were added', (dir) => {
  const db = new Db(dir);
  const rfq = db.create(sample());
  db.addReminder(rfq.id, '2026-05-01 09:00');
  db.addReminder(rfq.id, '2026-01-01 09:00');
  assert.deepStrictEqual(
    db.get(rfq.id).reminders.map((r) => r.remindAt),
    ['2026-01-01 09:00', '2026-05-01 09:00'],
  );
});

test('only reminders that have come due and not fired are returned', (dir) => {
  const db = new Db(dir);
  const rfq = db.create(sample());
  const past = db.addReminder(rfq.id, '2026-01-01 09:00');
  db.addReminder(rfq.id, '2099-01-01 09:00');

  let due = db.dueReminders('2026-06-01 12:00');
  assert.strictEqual(due.length, 1);
  assert.strictEqual(due[0].reminder.id, past.id);

  db.markNotified(past.id);
  assert.strictEqual(db.dueReminders('2026-06-01 12:00').length, 0);
});

test('a missed reminder still fires once, late', (dir) => {
  // The app was closed for a week; the follow-up is still owed.
  const db = new Db(dir);
  const rfq = db.create(sample());
  db.addReminder(rfq.id, '2026-01-01 09:00');
  assert.strictEqual(db.dueReminders('2026-01-08 09:00').length, 1);
});

test('removing a reminder leaves the others alone', (dir) => {
  const db = new Db(dir);
  const rfq = db.create(sample());
  const a = db.addReminder(rfq.id, '2026-01-01 09:00');
  db.addReminder(rfq.id, '2026-02-01 09:00');
  assert.strictEqual(db.deleteReminder(rfq.id, a.id), true);
  assert.strictEqual(db.get(rfq.id).reminders.length, 1);
  assert.strictEqual(db.deleteReminder(rfq.id, a.id), false);
});

test('suggestions match anywhere in the name, newest first, without repeats', (dir) => {
  const db = new Db(dir);
  db.create(sample({ company: 'OK Lutzville' }));
  db.create(sample({ company: 'Lutzville Motors' }));
  db.create(sample({ company: 'OK Lutzville' }));
  assert.deepStrictEqual(db.suggest('company', 'lutz'), ['OK Lutzville', 'Lutzville Motors']);
});

test('suggestions are only offered for fields that have them', (dir) => {
  const db = new Db(dir);
  db.create(sample());
  assert.deepStrictEqual(db.suggest('phone', '071'), []);
  assert.deepStrictEqual(db.suggest('company', ''), []);
});

test('a lookup returns the most recent details for that customer', (dir) => {
  const db = new Db(dir);
  db.create(sample({ company: 'Minrite', phone: 'old' }));
  db.create(sample({ company: 'Minrite', phone: 'new' }));
  assert.strictEqual(db.lookup('company', 'minrite').phone, 'new');
  assert.strictEqual(db.lookup('company', 'nobody'), null);
});

test('the calendar groups due dates by day of the month asked for', (dir) => {
  const db = new Db(dir);
  db.create(sample({ dueDate: '2026-09-19', description: 'Coils' }));
  db.create(sample({ dueDate: '2026-09-19', description: 'Timers' }));
  db.create(sample({ dueDate: '2026-10-01' }));
  const days = db.monthDue(2026, 9);
  assert.deepStrictEqual(Object.keys(days), ['19']);
  assert.deepStrictEqual(days[19].map((d) => d.label), ['Coils', 'Timers']);
});

test('a calendar entry falls back to a name when there is no description', (dir) => {
  const db = new Db(dir);
  db.create(sample({ description: '', dueDate: '2026-09-19' }));
  assert.strictEqual(new Db(dir).monthDue(2026, 9)[19][0].label, 'Elroy');
});

test('an import appends and renumbers rather than overwriting', (dir) => {
  const db = new Db(dir);
  const mine = db.create(sample({ name: 'Mine' }));
  const myReminder = db.addReminder(mine.id, '2026-03-01 09:00');
  const counts = db.importRecords([{
    id: 1, name: 'Theirs', activity: [{ ts: '2026-01-01 09:00', entry: 'x' }],
    reminders: [{ id: 1, remindAt: '2026-01-01 09:00', notified: false }],
  }]);
  assert.deepStrictEqual(counts, { rfqs: 1, activity: 1, reminders: 1 });
  assert.deepStrictEqual(db.all().map((r) => r.name), ['Mine', 'Theirs']);
  assert.deepStrictEqual(db.all().map((r) => r.id), [1, 2]);
  // The imported reminder brought id 1 with it, and so did ours. Only one of
  // them can keep it, and it is not the one from the file.
  assert.notStrictEqual(db.all()[1].reminders[0].id, myReminder.id);
});

test('a corrupt data file is kept aside rather than quietly replaced', (dir) => {
  const file = path.join(dir, 'rfqs.json');
  fs.writeFileSync(file, '{"rfqs": [ truncated');
  const db = new Db(dir);
  assert.strictEqual(db.all().length, 0);
  const kept = fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'));
  assert.strictEqual(kept.length, 1);
});

test('writes are atomic - no .tmp left behind', (dir) => {
  new Db(dir).create(sample());
  assert.ok(!fs.existsSync(path.join(dir, 'rfqs.json.tmp')));
});

test('two databases in one process do not share state', (dir) => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'rfq-db-b-'));
  try {
    new Db(dir).create(sample({ name: 'first' }));
    new Db(other).create(sample({ name: 'second' }));
    assert.strictEqual(new Db(dir).all()[0].name, 'first');
  } finally {
    fs.rmSync(other, { recursive: true, force: true });
  }
});

console.log(`\n${passed} passed`);
