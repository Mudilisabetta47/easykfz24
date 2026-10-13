#!/usr/bin/env node
// TESTNACHBAU – nur für lokale Tests, nie produktiv. Bildet die dokumentierten Endpunkte der Mollie Payments API v2 nach
// (docs.mollie.com: Create/Get payment, List methods, Idempotency, Handling errors), damit Fehlerfälle reproduzierbar
// getestet werden können. Echte Testzahlungen laufen über den Mollie-Testmodus (Schlüssel test_…).
//
//   node scripts/fake-mollie.mjs [port]        Basis-URL: http://127.0.0.1:<port>/v2, Schlüssel test_fakeMollieKey0123456789 (oder live_…)
//
// Steuerung für Tests (nicht Teil der Mollie-API):
//   POST /__test/set     {"id":"tr_…","status":"paid","amountValue":"1.00","amountRefunded":"10.00","amountChargedBack":"5.00","method":"creditcard","metadata":{…}}
//   POST /__test/mode    {"offline":true} | {"dropNextPostResponse":true} | {"failNextPost":503} | {"failNextGet":500}
//   GET  /__test/state   alle Zahlungen und Aufrufe
import http from 'node:http';
import { randomBytes } from 'node:crypto';

export const FAKE_MOLLIE_KEYS = { test: 'test_fakeMollieKey0123456789', live: 'live_fakeMollieKey0123456789' };

