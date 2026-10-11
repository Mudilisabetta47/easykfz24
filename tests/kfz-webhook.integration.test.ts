// Integrationstest des kfz-api-Webhooks mit echter SQLite-Datenbank in einem temporären Ordner.
// Sendet nichts an kfz-api.de; signiert wird mit einem Testschlüssel.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { signKfzBody } from '../src/lib/kfz-api.ts';

const SECRET = 'integrationstest-secret';
process.env.KFZ_API_WEBHOOK_SECRET = SECRET;

const { handleKfzWebhook } = await import('../src/server/kfz-api.ts');
const { getDb, schemaVersion } = await import('../src/server/db.ts');

async function call(body: unknown, opts: { sign?: boolean; sig?: string; eventId?: string } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (opts.sign !== false) headers.set('X-Signature', opts.sig ?? signKfzBody(raw, SECRET));
  if (opts.eventId) headers.set('X-Event-Id', opts.eventId);
  return (await handleKfzWebhook(raw, headers)).result;
}

const PING = { event: 'PING' };
const STATUS = { order: { id: 4711, externalId: 'EK-2099-00001' }, businessTransaction: 'AB', status: 'ACCEPTED', derivedStatus: 'PENDING' };

describe('kfz-api Webhook – Speicher nicht verfügbar (wie in Produktion beobachtet)', () => {
  it('beantwortet einen gültig signierten PING trotzdem mit 200', async () => {
    const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ek-kaputt-')), 'datei');
    fs.writeFileSync(blocker, 'kein Ordner');
    process.env.DATA_DIR = path.join(blocker, 'data'); // Ordner kann nicht angelegt werden
    const r = await call(PING, { eventId: 'ping-ohne-speicher' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { received: true, ping: true });
  });
  it('lehnt ungültige Signaturen weiterhin mit 401 ab', async () => {
    assert.equal((await call(PING, { sig: 'deadbeef' })).status, 401);
    assert.equal((await call(PING, { sign: false })).status, 401);
  });
  it('antwortet bei Statusmeldungen mit 503 statt 500, damit kfz-api.de erneut zustellt', async () => {
    const r = await call(STATUS, { eventId: 'status-ohne-speicher' });
    assert.equal(r.status, 503);
  });
});

describe('kfz-api Webhook – mit Datenbank', () => {
  it('führt alle Migrationen aus und speichert den signierten PING', async () => {
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-test-'));
    const r = await call(PING, { eventId: 'ping-1' });
    assert.equal(r.status, 200);
    assert.ok((await schemaVersion()) >= 3, 'Migration v3 (kfz-api) ausgeführt');
    const row = (await (await getDb()).first<{ outcome: string }>('SELECT outcome FROM kfz_webhook_events WHERE event_id = ?', 'ping-1'))!;
    assert.equal(row.outcome, 'ping');
  });
  it('speichert Meldungen ohne passenden Auftrag zur späteren Zuordnung und erkennt Wiederholungen', async () => {
    assert.deepEqual((await call(STATUS, { eventId: 'ev-1' })).body, { received: true, matched: false });
    assert.deepEqual((await call(STATUS, { eventId: 'ev-1' })).body, { received: true, duplicate: true });
    const row = (await (await getDb()).first<{ outcome: string; deliveries: number }>('SELECT outcome, deliveries FROM kfz_webhook_events WHERE event_id = ?', 'ev-1'))!;
    assert.equal(row.outcome, 'nicht_zugeordnet');
    assert.equal(row.deliveries, 2);
  });
  it('lehnt einen veränderten Rumpf ab', async () => {
    const raw = JSON.stringify(PING);
    const headers = new Headers({ 'X-Signature': signKfzBody(raw, SECRET) });
    assert.equal((await handleKfzWebhook(raw.replace('PING', 'PONG'), headers)).result.status, 401);
  });
});
