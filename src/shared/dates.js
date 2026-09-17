'use strict';
/**
 * Date handling, deliberately string-first.
 *
 * Everything stored and compared is a local-time string - 'YYYY-MM-DD' for a
 * day, 'YYYY-MM-DD HH:MM' for a reminder, 'YYYY-MM-DD HH:MM:SS' for a
 * timestamp. That is the shape the tkinter app wrote, so the importer needs no
 * conversion, and it sorts correctly as plain text.
 *
 * The trap this avoids: `new Date('2026-09-17')` parses as UTC midnight, so in
 * any timezone west of Greenwich it prints as the 16th. Anything that turns a
 * stored day into a Date goes through fromDayString(), which builds it from
 * parts in local time.
 */

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' for the given Date (defaults to now), in local time. */
function dayString(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD HH:MM:SS' - the activity-log timestamp format. */
function stampString(d = new Date()) {
  return `${dayString(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 'YYYY-MM-DD HH:MM' - reminders are minute-resolution, and compared as text. */
function minuteString(d = new Date()) {
  return `${dayString(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local-time Date for a 'YYYY-MM-DD' string, or null if it is not one. */
function fromDayString(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const date = new Date(y, mo - 1, d);
  // Rejects 2026-02-31, which Date would silently roll into March.
  return date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

/**
 * Whole days from today until `day`. Negative means overdue, 0 means today.
 * Returns null when `day` is empty or malformed - no due date is not late.
 */
function daysUntil(day, today = new Date()) {
  const due = fromDayString(day);
  if (!due) return null;
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due - from) / 86400000);
}

/**
 * '' | 'due-soon' | 'overdue' for a due date, given how many days ahead counts
 * as soon. Drives the row tint in the list and nothing else.
 */
function urgency(day, dueSoonDays = 3, today = new Date()) {
  const n = daysUntil(day, today);
  if (n === null) return '';
  if (n < 0) return 'overdue';
  return n <= dueSoonDays ? 'due-soon' : '';
}

/**
 * Combines a 'YYYY-MM-DD' and an 'HH:MM' into a reminder string, or returns
 * null if either is malformed. Validation lives here rather than at the call
 * site so the dialog and any future importer agree on what is acceptable.
 */
function reminderString(day, time) {
  if (!fromDayString(day)) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(day).trim()} ${pad(h)}:${pad(min)}`;
}

module.exports = {
  dayString,
  stampString,
  minuteString,
  fromDayString,
  daysUntil,
  urgency,
  reminderString,
};
