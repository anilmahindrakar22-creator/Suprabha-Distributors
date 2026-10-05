'use client';
import { useEffect, useRef, useState } from 'react';

export function StaffPasswordReset() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const capturedToken = useRef<string | null>(null);
  const capturedError = useRef('');
  const inFlight = useRef(false);
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const linkType = fragment.get('type');
    if (capturedToken.current === null) {
      capturedToken.current = linkType === 'recovery' || linkType === 'invite' ? fragment.get('access_token') || '' : '';
      const query = new URLSearchParams(window.location.search);
      const errorCode = fragment.get('error_code') || query.get('error_code');
      capturedError.current = errorCode === 'otp_expired'
        ? 'This recovery link has expired or was already used. Ask your administrator for a fresh email and open only the newest link.'
        : 'Recovery link is missing. Open the Reset password button in your latest email, not a saved or copied page address.';
    }
    const accessToken = capturedToken.current;
    // Invitation and recovery bearers use the same server verification and membership checks.
    // Keep the bearer in memory only; remove it from history immediately.
    window.history.replaceState(null, '', '/staff-password-reset');
    const timer = window.setTimeout(() => {
      setToken(accessToken);
      if (accessToken) setMessage('Complete your password setup now. This link is single-use; closing or reloading this page requires a new email.');
      if (!accessToken) setMessage(capturedError.current);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault(); if (!token || inFlight.current) return;
    if (password !== confirmation) { setMessage('Passwords must match.'); return; }
    inFlight.current = true; setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/staff-password-reset', { method: 'PUT', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        // An upstream failure may occur after the password was already changed.
        // Consume this in-memory recovery attempt instead of silently repeating it.
        if (response.status >= 500 || response.status === 401) { setToken(''); capturedToken.current = ''; }
        setMessage(result.error || 'Reset could not be completed.'); return;
      }
      setToken(''); window.location.assign('/staff-signin');
    } catch {
      setToken(''); capturedToken.current = '';
      setMessage('Reset outcome is unknown. Contact your administrator before retrying.');
    }
    finally { inFlight.current = false; setPassword(''); setConfirmation(''); setBusy(false); }
  }
  return <main className="grid min-h-dvh place-items-center bg-[#f7f6f1] p-5"><form onSubmit={submit} className="grid w-full max-w-md gap-4 rounded-2xl border bg-white p-6"><h1 className="text-2xl font-bold">Set your staff password</h1><label>New password<input required minLength={12} maxLength={1024} type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl border px-3" /></label><label>Confirm password<input required minLength={12} maxLength={1024} type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl border px-3" /></label><button disabled={busy || !token} className="min-h-11 rounded-xl bg-[#092f36] font-bold text-white disabled:opacity-50">{busy ? 'Updating…' : 'Set password'}</button>{message && <p role="alert">{message}</p>}</form></main>;
}
