'use strict';
/**
 * Fires the reminders that have come due.
 *
 * Knows nothing about Electron: it takes a db, a notify callback and a clock,
 * which is what lets a test drive a year of reminders in a millisecond instead
 * of waiting for a timer. main.js supplies the callback that actually raises a
 * Windows toast.
 *
 * A minute-resolution poll rather than a timer per reminder. Reminders are set
 * days ahead, the machine sleeps, the clock changes for daylight saving - a
 * setTimeout measured in days is wrong in all three cases, while "check what is
 * due now, every minute" is right in all of them, including after a resume.
 */

const { minuteString } = require('../shared/dates');

const DEFAULT_INTERVAL_MS = 60 * 1000;

class ReminderService {
  constructor({ db, notify, intervalMs = DEFAULT_INTERVAL_MS, now = () => new Date() }) {
    this.db = db;
    this.notify = notify;
    this.intervalMs = intervalMs;
    this.now = now;
    this.timer = null;
  }

  /**
   * Fires everything due at or before this minute. Marks each one as it goes,
   * so a reminder that was missed while the app was closed still fires once -
   * late is the correct behaviour for a follow-up you have not done yet - and
   * a reminder that has fired never fires twice.
   */
  tick() {
    const due = this.db.dueReminders(minuteString(this.now()));

    for (const { rfq, reminder } of due) {
      try {
        this.notify({
          title: 'RFQ Reminder',
          body: `Follow up: ${rfq.name || 'RFQ'} – ${rfq.company || 'no company'}`,
          rfqId: rfq.id,
        });
      } catch {
        // A failed toast must not stop the next reminder, and must not leave
        // this one unmarked to fire again in sixty seconds, forever.
      }
      this.db.markNotified(reminder.id);
    }

    return due.length;
  }

  start() {
    if (this.timer) return;
    // Once immediately, so reminders missed while the app was closed surface at
    // launch rather than a minute into it.
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    // Do not hold the process open on this alone.
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { ReminderService, DEFAULT_INTERVAL_MS };
