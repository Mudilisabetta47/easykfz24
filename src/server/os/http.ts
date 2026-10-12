// Gemeinsame Bausteine der OS-Schnittstelle: Routen mit Pflicht-Berechtigung, Parameter, Fehler.

import { can, PERMISSION_LABEL, type Permission } from '../../lib/permissions.ts';
import type { Session } from '../auth.ts';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Json = Record<string, unknown>;

export interface Ctx {
  s: Session;
  actor: { id: number; name: string };
  audit: { id: number; username: string };
  params: Record<string, string>;
  url: URL;
  body: Json;
  req: Request;
  can: (p: Permission) => boolean;
  need: (p: Permission) => void;
  /** Vom Handler setzen, wenn er eine neue Sitzung gestartet hat – der Router verlängert dann nicht die alte. */
  sessionReplaced: boolean;
}

export interface Route {
  method: 'GET' | 'POST';
  /** z. B. 'orders/:id/action' */
  path: string;
  /** Mindestens eines dieser Rechte (leer = jeder angemeldete Benutzer) */
  perm?: Permission | Permission[];
  /** Rumpf nicht als JSON lesen (z. B. Datei-Upload als multipart) */
  raw?: boolean;
  handler: (c: Ctx) => Promise<unknown>;
}

const paramCount = (r: Route) => r.path.split('/').filter((p) => p.startsWith(':')).length;

/** Feste Pfadteile gehen vor Platzhaltern (z. B. customers/merge vor customers/:id). */
export function matchRoute(routes: Route[], method: string, segs: string[]): { route: Route; params: Record<string, string> } | null {
  const sorted = [...routes].sort((a, b) => paramCount(a) - paramCount(b));
  for (const route of sorted) {
    if (route.method !== method) continue;
    const parts = route.path.split('/');
    if (parts.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(':')) params[parts[i].slice(1)] = decodeURIComponent(segs[i]);
      else if (parts[i] !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

export function checkPerm(s: Session, perm: Route['perm']): void {
  if (!perm) return;
  const list = Array.isArray(perm) ? perm : [perm];
  if (!list.some((p) => can(s.user.role, p))) throw new HttpError(403, `Keine Berechtigung: ${list.map((p) => PERMISSION_LABEL[p]).join(' oder ')}`);
}

export const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '');

export function int(v: unknown, label = 'ID'): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Ungültige ${label}`);
  return n;
}

export function optInt(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new HttpError(400, 'Ungültige Zahl');
  return n;
}

/** Ergebnis einer Fachfunktion in eine Antwort umsetzen (Fehler → 422). */
export function ok<T extends object>(r: ({ ok: true } & T) | { ok: false; error: string }): { ok: true } & T {
  if (!r.ok) throw new HttpError(422, r.error);
  return r;
}
