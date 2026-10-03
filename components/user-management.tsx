'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { stockFlowRoles } from '@/lib/user-types';

type Member = { id: number; email: string; role: string; status: string; updatedAt: string };

async function read<T>(response: Response): Promise<T> {
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error || 'Request failed');
  return value;
}

export function UserManagement({ staffAuth = false }: { staffAuth?: boolean }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  const [invitationUncertain, setInvitationUncertain] = useState(false);
  async function requestInvitation(email: string) {
    try {
      const result = await read<{ message: string }>(await fetch('/api/staff-invitation', { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }));
      return result.message;
    } catch (error) {
      setInvitationUncertain(true);
      throw new Error(error instanceof Error ? error.message : 'Invitation outcome is unknown. Check the staff account before retrying');
    }
  }
  async function inviteUser(email: string) {
    if (inFlight.current || invitationUncertain) return;
    inFlight.current = true; setBusy(true); setMessage('');
    try { setMessage(await requestInvitation(email)); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Invitation not confirmed'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function resetPassword(email: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setMessage('');
    try {
      const result = await read<{ message: string }>(await fetch('/api/staff-password-reset', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }));
      setMessage(result.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Recovery request failed'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const load = useCallback(async () => {
    try { setMembers((await read<{ users: Member[] }>(await fetch('/api/users', { cache: 'no-store' }))).users); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to load users'); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function saveUser(nextEmail: string, nextRole: string, status: string, invite = false) {
    if (inFlight.current || (invite && invitationUncertain)) return;
    inFlight.current = true;
    setBusy(true); setMessage('');
    try {
      await read(await fetch('/api/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), email: nextEmail, role: nextRole, status }) }));
      setEmail(''); setMessage('User access updated.'); await load();
      if (invite) {
        try { setMessage(`User access saved. ${await requestInvitation(nextEmail)}`); }
        catch (error) { setMessage(`User access saved. ${error instanceof Error ? error.message : 'Invitation not confirmed'}`); }
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to update user'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <div className="h-full overflow-y-auto"><div className="mx-auto max-w-5xl p-5 sm:p-8"><p className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#277b69]">Administration</p><h1 className="mt-1 text-3xl font-black text-[#092f36]">Users</h1><p className="mt-2 text-sm text-[#64787b]">Approve company accounts, assign responsibilities, or suspend access.</p>
    <form onSubmit={(event) => { event.preventDefault(); void saveUser(email, role, 'active', staffAuth); }} className="mt-6 grid gap-3 rounded-2xl border border-[#dce7e5] bg-white p-5 sm:grid-cols-[1fr_190px_auto] sm:items-end"><label className="text-sm font-bold text-[#456367]">Email<input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] px-3 font-normal" /></label><label className="text-sm font-bold text-[#456367]">Role<select value={role} onChange={(event) => setRole(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] bg-white px-3 font-normal">{stockFlowRoles.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label><button disabled={busy || (staffAuth && invitationUncertain)} className="min-h-11 rounded-xl bg-[#092f36] px-5 font-bold text-white disabled:opacity-50">{staffAuth ? 'Add and invite' : 'Add user'}</button></form>
    {staffAuth && <section className="mt-4 rounded-xl border bg-white p-4"><h2 className="font-bold">Staff login</h2><p className="my-3 text-sm">Invite new staff or resend a pending invitation. Existing password users need a reset link. Staff choose their own passwords.</p>{invitationUncertain && <p role="alert" className="my-3 text-sm">Invitation not confirmed. Check the staff account before reloading to retry; do not add the user again.</p>}{members.filter(member => member.status === 'active').map(member => <div key={member.id} className="mb-3"><p className="break-all text-sm">{member.email}</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy || invitationUncertain} onClick={() => void inviteUser(member.email)} className="min-h-11 rounded-lg border px-3">Invite / resend to {member.email}</button><button type="button" disabled={busy} onClick={() => void resetPassword(member.email)} className="min-h-11 rounded-lg border px-3">Send reset link to {member.email}</button></div></div>)}</section>}
    {message ? <output className="mt-4 block rounded-xl bg-[#edf7f3] px-4 py-3 text-sm text-[#31585d]">{message}</output> : null}
    <div className="mt-6 overflow-hidden rounded-2xl border border-[#dce7e5] bg-white"><div className="divide-y divide-[#e8efed]">{members.map((member) => <div key={member.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_180px_130px] sm:items-center"><div><strong className="text-[#173239]">{member.email}</strong><p className="mt-1 text-xs capitalize text-[#718487]">{member.status}</p></div><select aria-label={`Role for ${member.email}`} value={member.role} disabled={busy} onChange={(event) => void saveUser(member.email, event.target.value, member.status)} className="min-h-10 rounded-xl border border-[#cedfdd] bg-white px-3 capitalize">{stockFlowRoles.map((item) => <option key={item} value={item}>{item}</option>)}</select><button type="button" disabled={busy} onClick={() => void saveUser(member.email, member.role, member.status === 'active' ? 'suspended' : 'active')} className="min-h-10 rounded-xl border border-[#cedfdd] px-3 font-bold text-[#456367]">{member.status === 'active' ? 'Suspend' : 'Activate'}</button></div>)}</div></div>
  </div></div>;
}
