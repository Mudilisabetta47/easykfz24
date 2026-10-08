import { redirect } from 'next/navigation';
import { LogoMark } from '../../../components/Logo.tsx';
import { adminConfig, isAdmin } from '../../../server/auth.ts';
import { LoginForm } from './LoginForm.tsx';

export const metadata = { title: 'Anmeldung' };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await isAdmin()) redirect('/admin');
  const cfg = adminConfig();
  return (
    <main className="admin-login">
      <div className="card admin-login__card">
        <LogoMark className="admin-login__mark" />
        <h1>Verwaltung</h1>
        <p className="muted">Bitte melden Sie sich mit dem Admin-Passwort an.</p>
        {cfg.ok ? (
          <LoginForm />
        ) : (
          <p className="alert alert--error" role="alert">
            Anmeldung nicht möglich: {cfg.problem} Bitte in der .env setzen (siehe .env.example).
          </p>
        )}
      </div>
    </main>
  );
}
