'use strict';
/**
 * The status vocabulary, shared by main (which decides what sinks to the
 * bottom of a sort) and the renderer (which colours it).
 *
 * The order here is the lifecycle order, and it is the order the filter
 * checkboxes appear in.
 */

const STATUSES = ['Pending', 'In Progress', 'Quoted', 'Won', 'Lost', 'Done'];

/**
 * Carried over from the tkinter app so a returning user recognises the table
 * at a glance. Kept as hex rather than CSS variables because main needs them
 * too, for the tray tooltip and the calendar badge colours.
 */
const STATUS_COLORS = {
  'Pending': '#e17055',
  'In Progress': '#e6a817',
  'Quoted': '#0984e3',
  'Won': '#00b894',
  'Lost': '#b2bec3',
  'Done': '#6c5ce7',
};

/**
 * Finished work. It still belongs in the list - you look up old quotes all the
 * time - but it should never push live RFQs off the top of a sorted view.
 */
const ARCHIVE_STATUSES = ['Done', 'Lost'];

/** Decided one way or the other, which is what a win rate is a ratio of. */
const WON = 'Won';
const LOST = 'Lost';

module.exports = { STATUSES, STATUS_COLORS, ARCHIVE_STATUSES, WON, LOST };
