'use strict';
/**
 * The reminder poller.
 *
 * Driven with a fake clock and a fake notifier, which is the point of
 * ReminderService taking both as arguments: a year of reminders fires in a
 * millisecond, and nothing here needs Electron or a real timer.
 *
 * What matters is that a reminder fires exactly once, that one that failed to
 * show a toast is still not left to retry forever, and that a reminder missed
 * while the app was shut still arrives when it opens.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Db } = require('../src/main/db');
const { ReminderService } = require('../src/main/reminders');

let passed = 0;
function test(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfq-reminders-'));
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

/** A service wired to a fixed clock and a list of the toasts it asked for. */
function harness(dir, { at, notify } = {}) {
  const db = new Db(dir);
  const sent = [];
  const service = new ReminderService({
    db,
    now: () => at,
    notify: notify || ((n) => sent.push(n)),
  });
  return { db, service, sent };
}

console.log('reminders');

test('a reminder that has come due fires, with the contact in the message', (dir) => {
  const { db, service, sent } = harness(dir, { at: new Date(2026, 8, 17, 9, 30) });
  const rfq = db.create({ name: 'Elroy', company: 'OK Lutzville' });
  db.addReminder(rfq.id, '2026-09-17 09:00');

  assert.strictEqual(service.tick(), 1);
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].body, /Elroy/);
  assert.match(sent[0].body, /OK Lutzville/);
  assert.strictEqual(sent[0].rfqId, rfq.id);
});

test('a reminder fires once and not again on the next tick', (dir) => {
  const { db, service } = harness(dir, { at: new Date(2026, 8, 17, 9, 30) });
  const rfq = db.create({ name: 'Elroy' });
  db.addReminder(rfq.id, '2026-09-17 09:00');

  assert.strictEqual(service.tick(), 1);
  assert.strictEqual(service.tick(), 0);
});

test('a reminder in the future is left alone', (dir) => {
  const { db, service } = harness(dir, { at: new Date(2026, 8, 17, 8, 0) });
  const rfq = db.create({ name: 'Elroy' });
  db.addReminder(rfq.id, '2026-09-17 09:00');
  assert.strictEqual(service.tick(), 0);
});

test('a reminder missed while the app was closed fires when it opens', (dir) => {
  const { db, service, sent } = harness(dir, { at: new Date(2026, 8, 24, 8, 0) });
  const rfq = db.create({ name: 'Elroy' });
  db.addReminder(rfq.id, '2026-09-17 09:00');
  service.tick();
  assert.strictEqual(sent.length, 1);
});

test('a company-less RFQ still produces a sensible message', (dir) => {
  const { db, service, sent } = harness(dir, { at: new Date(2026, 8, 17, 9, 30) });
  const rfq = db.create({ name: 'Elroy' });
  db.addReminder(rfq.id, '2026-09-17 09:00');
  service.tick();
  assert.match(sent[0].body, /no company/);
});

test('a toast that throws does not leave the reminder to retry forever', (dir) => {
  // Otherwise one broken notification means one per minute, for good.
  const { db, service } = harness(dir, {
    at: new Date(2026, 8, 17, 9, 30),
    notify: () => { throw new Error('no notification service'); },
  });
  const rfq = db.create({ name: 'Elroy' });
  db.addReminder(rfq.id, '2026-09-17 09:00');

  assert.strictEqual(service.tick(), 1);
  assert.strictEqual(service.tick(), 0);
});

test('a toast that throws does not stop the reminders behind it', (dir) => {
  let calls = 0;
  const { db, service } = harness(dir, {
    at: new Date(2026, 8, 17, 9, 30),
    notify: () => { calls++; throw new Error('nope'); },
  });
  const a = db.create({ name: 'A' });
  const b = db.create({ name: 'B' });
  db.addReminder(a.id, '2026-09-17 09:00');
  db.addReminder(b.id, '2026-09-17 09:00');

  assert.strictEqual(service.tick(), 2);
  assert.strictEqual(calls, 2);
});

test('the fired flag is persisted, not just remembered', (dir) => {
  const { db, service } = harness(dir, { at: new Date(2026, 8, 17, 9, 30) });
  const rfq = db.create({ name: 'Elroy' });
  db.addReminder(rfq.id, '2026-09-17 09:00');
  service.tick();

  // A fresh Db over the same directory is what the next launch sees.
  assert.strictEqual(new Db(dir).dueReminders('2026-09-17 09:30').length, 0);
});

console.log(`\n${passed} passed`);
