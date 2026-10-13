#!/usr/bin/env node
// TESTNACHBAU – nur für lokale Tests, nie produktiv. Bildet die dokumentierten Vollmacht-Endpunkte von kfz-api.de nach
// (OpenAPI /spec/api.yaml 2.3.0, Seite „Vollmacht für Dritte mit Nect“), damit keine echten, kostenpflichtigen und
// rechtsverbindlichen Vollmachten entstehen. Die Sandbox des Partners bildet Vollmachtsvorgänge laut Doku nicht ab.
//
//   node scripts/fake-kfz-api.mjs [port]        Basis-URL: http://127.0.0.1:<port>/fake-api/10/2.3.0, Login test / test
//
// Steuerung für Tests (nicht Teil der Partner-API):
//   POST /__test/set     {"id":1,"status":"signiert","ready":true,"missing":[],"note":"","blocking":[]}
//   POST /__test/mode    {"offline":true} | {"dropNextPostResponse":true} | {"failNextPost":502}
//   GET  /__test/state   alle Vorgänge
import http from 'node:http';

export function createFakeKfzApi() {
  const processes = new Map(); // id -> process
  const byExternal = new Map(); // externalOrderId -> id
  const mode = { offline: false, dropNextPostResponse: false, failNextPost: 0 };
  let nextId = 4711;
  const AUTH = `Basic ${Buffer.from('test:test').toString('base64')}`;
  const nowIso = () => new Date().toISOString();
  const send = (res, status, body, trace = `fake-${Date.now()}`) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'X-Trace-Id': trace });
    res.end(JSON.stringify(body));
  };
  const error = (res, status, msg, extra = {}) => send(res, status, { error: `${msg} (TraceId: fake)`, traceId: 'fake', ...extra });
  const signature = (p) => JSON.stringify({ principal: p.principal, representative: p.representative, email: String(p.email).toLowerCase(), vehicles: p.vehicles, bankAccount: p.bankAccount ?? null });
  const view = (p) => {
    const { _sig, _body, ...rest } = p;
    return rest;
  };

  function validate(b) {
    const a = b?.principal?.address;
    if (!a || !b.representative?.address || !b.email || !Array.isArray(b.vehicles) || !b.vehicles.length) return 'Pflichtfeld fehlt (principal, representative, email, vehicles)';
    if (a.firstName && a.companyName) return 'principal.address: firstName/lastName und companyName zugleich';
    if (!a.streetName || !a.zipCode || !a.cityName) return 'principal.address: Straße, PLZ oder Ort fehlen';
    if (a.houseNumber !== undefined && !/^[0-9]{1,4}$/.test(String(a.houseNumber))) return 'principal.address.houseNumber: nur Ziffern';
    if (!/^\d{5}$/.test(String(a.zipCode))) return 'Vollmachtgeber_Postleitzahl (höchstens 5)';
    if (a.lastName && (!b.principal.dateOfBirth || !b.principal.placeOfBirth)) return 'principal: dateOfBirth und placeOfBirth sind bei natürlichen Personen Pflicht';
    for (const [i, v] of b.vehicles.entries()) if (!/^[0-9A-Za-z]{1,25}$/.test(String(v.vehicleIdentificationNumber ?? ''))) return `vehicles[${i}].vehicleIdentificationNumber`;
    if (b.redirectUrl !== undefined) return 'redirectUrl: keine Rücksprungadresse im Dashboard hinterlegt';
    if (b.externalOrderId && String(b.externalOrderId).length > 100) return 'externalOrderId: höchstens 100 Zeichen';
    return null;
  }

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      // Teststeuerung
      if (url.pathname === '/__test/state') return send(res, 200, { processes: [...processes.values()].map(view) });
      if (url.pathname === '/__test/mode' && req.method === 'POST') {
        Object.assign(mode, JSON.parse(raw || '{}'));
        return send(res, 200, mode);
      }
      if (url.pathname === '/__test/set' && req.method === 'POST') {
        const b = JSON.parse(raw || '{}');
        const p = processes.get(Number(b.id));
        if (!p) return error(res, 404, 'unbekannt');
        if (b.status) p.status = b.status;
        if (b.ready !== undefined) p.readyForApplication = !!b.ready;
        if (b.missing) p.missingHolderFields = b.missing;
        if (b.blocking) p.blockingIssues = b.blocking;
        if (b.note !== undefined) p.note = b.note;
        p.updatedAt = nowIso();
        return send(res, 200, view(p));
      }

      const m = /^\/fake-api\/10\/2\.3\.0(\/.*)$/.exec(url.pathname);
      if (!m) return error(res, 404, 'unbekannte Adresse');
      if (mode.offline) return req.socket.destroy();
      if (req.headers.authorization !== AUTH) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="dropshipping-api"', 'Content-Type': 'application/json', 'X-Trace-Id': 'fake' });
        return res.end(JSON.stringify({ error: 'nicht angemeldet', traceId: 'fake' }));
      }
      const path = m[1];
      if (req.method === 'POST' && path === '/powerOfAttorneys') {
        let b;
        try {
          b = JSON.parse(raw);
        } catch {
          return error(res, 400, 'JSON nicht lesbar');
        }
        const problem = validate(b);
        if (problem) return error(res, 400, problem);
        if (mode.failNextPost) {
          const code = mode.failNextPost;
          mode.failNextPost = 0;
          const id = nextId++;
          processes.set(id, { id, status: 'fehlgeschlagen', provider: 'Nect', signatureUrl: null, validUntil: null, externalOrderId: b.externalOrderId ?? null, vehicleIdentificationNumber: b.vehicles[0].vehicleIdentificationNumber, createdAt: nowIso(), updatedAt: nowIso(), readyForApplication: false, note: 'Nect gestört (Test)', _sig: signature(b) });
          return error(res, code, 'Nect hat den Vorgang nicht angelegt (Test)', { powerOfAttorneyId: id });
        }
        // Wiederholen ohne zweiten Vorgang: gleiche externalOrderId + offen + gleiche Angaben → derselbe Vorgang (200)
        const existingId = b.externalOrderId ? byExternal.get(b.externalOrderId) : undefined;
        const existing = existingId ? processes.get(existingId) : undefined;
        if (existing && existing.status === 'offen') {
          if (existing._sig !== signature(b)) return error(res, 409, 'Unter derselben externalOrderId liegt ein offener Vorgang mit anderen Angaben', { powerOfAttorneyId: existing.id });
          return send(res, 200, { powerOfAttorney: view(existing) });
        }
        const id = nextId++;
        const p = {
          id,
          status: 'offen',
          provider: 'Nect',
          signatureUrl: `https://sign.example.test/s/${id}`,
          validUntil: null,
          externalOrderId: b.externalOrderId ?? null,
          vehicleIdentificationNumber: b.vehicles[0].vehicleIdentificationNumber,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          readyForApplication: false,
          ...(b.sendEmail === false ? {} : {}),
          _sig: signature(b),
          _body: b,
        };
        processes.set(id, p);
        if (b.externalOrderId) byExternal.set(b.externalOrderId, id);
        if (mode.dropNextPostResponse) {
          mode.dropNextPostResponse = false;
          return req.socket.destroy(); // Vorgang angelegt, Antwort geht verloren
        }
        return send(res, 200, { powerOfAttorney: view(p) });
      }
      const g = /^\/powerOfAttorneys\/([^/]+)$/.exec(path);
      if (req.method === 'GET' && g) {
        if (!/^\d+$/.test(g[1])) return error(res, 400, 'processId ist keine ganze Zahl');
        const p = processes.get(Number(g[1]));
        if (!p) return error(res, 404, 'Vorgang unbekannt oder nicht Ihrer');
        return send(res, 200, { powerOfAttorney: view(p) });
      }
      return error(res, 404, 'unbekannte Adresse');
    });
  });
  return { server, processes, mode };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 3041);
  createFakeKfzApi().server.listen(port, '127.0.0.1', () => console.log(`Testnachbau kfz-api (Vollmacht) auf http://127.0.0.1:${port}/fake-api/10/2.3.0 – Login test/test`));
}
