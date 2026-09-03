import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

const MIN_PASSWORD_LENGTH = 8;

export function CreatePasswordForm() {
  const { session, setPassword } = useAuth();
  const [password, setPasswordValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setError(null);
    setBusy(true);
    const { error } = await setPassword(password);
    setBusy(false);
    if (error) setError(error);
  }

  return (
    <div className="page auth-page">
      <h1>Create Your Password</h1>
      <p className="text-muted">
        {session?.user.email ? `Welcome, ${session.user.email}. ` : ''}
        You've been invited to the Auction Results Dashboard. Choose a password to finish
        setting up your account.
      </p>
      <form className="auth-page__form" onSubmit={handleSubmit}>
        <label>
          <span>New Password</span>
          <input
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPasswordValue(e.target.value)}
          />
        </label>
        <label>
          <span>Confirm Password</span>
          <input
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error && <div className="banner banner--error">{error}</div>}
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save Password & Continue'}
        </button>
      </form>
    </div>
  );
}
