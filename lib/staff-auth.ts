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
  return url.origin;
}

export function sameStaffOrigin(origin: string | null) {
  return origin === staffOrigin();
}

export function staffAuthClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.STOCKFLOW_AUTH_PUBLISHABLE_KEY;
  if (!url || !key || new URL(url).protocol !== 'https:') throw new Error('Staff authentication is not configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
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
