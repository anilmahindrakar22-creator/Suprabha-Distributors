import { createClient } from '@supabase/supabase-js';
import { callOrderGateway } from './order-gateway';

export const STAFF_COOKIE = '__Host-stockflow-staff';
export function staffAuthEnabled() {
  const mode = process.env.STOCKFLOW_AUTH_MODE;
  if (mode && mode !== 'sites' && mode !== 'supabase') throw new Error('Invalid authentication mode');
  return mode === 'supabase';
}

export function staffOrigin() {
  const url = new URL(process.env.STOCKFLOW_STAFF_ORIGIN || '');
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid staff origin');
  if (url.hostname === 'chatgpt.site' || url.hostname.endsWith('.chatgpt.site')) throw new Error('Staff authentication requires a direct host');
  return url.origin;
}

export function sameStaffOrigin(origin: string | null) {
  return origin === staffOrigin();
}

export function staffAuthClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.STOCKFLOW_AUTH_PUBLISHABLE_KEY;
  if (!url || !key || !key.startsWith('sb_publishable_') || key.length < 30 || /replace|example/i.test(key)) throw new Error('Staff authentication is not configured');
  const project = new URL(url);
  if (project.protocol !== 'https:' || project.username || project.password || project.pathname !== '/' || project.search || project.hash) throw new Error('Invalid authentication project origin');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) }) },
  });
}

export function staffInvitationClient() {
  // Validate the configured project using the existing client before constructing
  // a separate server-only admin client. Never attach an employee session to it.
  staffAuthClient();
  const key = process.env.STOCKFLOW_AUTH_ADMIN_KEY;
  if (!key || !key.startsWith('sb_secret_') || key.length < 30 || /replace|example/i.test(key)) throw new Error('Staff provisioning is not configured');
  return createClient(process.env.SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) }) },
  });
}

// Never derive identity or permissions from an unverified JWT or user_metadata.
export async function verifiedStaff(token: string | undefined) {
  if (!token || token.length > 8192) return null;
  const { data, error } = await staffAuthClient().auth.getUser(token);
  const user = data.user;
  if (error || !user?.id || !user.email || !user.email_confirmed_at || user.is_anonymous) return null;
  const email = user.email.trim().toLowerCase();
  return { userId: user.id, email, displayName: email.split('@')[0] };
}

export async function staffPasswordLogin(email: string, password: string) {
  const { data, error } = await staffAuthClient().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error || !data.session) return null;
  if (!Number.isFinite(data.session.expires_in) || data.session.expires_in <= 0) return null;
  const user = await verifiedStaff(data.session.access_token);
  if (!user) return null;
  // Password authentication does not grant membership, pricing or administrator rights.
  const member = await callOrderGateway<{ email: string; role: string }>(user.email, 'session');
  if (member.email !== user.email) return null;
  return { token: data.session.access_token, expiresIn: Math.min(data.session.expires_in, 3600) };
}

export function staffCookie(token: string, expiresIn: number) {
  return `${STAFF_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(expiresIn))}`;
}
