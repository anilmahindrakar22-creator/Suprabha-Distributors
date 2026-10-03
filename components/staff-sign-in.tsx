'use client';
import { useRef, useState } from 'react';

export function StaffAccountSwitch() {
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  async function signOut() {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch('/api/staff-auth', { method: 'DELETE', cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Sign out failed');
      window.location.assign('/staff-signin');
    } catch { setMessage('Unable to sign out. Please retry.'); }
    finally { inFlight.current = false; }
  }
  return <><button onClick={signOut} className="mt-7 min-h-11 rounded-xl border px-5 font-semibold">Use another account</button>{message && <p role="alert">{message}</p>}</>;
}

export function StaffSignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/staff-auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }), cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Unable to sign in. Check your details or contact your administrator.');
      window.location.assign('/');
    } catch { setMessage('Unable to sign in. Check your details or contact your administrator.'); }
    finally { inFlight.current = false; setPassword(''); setBusy(false); }
  }
  return <main className="grid min-h-dvh place-items-center bg-[#f7f6f1] p-5"><form onSubmit={submit} className="grid w-full max-w-md gap-4 rounded-2xl border bg-white p-6 text-[#173239]"><h1 className="text-2xl font-bold">Staff sign in</h1><p>Use your approved company account. No ChatGPT app is required.</p><label>Email<input required type="email" autoComplete="username" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl border px-3" /></label><label>Password<input required type="password" autoComplete="current-password" maxLength={1024} value={password} onChange={e => setPassword(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl border px-3" /></label><button disabled={busy} className="min-h-11 rounded-xl bg-[#092f36] font-bold text-white disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in'}</button>{message && <p role="alert">{message}</p>}<p className="text-sm">Forgot your password? Contact your administrator.</p></form></main>;
}
