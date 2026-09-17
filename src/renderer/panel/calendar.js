'use strict';
/**
 * The calendar view: one month of due dates.
 *
 * Weeks start on Monday, which is where a working week starts and what the
 * tkinter version used. JavaScript disagrees - getDay() calls Sunday 0 - so the
 * offset is computed once, in firstColumn(), rather than being rediscovered at
 * each call site.
 */

const CalendarView = (() => {
  const esc = App.esc;

  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  // The month on display. Not persisted: the calendar always opens on the
  // current month, because that is the question it is usually asked.
  let year = new Date().getFullYear();
  let month = new Date().getMonth() + 1;

  /** Which column (0 = Monday) the 1st of the month falls in. */
  function firstColumn(y, m) {
    return (new Date(y, m - 1, 1).getDay() + 6) % 7;
  }

  /** Day 0 of the next month is the last day of this one. */
  function daysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
  }

  async function refresh() {
    document.getElementById('cal-title').textContent = `${MONTHS[month - 1]} ${year}`;

    const res = await App.call(App.api.monthDue(year, month));
    if (!res) return;

    const days = res.days;
    const today = new Date();
    const isThisMonth = today.getFullYear() === year && today.getMonth() + 1 === month;

    const cells = [];
    for (let i = 0; i < firstColumn(year, month); i++) {
      cells.push('<div class="cal-cell blank"></div>');
    }

    for (let d = 1; d <= daysInMonth(year, month); d++) {
      const items = (days[d] || []).map((item) => {
        const color = App.state.statusColors[item.status] || 'var(--accent)';
        return `<button class="cal-item" data-id="${item.id}" style="background:${color}" `
          + `title="${esc(item.label)} — ${esc(item.status)}">${esc(item.label)}</button>`;
      }).join('');

      const todayClass = isThisMonth && d === today.getDate() ? ' today' : '';
      cells.push(
        `<div class="cal-cell${todayClass}"><div class="cal-day">${d}</div>${items}</div>`,
      );
    }

    document.getElementById('cal-grid').innerHTML = cells.join('');
  }

  function step(delta) {
    month += delta;
    if (month < 1) {
      month = 12;
      year--;
    } else if (month > 12) {
      month = 1;
      year++;
    }
    refresh();
  }

  function init() {
    document.getElementById('cal-prev').addEventListener('click', () => step(-1));
    document.getElementById('cal-next').addEventListener('click', () => step(1));
    document.getElementById('cal-today').addEventListener('click', () => {
      year = new Date().getFullYear();
      month = new Date().getMonth() + 1;
      refresh();
    });

    document.getElementById('cal-grid').addEventListener('click', (e) => {
      const item = e.target.closest('.cal-item');
      if (item) Detail.open(item.dataset.id);
    });
  }

  return { init, refresh };
})();
