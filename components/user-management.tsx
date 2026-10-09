'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { stockFlowRoles } from '@/lib/user-types';

type Member = { id: number; email: string; role: string; roles?: string[]; status: string; updatedAt: string };

function normalizedRoles(selected: string[], primaryRole?: string) {
  const selectedSet = new Set(selected);
  const roles = stockFlowRoles.filter((item) => selectedSet.has(item));
  if (roles.length === 0) return [];
  const primary = primaryRole && roles.some((item) => item === primaryRole) ? primaryRole : roles[0];
  return [primary, ...roles.filter((item) => item !== primary)];
}

async function read<T>(response: Response): Promise<T> {
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error || 'Request failed');
  return value;
}

export function UserManagement({ staffAuth = false, emailActionsEnabled = false }: { staffAuth?: boolean; emailActionsEnabled?: boolean }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<string[]>(['viewer']);
  const [roleDrafts, setRoleDrafts] = useState<Record<number, string[]>>({});
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
    if (!staffAuth || !emailActionsEnabled || inFlight.current || invitationUncertain) return;
    inFlight.current = true; setBusy(true); setMessage('');
    try { setMessage(await requestInvitation(email)); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Invitation not confirmed'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function resetPassword(email: string) {
    if (!staffAuth || !emailActionsEnabled || inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setMessage('');
    try {
      const result = await read<{ message: string }>(await fetch('/api/staff-password-reset', { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }));
      setMessage(result.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Recovery request failed'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const load = useCallback(async () => {
    try {
      const users = (await read<{ users: Member[] }>(await fetch('/api/users', { cache: 'no-store' }))).users;
      setMembers(users);
      setRoleDrafts(Object.fromEntries(users.map((member) => [member.id, normalizedRoles(member.roles?.length ? member.roles : [member.role], member.role)])));
    }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to load users'); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function saveUser(nextEmail: string, selectedRoles: string[], status: string, invite = false, existing?: Member) {
    const shouldInvite = invite && staffAuth && emailActionsEnabled;
    if (inFlight.current || (shouldInvite && invitationUncertain)) return;
    const nextRoles = normalizedRoles(selectedRoles, existing?.role);
    if (nextRoles.length === 0) { setMessage('Select at least one role.'); return; }
    inFlight.current = true;
    setBusy(true); setMessage('');
    try {
      await read(await fetch('/api/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), email: nextEmail, role: nextRoles[0], roles: nextRoles, status, ...(existing ? { expectedUpdatedAt: existing.updatedAt } : {}) }) }));
      setEmail(''); setMessage('User access updated.'); await load();
      if (shouldInvite) {
        try { setMessage(`User access saved. ${await requestInvitation(nextEmail)}`); }
        catch (error) { setMessage(`User access saved. ${error instanceof Error ? error.message : 'Invitation not confirmed'}`); }
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to update user'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <div className="h-full overflow-y-auto"><div className="mx-auto max-w-5xl p-5 sm:p-8"><p className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#277b69]">Administration</p><h1 className="mt-1 text-3xl font-black text-[#092f36]">Users</h1><p className="mt-2 text-sm text-[#64787b]">Approve company accounts, assign responsibilities, or suspend access.</p>
    <form onSubmit={(event) => { event.preventDefault(); void saveUser(email, roles, 'active', staffAuth && emailActionsEnabled); }} className="mt-6 grid gap-3 rounded-2xl border border-[#dce7e5] bg-white p-5 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end"><label className="text-sm font-bold text-[#456367]">Email<input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] px-3 font-normal" /></label><fieldset className="text-sm font-bold text-[#456367]"><legend>Roles</legend><div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">{stockFlowRoles.map((item) => <label key={item} className="flex min-h-11 items-center gap-2 font-normal capitalize"><input type="checkbox" checked={roles.includes(item)} disabled={roles.length === 1 && roles.includes(item)} onChange={(event) => setRoles((current) => event.target.checked ? normalizedRoles([...current, item]) : normalizedRoles(current.filter((roleItem) => roleItem !== item)))} />{item.replaceAll('_', ' ')}</label>)}</div></fieldset><button disabled={busy || (staffAuth && emailActionsEnabled && invitationUncertain)} className="min-h-11 rounded-xl bg-[#092f36] px-5 font-bold text-white disabled:opacity-50">{staffAuth && emailActionsEnabled ? 'Add and invite' : 'Add user'}</button></form>
    {staffAuth && <section className="mt-4 rounded-xl border bg-white p-4"><h2 className="font-bold">Staff login</h2><p className="my-3 text-sm">Invite new staff or resend a pending invitation. Existing password users need a reset link. Staff choose their own passwords.</p>{!emailActionsEnabled && <p className="my-3 text-sm">Staff invitation and password reset emails are not enabled.</p>}{invitationUncertain && <p role="alert" className="my-3 text-sm">Invitation not confirmed. Check the staff account before reloading to retry; do not add the user again.</p>}{members.filter(member => member.status === 'active').map(member => <div key={member.id} className="mb-3"><p className="break-all text-sm">{member.email}</p>{emailActionsEnabled && <div className="mt-2 flex flex-wrap gap-2"><button type="button" aria-label={`Invite or resend invitation to ${member.email}`} disabled={busy || invitationUncertain} onClick={() => void inviteUser(member.email)} className="min-h-11 rounded-lg border px-3">Invite / resend</button><button type="button" aria-label={`Reset password for ${member.email}`} disabled={busy} onClick={() => void resetPassword(member.email)} className="min-h-11 rounded-lg border px-3">Reset password</button></div>}</div>)}</section>}
    {message ? <output className="mt-4 block rounded-xl bg-[#edf7f3] px-4 py-3 text-sm text-[#31585d]">{message}</output> : null}
    <div className="mt-6 overflow-hidden rounded-2xl border border-[#dce7e5] bg-white"><div className="divide-y divide-[#e8efed]">{members.map((member) => { const selectedRoles = roleDrafts[member.id] ?? normalizedRoles(member.roles?.length ? member.roles : [member.role], member.role); const savedRoles = normalizedRoles(member.roles?.length ? member.roles : [member.role], member.role); const dirty = selectedRoles.length !== savedRoles.length || selectedRoles.some((item) => !savedRoles.includes(item)); return <div key={member.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_130px] sm:items-center"><div className="min-w-0"><strong className="[overflow-wrap:anywhere] text-[#173239]">{member.email}</strong><p className="mt-1 text-xs capitalize text-[#718487]">{member.status}</p></div><div className="min-w-0"><details><summary className="cursor-pointer text-sm font-bold text-[#456367]">Roles: {(member.roles?.length ? member.roles : [member.role]).map((item) => item.replaceAll('_', ' ')).join(', ')}</summary><fieldset className="mt-2 flex flex-wrap gap-x-4 gap-y-2"><legend className="sr-only">Roles for {member.email}</legend>{stockFlowRoles.map((item) => <label key={item} className="flex min-h-11 items-center gap-2 text-sm capitalize"><input type="checkbox" checked={selectedRoles.includes(item)} disabled={busy || (selectedRoles.length === 1 && selectedRoles.includes(item))} onChange={(event) => setRoleDrafts((current) => ({ ...current, [member.id]: normalizedRoles(event.target.checked ? [...selectedRoles, item] : selectedRoles.filter((roleItem) => roleItem !== item), member.role) }))} />{item.replaceAll('_', ' ')}</label>)}</fieldset></details><button type="button" disabled={busy || !dirty || selectedRoles.length === 0} onClick={() => void saveUser(member.email, selectedRoles, member.status, false, member)} className="mt-2 min-h-11 rounded-lg bg-[#edf7f3] px-3 text-sm font-bold text-[#31585d] disabled:opacity-50">Save roles</button></div><button type="button" disabled={busy} onClick={() => void saveUser(member.email, member.roles?.length ? member.roles : [member.role], member.status === 'active' ? 'suspended' : 'active', false, member)} className="min-h-11 rounded-xl border border-[#cedfdd] px-3 font-bold text-[#456367]">{member.status === 'active' ? 'Suspend' : 'Activate'}</button></div>; })}</div></div>
  </div></div>;
}
