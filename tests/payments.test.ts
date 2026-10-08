import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { verifyStripeSignature } from '../src/server/payments.ts';
import { normalizeTrackingNumber } from '../src/lib/shipping.ts';

const secret = 'whsec_test';
const sign = (payload: string, t: number) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;

describe('Zahlungs-Webhook', () => {
  it('akzeptiert gültige Signaturen', () => {
    const now = 1_800_000_000;
    assert.equal(verifyStripeSignature('{"a":1}', sign('{"a":1}', now), secret, now), true);
  });
  it('lehnt Manipulation, falsches Secret und alte Zeitstempel ab', () => {
    const now = 1_800_000_000;
    assert.equal(verifyStripeSignature('{"a":2}', sign('{"a":1}', now), secret, now), false);
    assert.equal(verifyStripeSignature('{"a":1}', sign('{"a":1}', now), 'whsec_other', now), false);
    assert.equal(verifyStripeSignature('{"a":1}', sign('{"a":1}', now - 600), secret, now), false);
    assert.equal(verifyStripeSignature('{"a":1}', null, secret, now), false);
  });
});

describe('Sendungsnummern', () => {
  it('normalisiert und prüft das Format', () => {
    assert.equal(normalizeTrackingNumber('00340 4343 1234 5678 90'), '00340434312345678 90'.replace(/\s/g, ''));
    assert.equal(normalizeTrackingNumber('1z999aa10123456784'), '1Z999AA10123456784');
    assert.equal(normalizeTrackingNumber('abc'), null);
    assert.equal(normalizeTrackingNumber('<script>'), null);
  });
});
