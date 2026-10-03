'use client';
import { useEffect, useRef, useState } from 'react';

export function StaffPasswordReset() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const capturedToken = useRef<string | null>(null);
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    if (capturedToken.current === null) capturedToken.current = fragment.get('type') === 'recovery' ? fragment.get('access_token') || '' : '';
    const accessToken = capturedToken.current;
    // Keep the recovery bearer in memory only; remove it from history immediately.
    window.history.replaceState(null, '', '/staff-password-reset');
    const timer = window.setTimeout(() => {
      setToken(accessToken);
      if (!accessToken) setMessage('Recovery link is missing or expired. Ask your administrator for a new link.');
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault(); if (password !== confirmation) { setMessage('Passwords must match.'); return; }
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/staff-password-reset', { method: 'PUT', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) { setMessage(result.error || 'Reset could not be completed.'); return; }
      setToken(''); window.location.assign('/staff-signin');
    } catch { setMessage('Reset outcome is unknown. Contact your administrator before retrying.'); }
    finally { setPassword(''); setConfirmation(''); setBusy(false); }
  }
  return <main className="grid min-h-dvh place-items-center bg-[#f7f6f1] p-5"><form onSubmit={submit} className="grid w-full max-w-md gap-4 rounded-2xl border bg-white p-6"><h1 className="text-2xl font-bold">Set your staff password</h1><label>New password<input required minLength={12} maxLength={1024} type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl border px-3" /></label><label>Confirm password<input required minLength={12} maxLength={1024} type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl border px-3" /></label><button disabled={busy || !token} className="min-h-11 rounded-xl bg-[#092f36] font-bold text-white disabled:opacity-50">{busy ? 'Updating…' : 'Set password'}</button>{message && <p role="alert">{message}</p>}</form></main>;
}
