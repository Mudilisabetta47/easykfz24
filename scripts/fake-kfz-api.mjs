#!/usr/bin/env node
// TESTNACHBAU – nur für lokale Tests, nie produktiv. Bildet dokumentierte Endpunkte von kfz-api.de nach (OpenAPI
// spec/api.yaml 2.3.0), damit keine echten, kostenpflichtigen und rechtsverbindlichen Vorgänge entstehen. Die Sandbox des
// Partners (separater Zugang im Dashboard) ersetzt er nicht – er prüft nur unseren Ablauf gegen die Spezifikation.
//   - Vollmacht: POST /powerOfAttorneys, GET /powerOfAttorneys/{processId}
//   - Außerbetriebsetzung: POST /vehicleDeregistrations/deregistrations (Schema VehicleDeregistrationRequest, Schutz über
//     externalOrderId + FIN binnen 15 Minuten, 409 bei abweichenden Daten), GET /vehicleDeregistrations/orders
//     (externalId exakt, businessTransaction, limit), GET /vehicleDeregistrations/orders/{orderId}
//
//   node scripts/fake-kfz-api.mjs [port]        Basis-URL: http://127.0.0.1:<port>/fake-api/10/2.3.0, Login test / test
//
// Steuerung für Tests (nicht Teil der Partner-API):
//   POST /__test/set     {"id":1,"status":"signiert","ready":true,"missing":[],"note":"","blocking":[]}
//   POST /__test/mode    {"offline":true} | {"dropNextPostResponse":true} | {"failNextPost":502}
//                        {"dropNextAbResponse":true} | {"failNextAb":500|503|403} | {"abDelayMs":40000}
//   POST /__test/ab      {"id":1000,"state":"beschieden","derivedStatus":"SUCCESS","ageMinutes":20}
//   GET  /__test/state   alle Vorgänge
import http from 'node:http';

