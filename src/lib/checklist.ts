// Unterlagen-Checkliste für die Sachbearbeitung, abgeleitet aus Leistung und Auftragsdaten.

import { DOCUMENTS, documentsFor, isEvbRequired, isPlateChange, SERVICES, type PlateChoice, type ServiceId } from './services.ts';

export interface ChecklistItem {
  key: string;
  label: string;
  required: boolean;
}

export type ChecklistState = Record<string, { checked: boolean; at: string }>;

export function buildChecklist(service: ServiceId, plateChoice: PlateChoice | null): ChecklistItem[] {
  const def = SERVICES[service];
  const items: ChecklistItem[] = documentsFor(service).map((d) => ({
    key: `dok_${d.kind}`,
    label: `${DOCUMENTS[d.kind].short} geprüft (Upload lesbar und vollständig)`,
    required: d.requirement === 'pflicht',
  }));

  if (isEvbRequired(service, plateChoice)) items.push({ key: 'evb', label: 'eVB-Nummer gültig', required: true });
  if (def.sepa) items.push({ key: 'sepa', label: 'SEPA-Mandat Kfz-Steuer vollständig', required: true });

  items.push({ key: 'vollmacht_original', label: 'Vollmacht im Original eingegangen', required: true });

  if (def.documents.zb1) items.push({ key: 'zb1_original', label: 'ZB I im Original eingegangen', required: true });
  const zb2Original = def.documents.zb2 === 'pflicht' || (def.documents.zb2 && isPlateChange(service, plateChoice));
  if (zb2Original) items.push({ key: 'zb2_original', label: 'ZB II im Original eingegangen', required: true });
  if (def.documents.coc) items.push({ key: 'coc_original', label: 'COC-Papier im Original eingegangen', required: true });

  const oldPlates = service === 'abmeldung' || ((service === 'halterwechsel' || service === 'umzug') && isPlateChange(service, plateChoice));
  if (oldPlates) items.push({ key: 'schilder_alt', label: 'Alte Kennzeichenschilder eingegangen', required: true });

  return items;
}

export function isChecklistComplete(items: ChecklistItem[], state: ChecklistState): boolean {
  return items.every((i) => !i.required || state[i.key]?.checked === true);
}

export function checklistProgress(items: ChecklistItem[], state: ChecklistState): { done: number; total: number } {
  return { done: items.filter((i) => state[i.key]?.checked).length, total: items.length };
}
