// Endpunkte: Aufgabencenter und Kommunikationszentrale.

import { audit } from '../../audit.ts';
import { getDb } from '../../db.ts';
import { HttpError, int, ok, str, type Route } from '../http.ts';
import { deleteDraft, listMessages, listTemplates, prepareMessage, renderTemplate, resetTemplate, saveTemplate, sendMessage } from '../messages.ts';
import { addTaskComment, createTask, getTask, listTasks, teamOverview, updateTask } from '../tasks.ts';

export const teamRoutes: Route[] = [
  /* ---------- Aufgaben ---------- */
  {
    method: 'GET',
    path: 'tasks',
    handler: async (c) => {
      const p = c.url.searchParams;
      const scope = p.get('scope') === 'team' && c.can('tasks.team') ? 'team' : p.get('scope') === 'offen' && c.can('tasks.team') ? 'offen' : 'mine';
      const assignee = p.get('assignee');
      return {
        items: await listTasks({
          userId: c.actor.id,
          scope: scope === 'mine' ? 'mine' : 'team',
          assigneeId: scope === 'offen' ? null : scope === 'team' && assignee && /^\d+$/.test(assignee) ? Number(assignee) : undefined,
          status: str(p.get('status'), 20) || 'aktiv',
          orderId: p.get('order') ? int(p.get('order'), 'Auftrags-ID') : undefined,
          customerId: p.get('customer') ? int(p.get('customer'), 'Kunden-ID') : undefined,
        }),
        canTeam: c.can('tasks.team'),
      };
    },
  },
  { method: 'GET', path: 'tasks/team', perm: 'tasks.team', handler: async () => teamOverview() },
  {
    method: 'GET',
    path: 'tasks/:id',
    handler: async (c) => {
      const t = await getTask(int(c.params.id, 'Aufgaben-ID'));
      if (!t) throw new HttpError(404, 'Aufgabe nicht gefunden');
      if (!c.can('tasks.team') && t.task.assignee_id !== c.actor.id && t.task.assignee_id !== null) throw new HttpError(403, 'Aufgabe gehört einem anderen Mitarbeiter');
      return t;
    },
  },
  {
    method: 'POST',
    path: 'tasks',
    handler: async (c) => {
      const body = { ...c.body };
      // Ohne Team-Recht nur sich selbst oder niemandem zuweisen
      if (!c.can('tasks.team') && body.assignee_id !== null && body.assignee_id !== undefined && body.assignee_id !== c.actor.id) body.assignee_id = c.actor.id;
      const r = ok(await createTask(body, c.actor));
      await audit(c.audit, 'aufgabe.angelegt', String(r.id));
      return r;
    },
  },
  {
    method: 'POST',
    path: 'tasks/:id',
    handler: async (c) => {
      const id = int(c.params.id, 'Aufgaben-ID');
      const t = await getTask(id);
      if (!t) throw new HttpError(404, 'Aufgabe nicht gefunden');
      if (!c.can('tasks.team') && t.task.assignee_id !== c.actor.id && t.task.assignee_id !== null) throw new HttpError(403, 'Aufgabe gehört einem anderen Mitarbeiter');
      const patch = { ...c.body };
      if (!c.can('tasks.team') && 'assignee_id' in patch && patch.assignee_id !== c.actor.id && patch.assignee_id !== null) throw new HttpError(403, 'Zuweisen an andere nur mit Team-Recht');
      return ok(await updateTask(id, patch, c.actor));
    },
  },
  {
    method: 'POST',
    path: 'tasks/:id/comment',
    handler: async (c) => {
      const id = int(c.params.id, 'Aufgaben-ID');
      const t = await getTask(id);
      if (!t) throw new HttpError(404, 'Aufgabe nicht gefunden');
      if (!c.can('tasks.team') && t.task.assignee_id !== c.actor.id && t.task.assignee_id !== null) throw new HttpError(403, 'Aufgabe gehört einem anderen Mitarbeiter');
      return ok(await addTaskComment(id, str(c.body.text, 4000), c.actor.name));
    },
  },

  /* ---------- Kommunikation ---------- */
  {
    method: 'GET',
    path: 'messages',
    perm: 'orders.read',
    handler: async (c) => {
      const p = c.url.searchParams;
      return {
        ...(await listMessages({
          orderId: p.get('order') ? int(p.get('order'), 'Auftrags-ID') : undefined,
          customerId: p.get('customer') ? int(p.get('customer'), 'Kunden-ID') : undefined,
          state: str(p.get('state'), 20) || undefined,
        })),
        canSend: c.can('messages.send'),
      };
    },
  },
  { method: 'GET', path: 'messages/templates', perm: 'orders.read', handler: async () => listTemplates() },
  {
    method: 'POST',
    path: 'messages/templates',
    perm: 'messages.send',
    handler: async (c) => {
      const r = ok(await saveTemplate(c.body, c.actor.name));
      await audit(c.audit, 'vorlage.gespeichert', str(c.body.id, 40));
      return r;
    },
  },
  {
    method: 'POST',
    path: 'messages/templates/:id/reset',
    perm: 'messages.send',
    handler: async (c) => {
      await resetTemplate(str(c.params.id, 40));
      return { ok: true };
    },
  },
  {
    method: 'POST',
    path: 'messages/preview',
    perm: 'messages.send',
    handler: async (c) => {
      const t = (await listTemplates()).find((x) => x.id === str(c.body.templateId, 40));
      if (!t) throw new HttpError(404, 'Vorlage nicht gefunden');
      const r = await renderTemplate(t, int(c.body.orderId, 'Auftrags-ID'), { fehlende_unterlagen: str(c.body.missing, 1000) || '[Bitte Unterlagen eintragen]' });
      if (!r) throw new HttpError(404, 'Auftrag nicht gefunden');
      return r;
    },
  },
  {
    method: 'POST',
    path: 'messages/draft',
    perm: 'messages.send',
    handler: async (c) => {
      const id = await prepareMessage(int(c.body.orderId, 'Auftrags-ID'), str(c.body.templateId, 40), c.actor.name);
      if (!id) throw new HttpError(422, 'Entwurf konnte nicht erstellt werden (Vorlage oder E-Mail-Adresse fehlt)');
      return { ok: true, id };
    },
  },
  {
    method: 'POST',
    path: 'messages/send',
    perm: 'messages.send',
    handler: async (c) => {
      const r = await sendMessage(
        {
          orderId: Number(c.body.orderId),
          to: str(c.body.to, 160),
          subject: str(c.body.subject, 200),
          body: str(c.body.body, 20_000),
          templateId: str(c.body.templateId, 40),
          draftId: c.body.draftId ? Number(c.body.draftId) : null,
        },
        c.actor.name,
      );
      await audit(c.audit, r.ok ? 'nachricht.versendet' : 'nachricht.fehler', String(c.body.orderId), str(c.body.subject, 120));
      return ok(r);
    },
  },
  {
    method: 'POST',
    path: 'messages/:id/discard',
    perm: 'messages.send',
    handler: async (c) => ok(await deleteDraft(int(c.params.id, 'Nachrichten-ID'))),
  },
  {
    method: 'GET',
    path: 'messages/:id',
    perm: 'orders.read',
    handler: async (c) => {
      const m = await (await getDb()).first('SELECT m.*, o.number FROM messages m LEFT JOIN orders o ON o.id = m.order_id WHERE m.id = ?', int(c.params.id, 'Nachrichten-ID'));
      if (!m) throw new HttpError(404, 'Nachricht nicht gefunden');
      return m;
    },
  },
];
