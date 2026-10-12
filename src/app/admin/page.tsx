// EasyKFZ24 OS – Einstieg in den Verwaltungs-Desktop. Sitzung und Rechte werden serverseitig geprüft;
// der Desktop erhält nur Name, Rolle, Rechte und Sperrzeit – keine Geheimnisse.

import { OsShell } from '../../components/os/OsShell.tsx';
import { ROLE_LABEL, ROLE_PERMISSIONS } from '../../lib/permissions.ts';
import { requireAdmin } from '../../server/auth.ts';
import { getSettings } from '../../server/settings.ts';
import { getUserPrefs } from '../../server/os/notifications.ts';

export const metadata = { title: 'EasyKFZ24 OS' };
export const dynamic = 'force-dynamic';

export default async function AdminDesktop() {
  const user = await requireAdmin();
  const settings = await getSettings();
  const prefs = await getUserPrefs(user.id);
  return (
    <OsShell
      initialSession={{
        user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role, roleLabel: ROLE_LABEL[user.role] },
        permissions: [...ROLE_PERMISSIONS[user.role]],
        lockMinutes: settings.lockMinutes,
        prefs,
      }}
    />
  );
}
