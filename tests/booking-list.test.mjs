import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_STATE, TYPE_TONES, filterBookings, sortBookings, groupBookings,
  readState, toSearch, toneFor, typesIn,
} from '../artifacts/eventops-live/src/lib/booking-list.ts';

const event = (id, date, type = 'Wedding Reception', extra = {}) => ({
  id, name: id, date, event_type: type, start_time: '10:00', ...extra,
});
const fixtures = [
  event('ongoing', '2026-10-20', 'Family Day', { end_date: '2026-10-24' }),
  event('past', '2026-10-20', 'Wedding Reception', { end_date: '2026-10-22' }),
  event('today', '2026-10-23', 'Family Day'),
  event('last-day', '2026-11-22', 'Conference / Seminar'),
  event('too-late', '2026-11-23', 'Wedding Reception'),
];

test('Next 30 days includes ongoing multi-day events and both date boundaries', () => {
  assert.deepEqual(filterBookings(fixtures, { period: '30', type: 'all' }, '2026-10-23', '2026-11-22')
    .map(e => e.id), ['ongoing', 'today', 'last-day']);
});

test('type and period filters combine; all confirmed retains past and distant events', () => {
  assert.equal(filterBookings(fixtures, DEFAULT_STATE, '2026-10-23', '2026-11-22').length, 5);
  assert.deepEqual(filterBookings(fixtures, { period: '30', type: 'Family Day' }, '2026-10-23', '2026-11-22')
    .map(e => e.id), ['ongoing', 'today']);
  assert.equal(filterBookings(fixtures, { period: 'all', type: 'Product Launch' }, '2026-10-23', '2026-11-22').length, 0);
});

test('soonest and latest order use date then time without mutating API data', () => {
  const rows = [event('late', '2026-11-01'), event('pm', '2026-10-25', 'Family Day', { start_time: '15:00' }),
    event('am', '2026-10-25', 'Family Day', { start_time: '09:00' })];
  const before = structuredClone(rows);
  assert.deepEqual(sortBookings(rows, 'asc').map(e => e.id), ['am', 'pm', 'late']);
  assert.deepEqual(sortBookings(rows, 'desc').map(e => e.id), ['late', 'pm', 'am']);
  assert.deepEqual(rows, before);
});

test('date groups retain date order and readable date headings', () => {
  const groups = groupBookings(sortBookings(fixtures, 'desc'), 'date');
  assert.deepEqual(groups.map(g => g.key), ['2026-11-23', '2026-11-22', '2026-10-23', '2026-10-20']);
  assert.equal(groups.at(-1).items.length, 2);
  assert.match(groups[0].label, /2026/);
});

test('event-type headings are alphabetical and keep chosen date order within each group', () => {
  const groups = groupBookings(sortBookings(fixtures, 'desc'), 'type');
  assert.deepEqual(groups.map(g => g.label), ['Conference / Seminar', 'Family Day', 'Wedding Reception']);
  assert.deepEqual(groups[2].items.map(e => e.id), ['too-late', 'past']);
  assert.deepEqual(typesIn(fixtures), ['Conference / Seminar', 'Family Day', 'Wedding Reception']);
});

test('ungrouped and empty lists retain all and only the matching records', () => {
  assert.deepEqual(groupBookings(fixtures, 'none')[0].items, fixtures);
  assert.deepEqual(groupBookings([], 'none'), []);
  assert.deepEqual(groupBookings([], 'type'), []);
});

test('URL state round-trips all controls including punctuation in type names', () => {
  const state = { period: '30', type: 'Birthday / Private Party', sort: 'desc', group: 'type' };
  assert.deepEqual(readState(toSearch(state)), state);
  assert.equal(toSearch(DEFAULT_STATE), '');
  assert.deepEqual(readState('?period=no&sort=no&group=no'), DEFAULT_STATE);
  assert.deepEqual(readState(toSearch({ ...state, period: 'all' })), { ...state, period: 'all' });
});

const luminance = (hex) => {
  const c = hex.match(/[0-9a-f]{2}/gi).map(s => parseInt(s, 16) / 255)
    .map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
  return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
};

test('all nine event types have distinct stable readable colours and text labels', () => {
  assert.equal(Object.keys(TYPE_TONES).length, 9);
  assert.equal(new Set(Object.values(TYPE_TONES).map(t => t.bg)).size, 9);
  for (const [type, tone] of Object.entries(TYPE_TONES)) {
    assert.equal(toneFor(type), tone);
    const [low, high] = [luminance(tone.fg), luminance(tone.bg)].sort((a, b) => a - b);
    assert.ok((high + .05) / (low + .05) >= 4.5, `${type} must meet normal-text contrast`);
  }
  assert.equal(toneFor('Future event type'), toneFor('Another unknown type'));
});