export function createFakeKfzApi() {
  const processes = new Map(); // id -> process
  const byExternal = new Map(); // externalOrderId -> id
  const mode = { offline: false, dropNextPostResponse: false, failNextPost: 0, dropNextAbResponse: false, failNextAb: 0, abDelayMs: 0 };
  let nextId = 4711;
  const abOrders = new Map(); // id -> Außerbetriebsetzung
  let nextAbId = 1000;
  const abSig = (b) => JSON.stringify({ email: b.email, customization: b.customization });

  // Schema VehicleDeregistrationRequest / VehicleDeregistrationCustomization (spec/api.yaml 2.3.0)
  function validateAb(b) {
    if (!b || typeof b !== 'object') return 'Rumpf fehlt';
    if (typeof b.email !== 'string' || b.email.length < 3 || b.email.length > 255 || !b.email.includes('@')) return 'email: Pflichtfeld (3–255 Zeichen)';
    if (b.externalOrderId != null && (typeof b.externalOrderId !== 'string' || b.externalOrderId.length > 100)) return 'externalOrderId: höchstens 100 Zeichen';
    const c = b.customization;
    if (!c || typeof c !== 'object') return 'customization: Pflichtfeld';
    const allowed = ['productType', 'licensePlateNumberComponents', 'licensePlateReservationIncluded', 'vehicleIdentificationNumber', 'vehicleRegistrationCertificateSecurityCode', 'frontLicensePlateSecurityCode', 'rearLicensePlateSecurityCode', 'vehicleRegistrationCertificateNumber', 'recycling', 'vehicleRegistrationCertificatePartII', 'contractPartner'];
    for (const k of Object.keys(c)) if (!allowed.includes(k)) return `customization.${k}: unbekanntes Feld`;
    for (const k of Object.keys(b)) if (!['customization', 'email', 'externalOrderId', 'correctionOf', 'gksConfigurationId', 'vehicleHolder'].includes(k)) return `${k}: unbekanntes Feld`;
    if (c.productType !== undefined && c.productType !== 'VEHICLE_DEREGISTRATION') return 'customization.productType';
    const p = c.licensePlateNumberComponents;
    if (!p || !/^[A-Za-zÄÖÜäöü]{1,3}$/.test(p.city ?? '') || !/^[A-Za-z]{1,2}$/.test(p.middle ?? '') || !/^[0-9]{1,4}$/.test(p.end ?? '')) return 'customization.licensePlateNumberComponents';
    if (p.usageType !== undefined && !['EURO', 'ELECTRIC', 'HISTORIC'].includes(p.usageType)) return 'licensePlateNumberComponents.usageType';
    if (typeof c.licensePlateReservationIncluded !== 'boolean') return 'customization.licensePlateReservationIncluded: Pflichtfeld';
    if (!/^[0-9A-Za-z]{1,25}$/.test(c.vehicleIdentificationNumber ?? '')) return 'Fehlercode 00306: vehicleIdentificationNumber';
    if (!/^[0-9a-zA-Z]{7}$/.test(c.vehicleRegistrationCertificateSecurityCode ?? '')) return 'customization.vehicleRegistrationCertificateSecurityCode: Muster';
    if (!/^[0-9a-zA-Z]{3}$/.test(c.rearLicensePlateSecurityCode ?? '')) return 'customization.rearLicensePlateSecurityCode: Muster';
    if (c.frontLicensePlateSecurityCode != null && !/^[0-9a-zA-Z]{3}$/.test(c.frontLicensePlateSecurityCode)) return 'customization.frontLicensePlateSecurityCode: Muster';
    if (c.contractPartner !== undefined && !/^[UBS][0-9]{6}$/.test(String(c.contractPartner).trim().toUpperCase())) return 'customization.contractPartner';
    return null;
  }
  const abSummary = (o) => ({
    order: { id: o.id, externalId: o.externalId },
    attemptOf: o.id,
    businessTransaction: 'AB',
    state: o.state,
    derivedStatus: o.derivedStatus,
    applicationId: o.applicationId,
    vehicleIdentificationNumber: o.fin,
    licensePlate: o.licensePlate,
    createdAt: o.createdAt,
    changedAt: o.updatedAt,
  });
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
      if (url.pathname === '/__test/state') return send(res, 200, { processes: [...processes.values()].map(view), deregistrations: [...abOrders.values()].map(({ _sig, ...o }) => o) });
      if (url.pathname === '/__test/ab' && req.method === 'POST') {
        const b = JSON.parse(raw || '{}');
        const o = abOrders.get(Number(b.id));
        if (!o) return error(res, 404, 'unbekannt');
        if (b.state) o.state = b.state;
        if (b.derivedStatus) o.derivedStatus = b.derivedStatus;
        if (b.ageMinutes) o._at = Date.now() - b.ageMinutes * 60_000;
        if (b.files) o.files = b.files;
        o.updatedAt = nowIso();
        return send(res, 200, abSummary(o));
      }
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
      if (req.method === 'POST' && path === '/vehicleDeregistrations/deregistrations') {
        if (!/^application\/json/.test(req.headers['content-type'] ?? '')) return error(res, 415, 'Content-Type muss application/json sein');
        let b;
        try {
          b = JSON.parse(raw);
        } catch {
          return error(res, 400, 'JSON nicht lesbar');
        }
        const problem = validateAb(b);
        if (problem) return error(res, 400, problem);
        const trace = /^[A-Za-z0-9._:-]{1,128}$/.test(req.headers['x-trace-id'] ?? '') ? req.headers['x-trace-id'] : `fake-${Date.now()}`;
        if (mode.failNextAb) {
          const code = mode.failNextAb;
          mode.failNextAb = 0;
          return send(res, code, { error: `Testfehler ${code} (TraceId: ${trace})`, traceId: trace }, trace);
        }
        const fin = String(b.customization.vehicleIdentificationNumber).toUpperCase();
        // Wiederholungsversuch: dasselbe Konto, dieselbe externalOrderId, dieselbe FIN, binnen 15 Minuten
        const same = b.externalOrderId ? [...abOrders.values()].find((o) => o.externalId === b.externalOrderId && o.fin === fin) : undefined;
        if (same && Date.now() - same._at < 15 * 60_000) {
          if (same._sig !== abSig(b)) return send(res, 409, { error: `Unter dieser externalOrderId und FIN liegt bereits ein Vorgang mit anderen Daten (TraceId: ${trace})`, traceId: trace }, trace);
          return send(res, 200, { order: { id: same.id } }, trace);
        }
        const c = b.customization;
        const p = c.licensePlateNumberComponents;
        const o = {
          id: nextAbId++,
          externalId: b.externalOrderId ?? null,
          fin,
          state: 'eingereicht',
          derivedStatus: 'PENDING',
          applicationId: null,
          licensePlate: `${p.city.toUpperCase()}-${p.middle.toUpperCase()} ${p.end}`,
          files: [],
          messages: [],
          createdAt: nowIso(),
          updatedAt: nowIso(),
          _at: Date.now(),
          _sig: abSig(b),
          _body: b,
        };
        abOrders.set(o.id, o);
        const reply = () => {
          if (mode.dropNextAbResponse) {
            mode.dropNextAbResponse = false;
            return req.socket.destroy(); // Antrag angelegt, Antwort geht verloren
          }
          send(res, 200, { order: { id: o.id } }, trace);
        };
        return mode.abDelayMs ? setTimeout(reply, mode.abDelayMs) : reply();
      }
      if (req.method === 'GET' && path === '/vehicleDeregistrations/orders') {
        const ext = url.searchParams.get('externalId');
        if (ext === '') return error(res, 400, 'externalId leer');
        const bt = url.searchParams.get('businessTransaction');
        if (bt !== null && !bt.split(',').every((x) => ['AB', 'HA', 'UG', 'WG', 'WZ', 'NZ', 'TZ'].includes(x))) return error(res, 400, `businessTransaction unbekannt: ${bt}`);
        const limit = Math.min(200, Number(url.searchParams.get('limit') ?? 50));
        const all = [...abOrders.values()].filter((o) => (ext === null || o.externalId === ext) && (bt === null || bt.split(',').includes('AB'))).reverse();
        return send(res, 200, { orders: all.slice(0, limit).map(abSummary), limit, offset: 0, total: all.length, hasMore: all.length > limit });
      }
      const ab = /^\/vehicleDeregistrations\/orders\/([^/]+)$/.exec(path);
      if (req.method === 'GET' && ab) {
        const o = /^\d+$/.test(ab[1]) ? abOrders.get(Number(ab[1])) : undefined;
        if (!o) return error(res, 404, 'Vorgang unbekannt');
        return send(res, 200, { ...abSummary(o), attempt: 1, files: o.files, messages: o.messages, updatedAt: o.updatedAt, attempts: [{ id: o.id, attempt: 1, state: o.state, derivedStatus: o.derivedStatus, vehicleIdentificationNumber: o.fin }] });
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
  return { server, processes, mode, abOrders };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 3041);
  createFakeKfzApi().server.listen(port, '127.0.0.1', () => console.log(`Testnachbau kfz-api (Vollmacht, Außerbetriebsetzung) auf http://127.0.0.1:${port}/fake-api/10/2.3.0 – Login test/test`));
}
