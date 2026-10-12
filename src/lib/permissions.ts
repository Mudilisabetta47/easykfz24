// Rollen und Berechtigungen der Verwaltung (EasyKFZ24 OS). Jede geschützte Aktion prüft serverseitig eine Berechtigung.

export const PERMISSIONS = [
  'orders.read',
  'orders.write',
  'customers.read',
  'customers.write',
  'docs.read',
  'docs.write',
  'kfz.read',
  'kfz.write',
  'finance.read',
  'finance.write',
  'tasks.team',
  'messages.send',
  'automation.manage',
  'users.manage',
  'settings.manage',
  'audit.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABEL: Record<Permission, string> = {
  'orders.read': 'Aufträge ansehen',
  'orders.write': 'Aufträge bearbeiten (Status, Checkliste, Notizen, Versand)',
  'customers.read': 'Kunden ansehen',
  'customers.write': 'Kunden anlegen, bearbeiten, zusammenführen',
  'docs.read': 'Dokumente öffnen',
  'docs.write': 'Dokumente hochladen, umbenennen, prüfen, löschen',
  'kfz.read': 'KFZ-API-Center ansehen',
  'kfz.write': 'KFZ-API: Ereignisse zuordnen, Tests ausführen',
  'finance.read': 'Finanzcenter ansehen',
  'finance.write': 'Zahlungen, Rechnungen, Preise und Kosten bearbeiten',
  'tasks.team': 'Aufgaben des gesamten Teams sehen und zuweisen',
  'messages.send': 'Kunden-E-Mails versenden und Vorlagen pflegen',
  'automation.manage': 'Automatisierungen einstellen',
  'users.manage': 'Benutzer und Rollen verwalten',
  'settings.manage': 'Systemeinstellungen ändern',
  'audit.read': 'Protokoll einsehen',
};

export const ROLES = ['inhaber', 'verwaltung', 'sachbearbeitung', 'buchhaltung', 'lesen'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  inhaber: 'Inhaber',
  verwaltung: 'Verwaltung',
  sachbearbeitung: 'Sachbearbeitung',
  buchhaltung: 'Buchhaltung',
  lesen: 'Nur lesen',
};

const ALL = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  inhaber: ALL,
  verwaltung: ALL.filter((p) => p !== 'users.manage'),
  sachbearbeitung: ['orders.read', 'orders.write', 'customers.read', 'customers.write', 'docs.read', 'docs.write', 'kfz.read', 'kfz.write', 'messages.send'],
  buchhaltung: ['orders.read', 'customers.read', 'finance.read', 'finance.write'],
  lesen: ['orders.read', 'customers.read', 'kfz.read'],
};

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Benutzername: 3–32 Zeichen, Kleinbuchstaben, Ziffern, Punkt, Bindestrich, Unterstrich. */
export function checkUsername(v: string): string | null {
  return /^[a-z0-9._-]{3,32}$/.test(v) ? null : 'Benutzername: 3–32 Zeichen, nur a–z, 0–9, Punkt, Bindestrich, Unterstrich';
}

/** Mindestanforderung an Passwörter der Verwaltung. */
export function checkPasswordStrength(pw: string): string | null {
  if (pw.length < 12) return 'Passwort: mindestens 12 Zeichen';
  if (pw.length > 200) return 'Passwort: höchstens 200 Zeichen';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes < 3) return 'Passwort: mindestens drei von Kleinbuchstaben, Großbuchstaben, Ziffern, Sonderzeichen';
  return null;
}
