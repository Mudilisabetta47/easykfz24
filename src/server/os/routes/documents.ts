// Endpunkte: Dokumentenmanager (Upload als multipart, alles andere JSON).

import { audit } from '../../audit.ts';
import { accessLog, createFolder, DOC_CATEGORIES, folderTree, listDocs, purgeDoc, REVIEW_STATES, setDocFlag, updateDoc, uploadDoc, versions } from '../documents.ts';
import { HttpError, int, ok, str, type Route } from '../http.ts';

const view = (v: string | null) => (v === 'archiv' || v === 'papierkorb' ? v : 'aktiv');
const docId = (v: string) => {
  if (!/^[a-f0-9]{32}$/.test(v)) throw new HttpError(400, 'Ungültige Dokument-ID');
  return v;
};

export const documentRoutes: Route[] = [
  {
    method: 'GET',
    path: 'documents',
    perm: 'docs.read',
    handler: async (c) => {
      const p = c.url.searchParams;
      return {
        ...(await folderTree({ q: str(p.get('q'), 100), view: view(p.get('view')) })),
        categories: DOC_CATEGORIES,
        reviewStates: REVIEW_STATES,
        canWrite: c.can('docs.write'),
        canPurge: c.can('settings.manage'),
        apiAccess: !!process.env.KFZ_API_LOGIN,
      };
    },
  },
  {
    method: 'GET',
    path: 'documents/files',
    perm: 'docs.read',
    handler: async (c) => {
      const p = c.url.searchParams;
      return listDocs({
        orderId: p.get('order') ? int(p.get('order'), 'Auftrags-ID') : undefined,
        customerId: p.get('customer') ? int(p.get('customer'), 'Kunden-ID') : undefined,
        view: view(p.get('view')),
        q: str(p.get('q'), 100),
        category: str(p.get('category'), 40) || undefined,
        expiring: p.get('expiring') === '1',
      });
    },
  },
  { method: 'GET', path: 'documents/log', perm: 'audit.read', handler: async () => accessLog({}) },
  { method: 'GET', path: 'documents/:id/versions', perm: 'docs.read', handler: async (c) => versions(docId(c.params.id)) },
  { method: 'GET', path: 'documents/:id/log', perm: 'docs.read', handler: async (c) => accessLog({ docId: docId(c.params.id) }) },
  {
    method: 'POST',
    path: 'documents/upload',
    perm: 'docs.write',
    raw: true,
    handler: async (c) => {
      let form: FormData;
      try {
        form = await c.req.formData();
      } catch {
        throw new HttpError(400, 'Upload konnte nicht gelesen werden');
      }
      const orderId = int(form.get('orderId'), 'Auftrags-ID');
      const files = form.getAll('file').filter((f): f is File => typeof f !== 'string');
      if (!files.length) throw new HttpError(400, 'Keine Datei');
      if (files.length > 20) throw new HttpError(400, 'Höchstens 20 Dateien je Upload');
      const results: { name: string; ok: boolean; id?: string; error?: string }[] = [];
      for (const f of files) {
        const r = await uploadDoc(
          {
            orderId,
            name: f.name || 'datei',
            bytes: new Uint8Array(await f.arrayBuffer()),
            kind: str(form.get('kind'), 20),
            category: str(form.get('category'), 40),
            folder: str(form.get('folder'), 160),
            replaces: str(form.get('replaces'), 40) || undefined,
            expiresAt: str(form.get('expiresAt'), 30) || undefined,
          },
          c.actor.name,
        );
        results.push(r.ok ? { name: f.name, ok: true, id: r.id } : { name: f.name, ok: false, error: r.error });
        if (r.ok) await audit(c.audit, 'dokument.hochgeladen', `Auftrag ${orderId}`, `${r.id} ${f.name.slice(0, 80)}`);
      }
      return { results };
    },
  },
  {
    method: 'POST',
    path: 'documents/folder',
    perm: 'docs.write',
    handler: async (c) => ok(await createFolder(int(c.body.orderId, 'Auftrags-ID'), str(c.body.path, 160))),
  },
  {
    method: 'POST',
    path: 'documents/:id',
    perm: 'docs.write',
    handler: async (c) => {
      const id = docId(c.params.id);
      const b = c.body;
      const patch: Parameters<typeof updateDoc>[1] = {};
      for (const k of ['display_name', 'category', 'folder', 'expires_at', 'review_state', 'review_note', 'kind'] as const) if (typeof b[k] === 'string') patch[k] = str(b[k], 500);
      return ok(await updateDoc(id, patch, c.actor.name));
    },
  },
  {
    method: 'POST',
    path: 'documents/:id/:action',
    perm: 'docs.write',
    handler: async (c) => {
      const id = docId(c.params.id);
      const action = c.params.action;
      if (action === 'purge') {
        c.need('settings.manage');
        const r = ok(await purgeDoc(id));
        await audit(c.audit, 'dokument.endgueltig_geloescht', '', id);
        return r;
      }
      if (action !== 'delete' && action !== 'restore' && action !== 'archive' && action !== 'unarchive') throw new HttpError(404, 'Unbekannte Aktion');
      const r = ok(await setDocFlag(id, action, c.actor.name));
      if (action === 'delete') await audit(c.audit, 'dokument.geloescht', '', id);
      return r;
    },
  },
];