export function createFakeMollie() {
  const payments = new Map(); // id -> payment (+ _key, _body)
  const idem = new Map(); // key -> { body, status, response }
  const calls = [];
  const mode = { offline: false, dropNextPostResponse: false, failNextPost: 0, failNextGet: 0 };
  const nowIso = () => new Date().toISOString();
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/hal+json', ...headers });
    res.end(JSON.stringify(body));
  };
  const error = (res, status, title, detail, field) =>
    send(res, status, {
      status,
      title,
      detail,
      ...(field ? { field } : {}),
      _links: { documentation: { href: 'https://docs.mollie.com/reference/handling-errors', type: 'text/html' } },
    });
  const money = (v) => typeof v === 'string' && /^\d{1,9}\.\d{2}$/.test(v);
  const view = (p) => {
    const { _key, _body, ...rest } = p;
    return rest;
  };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/__test/state') return send(res, 200, { payments: [...payments.values()].map(view), calls });
      if (url.pathname === '/__test/mode' && req.method === 'POST') {
        Object.assign(mode, JSON.parse(raw || '{}'));
        return send(res, 200, mode);
      }
      if (url.pathname === '/__test/set' && req.method === 'POST') {
        const b = JSON.parse(raw || '{}');
        const p = payments.get(b.id);
        if (!p) return error(res, 404, 'Not Found', 'unbekannt');
        if (b.status) {
          p.status = b.status;
          if (b.status === 'paid') p.paidAt = nowIso();
          if (b.status === 'failed') p.failedAt = nowIso();
          if (b.status === 'canceled') p.canceledAt = nowIso();
          if (b.status === 'expired') p.expiredAt = nowIso();
          if (b.status !== 'open') delete p._links.checkout;
        }
        if (b.amountValue) p.amount = { currency: b.currency ?? 'EUR', value: b.amountValue };
        if (b.amountRefunded) p.amountRefunded = { currency: 'EUR', value: b.amountRefunded };
        if (b.amountChargedBack) p.amountChargedBack = { currency: 'EUR', value: b.amountChargedBack };
        if (b.method) p.method = b.method;
        if (b.metadata !== undefined) p.metadata = b.metadata;
        return send(res, 200, view(p));
      }

      const m = /^\/v2(\/.*)$/.exec(url.pathname);
      if (!m) return error(res, 404, 'Not Found', 'unbekannte Adresse');
      if (mode.offline) return req.socket.destroy();
      const auth = req.headers.authorization ?? '';
      const keyMode = auth === `Bearer ${FAKE_MOLLIE_KEYS.test}` ? 'test' : auth === `Bearer ${FAKE_MOLLIE_KEYS.live}` ? 'live' : null;
      if (!keyMode) return error(res, 401, 'Unauthorized Request', 'Missing authentication, or failed to authenticate');
      const path = m[1];
      calls.push({ method: req.method, path, idempotencyKey: req.headers['idempotency-key'] ?? null, at: nowIso() });

      if (req.method === 'GET' && path === '/methods') {
        return send(res, 200, {
          count: 3,
          _embedded: {
            methods: [
              { resource: 'method', id: 'creditcard' },
              { resource: 'method', id: 'paypal' },
              { resource: 'method', id: 'applepay' },
            ],
          },
        });
      }
      if (req.method === 'POST' && path === '/payments') {
        const key = req.headers['idempotency-key'];
        if (key && idem.has(key)) {
          const prev = idem.get(key);
          if (prev.body !== raw) return error(res, 400, 'Bad Request', 'Idempotency key reused with different parameters');
          return send(res, prev.status, prev.response, { 'Idempotent-Replayed': 'true' });
        }
        let b;
        try {
          b = JSON.parse(raw);
        } catch {
          return error(res, 400, 'Bad Request', 'Invalid JSON');
        }
        if (!b.amount || b.amount.currency !== 'EUR' || !money(b.amount.value))
          return error(res, 422, 'Unprocessable Entity', 'The amount is invalid', 'amount');
        if (!b.description) return error(res, 422, 'Unprocessable Entity', 'The description is required', 'description');
        if (!b.redirectUrl) return error(res, 422, 'Unprocessable Entity', 'The redirect URL is required', 'redirectUrl');
        if (b.webhookUrl && /localhost|127\.0\.0\.1/.test(b.webhookUrl))
          return error(res, 422, 'Unprocessable Entity', 'The webhook URL is invalid because it is unreachable from Mollie', 'webhookUrl');
        if (mode.failNextPost) {
          const code = mode.failNextPost;
          mode.failNextPost = 0;
          return error(res, code, 'Service Unavailable', 'Test: Störung');
        }
        const id = `tr_${randomBytes(6).toString('hex')}`;
        const p = {
          resource: 'payment',
          id,
          mode: keyMode,
          createdAt: nowIso(),
          amount: { currency: 'EUR', value: b.amount.value },
          description: b.description,
          method: b.method ?? null,
          metadata: b.metadata ?? null,
          status: 'open',
          isCancelable: false,
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          profileId: 'pfl_fake',
          sequenceType: 'oneoff',
          redirectUrl: b.redirectUrl,
          ...(b.webhookUrl ? { webhookUrl: b.webhookUrl } : {}),
          _links: {
            self: { href: `https://api.mollie.com/v2/payments/${id}`, type: 'application/hal+json' },
            checkout: { href: `https://www.mollie.com/checkout/test-mode?method=&token=${id}`, type: 'text/html' },
          },
          _key: key ?? null,
          _body: b,
        };
        payments.set(id, p);
        if (key) idem.set(key, { body: raw, status: 201, response: view(p) });
        if (mode.dropNextPostResponse) {
          mode.dropNextPostResponse = false;
          return req.socket.destroy();
        }
        return send(res, 201, view(p));
      }
      const g = /^\/payments\/([^/]+)$/.exec(path);
      if (req.method === 'GET' && g) {
        if (mode.failNextGet) {
          const code = mode.failNextGet;
          mode.failNextGet = 0;
          return error(res, code, 'Internal Server Error', 'Test: Störung');
        }
        const p = payments.get(g[1]);
        if (!p || p.mode !== keyMode) return error(res, 404, 'Not Found', 'No payment exists with token');
        return send(res, 200, view(p));
      }
      return error(res, 404, 'Not Found', 'unbekannte Adresse');
    });
  });
  return { server, payments, calls, mode };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 3042);
  createFakeMollie().server.listen(port, '127.0.0.1', () =>
    console.log(`Testnachbau Mollie auf http://127.0.0.1:${port}/v2 – Schlüssel ${FAKE_MOLLIE_KEYS.test}`),
  );
}
