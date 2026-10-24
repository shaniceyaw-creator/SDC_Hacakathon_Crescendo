import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  APP_BASE_PATH, SIGN_IN_PATH, RECEIPT_AUTH_PATH,
  canonicalAppPath, receiptReturnPath,
} from '../artifacts/api-server/src/lib/public-paths.ts';

test('public paths use OpusEvents', () => {
  assert.equal(APP_BASE_PATH, '/opusevents');
  assert.equal(SIGN_IN_PATH, '/opusevents/sign-in');
  assert.equal(RECEIPT_AUTH_PATH, '/opusevents/api/receipt-auth');
});

test('legacy page bookmarks preserve deep links and queries without loops', () => {
  assert.equal(canonicalAppPath('/eventops-live'), '/opusevents/');
  assert.equal(canonicalAppPath('/eventops-live/'), '/opusevents/');
  assert.equal(canonicalAppPath('/eventops-live/sign-in'), SIGN_IN_PATH);
  assert.equal(canonicalAppPath('/eventops-live/manager/bookings/EV-1023?tab=tasks'),
    '/opusevents/manager/bookings/EV-1023?tab=tasks');
  assert.equal(canonicalAppPath('/EVENTOPS-LIVE/sign-in'), SIGN_IN_PATH);
  assert.equal(canonicalAppPath('/eventops-live?source=bookmark'), '/opusevents/?source=bookmark');
  assert.equal(canonicalAppPath('/opusevents'), '/opusevents/');
  assert.equal(canonicalAppPath('/opusevents/sign-in'), SIGN_IN_PATH);
  assert.equal(canonicalAppPath('/eventops-live-other/sign-in'), '/eventops-live-other/sign-in');
});

test('receipt sign-in returns to canonical booking pages, including older flows', () => {
  for (const role of ['manager', 'worker']) {
    assert.equal(receiptReturnPath(`/opusevents/${role}/bookings/EV-1023`),
      `/opusevents/${role}/bookings/EV-1023`);
    assert.equal(receiptReturnPath(`/eventops-live/${role}/bookings/EV-1023`),
      `/opusevents/${role}/bookings/EV-1023`);
  }
});

test('receipt return validation still rejects external and unexpected destinations', () => {
  for (const value of [
    undefined, null, {}, ['manager'], '', '/opusevents/sign-in',
    'https://example.com/opusevents/manager/bookings/EV-1023',
    '//example.com/opusevents/manager/bookings/EV-1023',
    '/opusevents/customer/bookings/EV-1023',
    '/opusevents/manager/bookings/EV-1023?redirect=outside',
    '/opusevents/manager/bookings/EV-1023/../../other',
    '/opusevents/manager/bookings/EV-1023\n',
  ]) assert.equal(receiptReturnPath(value), SIGN_IN_PATH);
});
