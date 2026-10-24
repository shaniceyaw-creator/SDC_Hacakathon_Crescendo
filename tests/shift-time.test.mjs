import assert from 'node:assert/strict';
import { test } from 'node:test';
import { endsNextDay, shiftHours, shiftIssue } from '../artifacts/eventops-live/src/lib/shift-time.ts';

test('5 PM to 1 AM is an eight-hour overnight shift', () => {
  assert.equal(shiftHours('17:00', '01:00'), 8);
  assert.equal(endsNextDay('17:00', '01:00'), true);
  assert.equal(shiftIssue('17:00', '01:00'), null);
});

test('midnight is a valid next-day finish, with minute precision', () => {
  assert.equal(shiftHours('17:00', '00:00'), 7);
  assert.equal(endsNextDay('17:00', '00:00'), true);
  assert.equal(shiftHours('23:45', '00:15'), 0.5);
});

test('daytime shifts keep their duration and have no next-day label', () => {
  assert.equal(shiftHours('09:30', '17:00'), 7.5);
  assert.equal(endsNextDay('09:30', '17:00'), false);
  assert.equal(shiftIssue('09:30', '17:00'), null);
});

test('equal, missing and invalid times are rejected', () => {
  for (const [start, end] of [['17:00', '17:00'], ['00:00', '00:00'], ['', '01:00'], ['17:00', ''], ['24:00', '01:00'], ['17:00', '01:60']]) {
    assert.ok(shiftIssue(start, end), `${start} to ${end} must be rejected`);
    assert.equal(endsNextDay(start, end), false);
  }
});

test('the 16-hour limit also applies across midnight', () => {
  assert.equal(shiftIssue('16:00', '08:00'), null);
  assert.match(shiftIssue('16:00', '08:01'), /16 hours/);
  assert.match(shiftIssue('17:00', '16:00'), /16 hours/);
  assert.match(shiftIssue('00:00', '16:01'), /16 hours/);
});
