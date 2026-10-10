'use client';
import { useEffect, useRef, useState } from 'react';
import { preconnect } from 'react-dom';
import { resumeStaffSession, withStaffSessionLock } from '@/lib/staff-session-client';

export function StaffSessionUnavailable() {
  return <main className="grid min-h-dvh place-items-center p-5"><section className="grid max-w-md gap-4"><h1 className="text-2xl font-bold">Connection interrupted</h1><p>We could not verify your sign-in. This does not mean you have signed out. Reconnect and retry; your saved drafts remain unchanged.</p><button className="min-h-11 rounded-xl border px-5 font-semibold" onClick={() => window.location.reload()}>Retry connection</button></section></main>;
}

export function StaffAccountSwitch() {
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  async function signOut() {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await withStaffSessionLock(() => fetch('/api/staff-auth', { method: 'DELETE', cache: 'no-store', signal: AbortSignal.timeout(15000) }));
      if (!response.ok) throw new Error('Sign out failed');
      window.location.assign('/staff-signin');
    } catch { setMessage('Unable to sign out. Please retry.'); }
    finally { inFlight.current = false; }
  }
  return <><button onClick={signOut} className="mt-7 min-h-11 rounded-xl border px-5 font-semibold">Use another account</button>{message && <p role="alert">{message}</p>}</>;
}

export function StaffSignIn({ chatGPTSignInUrl = null, resume = false }: { chatGPTSignInUrl?: string | null; resume?: boolean } = {}) {
  const [handoff, setHandoff] = useState<'idle' | 'opening' | 'stalled'>('idle');
  const handoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (handoffTimer.current) clearTimeout(handoffTimer.current); }, []);
  function warmChatGPT() {
    if (!chatGPTSignInUrl) return;
    preconnect(new URL(chatGPTSignInUrl).origin);
    preconnect('https://auth.openai.com');
  }
  function startChatGPT(event: React.MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (handoff === 'opening') { event.preventDefault(); return; }
    warmChatGPT();
    setHandoff('opening');
    if (handoffTimer.current) clearTimeout(handoffTimer.current);
    handoffTimer.current = setTimeout(() => setHandoff('stalled'), 8000);
  }
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(resume);
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  useEffect(() => {
    if (!resume) return;
    let cancelled = false;
    inFlight.current = true;
    const timer = setTimeout(() => setBusy(true), 0);
    void resumeStaffSession().then(restored => {
      if (!cancelled && restored) window.location.assign('/');
      if (!cancelled && !restored) setRestoring(false);
    }).catch(() => {
      if (!cancelled) {
        setRestoring(false);
        setMessage('Unable to restore your sign-in right now. Reconnect and reopen the app, or sign in below. Your drafts remain unchanged.');
      }
    }).finally(() => {
      if (!cancelled) { inFlight.current = false; setBusy(false); }
    });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [resume]);
  if (restoring) return <main className="grid min-h-dvh place-items-center bg-[#f7f6f1] p-5 text-[#173239]"><output aria-live="polite">Opening StockFlow…</output></main>;
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage('');
    try {
      const response = await withStaffSessionLock(() => fetch('/api/staff-auth', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }), cache: 'no-store', signal: AbortSignal.timeout(15000) }));
      if (!response.ok) throw new Error('Unable to sign in. Check your details or contact your administrator.');
      const confirmation = await fetch('/api/staff-auth', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const confirmed: unknown = confirmation.ok ? await confirmation.json() : null;
      if (!confirmed || typeof confirmed !== 'object' || !('ok' in confirmed) || confirmed.ok !== true) {
        setMessage('Your password was accepted, but this app could not verify the sign-in session. Please open the staff site in Chrome and contact your administrator if this continues.');
        return;
      }
      window.location.assign('/');
    } catch { setMessage('Unable to sign in. Check your details or contact your administrator.'); }
    finally { inFlight.current = false; setPassword(''); setBusy(false); }
  }
  return <main className="grid min-h-dvh place-items-center bg-[#f7f6f1] p-5"><form onSubmit={submit} className="grid w-full max-w-md gap-4 rounded-2xl border bg-white p-6 text-[#173239]"><h1 className="text-2xl font-bold">Staff sign in</h1><p>Use your approved company email and password for direct staff access. No ChatGPT app is required.</p><label>Email<input required type="email" autoComplete="username" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl border px-3" /></label><label>Password<input required type="password" autoComplete="current-password" maxLength={1024} value={password} onChange={e => setPassword(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl border px-3" /></label><button disabled={busy} className="min-h-11 rounded-xl bg-[#092f36] font-bold text-white disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in'}</button>{message && <p role="alert">{message}</p>}<p className="text-sm">Forgot your password? Contact your administrator.</p>{chatGPTSignInUrl && <><p className="text-center text-sm">Legacy site</p><a href={chatGPTSignInUrl} target="_top" onPointerEnter={warmChatGPT} onFocus={warmChatGPT} onClick={startChatGPT} aria-disabled={handoff === 'opening'} className="flex min-h-11 items-center justify-center rounded-xl border px-3 font-semibold">{handoff === 'opening' ? 'Opening ChatGPT…' : 'Sign in with ChatGPT'}</a><p className="text-sm">Opens the older StockFlow site. It does not sign you into this staff site.</p><output aria-live="polite">{handoff === 'opening' ? 'Connecting to OpenAI. Your staff email and password are not sent.' : handoff === 'stalled' ? 'Still here? Use staff email and password above, or retry the ChatGPT link. OpenAI sign-in may be delayed.' : ''}</output></>}</form></main>;
}
