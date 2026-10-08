import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkTransition, isTerminal, nextStatuses, statusLabel, transitionOptions, type TransitionContext } from '../src/lib/status.ts';

const ctx: TransitionContext = { service: 'halterwechsel', delivery: 'versand', checklistComplete: true, hasAssignedPlate: true };

describe('Status-Workflow', () => {
  it('folgt dem Hauptpfad', () => {
    const path = ['neu', 'in_pruefung', 'bei_zulassungsstelle', 'zugelassen', 'versendet', 'abgeschlossen'] as const;
    for (let i = 0; i < path.length - 1; i++) {
      assert.deepEqual(checkTransition(path[i], path[i + 1], ctx), { ok: true }, `${path[i]} → ${path[i + 1]}`);
    }
  });
  it('In Prüfung ↔ Unterlagen fehlen', () => {
    assert.equal(checkTransition('in_pruefung', 'unterlagen_fehlen', ctx).ok, true);
    assert.equal(checkTransition('unterlagen_fehlen', 'in_pruefung', ctx).ok, true);
    assert.equal(checkTransition('unterlagen_fehlen', 'bei_zulassungsstelle', ctx).ok, false);
  });
  it('verbietet Sprünge und Rückschritte', () => {
    assert.equal(checkTransition('neu', 'zugelassen', ctx).ok, false);
    assert.equal(checkTransition('abgeschlossen', 'neu', ctx).ok, false);
    assert.equal(checkTransition('zugelassen', 'in_pruefung', ctx).ok, false);
  });
  it('Storno nur bis einschließlich „Bei Zulassungsstelle“', () => {
    for (const s of ['neu', 'in_pruefung', 'unterlagen_fehlen', 'bei_zulassungsstelle'] as const) {
      assert.equal(checkTransition(s, 'storniert', ctx).ok, true, s);
    }
    assert.equal(checkTransition('zugelassen', 'storniert', ctx).ok, false);
    assert.ok(isTerminal('storniert'));
    assert.ok(isTerminal('abgeschlossen'));
    assert.deepEqual(nextStatuses('storniert'), []);
  });
  it('Einreichung erst mit vollständiger Checkliste', () => {
    const r = checkTransition('in_pruefung', 'bei_zulassungsstelle', { ...ctx, checklistComplete: false });
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.reason : '', /Checkliste/);
  });
  it('Zugelassen braucht ein Kennzeichen – außer bei der Abmeldung', () => {
    assert.equal(checkTransition('bei_zulassungsstelle', 'zugelassen', { ...ctx, hasAssignedPlate: false }).ok, false);
    assert.equal(checkTransition('bei_zulassungsstelle', 'zugelassen', { ...ctx, service: 'abmeldung', hasAssignedPlate: false }).ok, true);
  });
  it('Versendet oder Abgeholt passend zur Zustellart', () => {
    assert.equal(checkTransition('zugelassen', 'abgeholt', ctx).ok, false);
    assert.equal(checkTransition('zugelassen', 'abgeholt', { ...ctx, delivery: 'abholung' }).ok, true);
    const opts = transitionOptions('zugelassen', ctx).map((o) => o.to);
    assert.deepEqual(opts, ['versendet']);
  });
  it('Bezeichnung abhängig von Leistung und Zielgruppe', () => {
    assert.equal(statusLabel('zugelassen', 'abmeldung'), 'Abgemeldet');
    assert.equal(statusLabel('neu', 'neuzulassung', 'kunde'), 'Eingegangen');
    assert.equal(statusLabel('bei_zulassungsstelle'), 'Bei Zulassungsstelle');
  });
});
