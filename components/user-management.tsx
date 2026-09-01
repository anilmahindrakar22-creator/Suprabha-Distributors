'use client';

import { useCallback, useEffect, useState } from 'react';

type Member = { id: number; email: string; role: string; status: string; updatedAt: string };
const roles = ['administrator', 'sales', 'operations', 'warehouse', 'accounts', 'management', 'viewer'];

async function read<T>(response: Response): Promise<T> {
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error || 'Request failed');
  return value;
}

export function UserManagement() {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try { setMembers((await read<{ users: Member[] }>(await fetch('/api/users', { cache: 'no-store' }))).users); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to load users'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function saveUser(nextEmail: string, nextRole: string, status: string) {
    setBusy(true); setMessage('');
    try {
      await read(await fetch('/api/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: nextEmail, role: nextRole, status }) }));
      setEmail(''); setMessage('User access updated.'); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to update user'); }
    finally { setBusy(false); }
  }

  return <div className="h-full overflow-y-auto"><div className="mx-auto max-w-5xl p-5 sm:p-8"><p className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#277b69]">Administration</p><h1 className="mt-1 text-3xl font-black text-[#092f36]">Users</h1><p className="mt-2 text-sm text-[#64787b]">Approve company accounts, assign responsibilities, or suspend access.</p>
    <form onSubmit={(event) => { event.preventDefault(); void saveUser(email, role, 'active'); }} className="mt-6 grid gap-3 rounded-2xl border border-[#dce7e5] bg-white p-5 sm:grid-cols-[1fr_190px_auto] sm:items-end"><label className="text-sm font-bold text-[#456367]">Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] px-3 font-normal" /></label><label className="text-sm font-bold text-[#456367]">Role<select value={role} onChange={(event) => setRole(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] bg-white px-3 font-normal">{roles.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label><button disabled={busy} className="min-h-11 rounded-xl bg-[#092f36] px-5 font-bold text-white disabled:opacity-50">Add user</button></form>
    {message ? <p role="status" className="mt-4 rounded-xl bg-[#edf7f3] px-4 py-3 text-sm text-[#31585d]">{message}</p> : null}
    <div className="mt-6 overflow-hidden rounded-2xl border border-[#dce7e5] bg-white"><div className="divide-y divide-[#e8efed]">{members.map((member) => <div key={member.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_180px_130px] sm:items-center"><div><strong className="text-[#173239]">{member.email}</strong><p className="mt-1 text-xs capitalize text-[#718487]">{member.status}</p></div><select aria-label={`Role for ${member.email}`} value={member.role} disabled={busy} onChange={(event) => void saveUser(member.email, event.target.value, member.status)} className="min-h-10 rounded-xl border border-[#cedfdd] bg-white px-3 capitalize">{roles.map((item) => <option key={item} value={item}>{item}</option>)}</select><button type="button" disabled={busy} onClick={() => void saveUser(member.email, member.role, member.status === 'active' ? 'suspended' : 'active')} className="min-h-10 rounded-xl border border-[#cedfdd] px-3 font-bold text-[#456367]">{member.status === 'active' ? 'Suspend' : 'Activate'}</button></div>)}</div></div>
  </div></div>;
}
