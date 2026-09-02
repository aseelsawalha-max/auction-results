import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

export function AdminLogin() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) setError(error);
  }

  return (
    <div className="page admin-login">
      <h1>Admin Sign In</h1>
      <p className="text-muted">
        Authorized administrators only. This account can upload LockerFox exports and update
        auction records. Everyone else should use the read-only dashboard.
      </p>
      <form className="admin-login__form" onSubmit={handleSubmit}>
        <label>
          <span>Email</span>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <div className="banner banner--error">{error}</div>}
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
