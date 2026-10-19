import { createClient } from '@supabase/supabase-js';
import { callOrderGateway } from './order-gateway';

export const STAFF_COOKIE = '__Host-stockflow-staff';
export const STAFF_REFRESH_COOKIE = '__Host-stockflow-refresh';
export class StaffSessionUnavailableError extends Error {
  constructor() { super('Sign-in verification is temporarily unavailable'); }
}
export function staffAuthEnabled() {
  const mode = process.env.STOCKFLOW_AUTH_MODE;
  if (mode && mode !== 'sites' && mode !== 'supabase') throw new Error('Invalid authentication mode');
  return mode === 'supabase';
}

// Navigation only: never changes the active deployment's authentication provider.
// Configure peers only after verifying they use the same backend/environment.
function publicSignInOrigin(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port) return null;
    return url;
  } catch { return null; }
}

export function publicStaffSignInUrl() {
  const url = publicSignInOrigin(process.env.STOCKFLOW_PUBLIC_STAFF_ORIGIN);
  if (!url || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.includes(':') || /^\[|^[\d.]+$/.test(url.hostname) || url.hostname === 'chatgpt.site' || url.hostname.endsWith('.chatgpt.site')) return null;
  return `${url.origin}/staff-signin`;
}

export function publicChatGPTSignInUrl() {
  const url = publicSignInOrigin(process.env.STOCKFLOW_PUBLIC_CHATGPT_ORIGIN);
  if (!url || !url.hostname.endsWith('.chatgpt.site')) return null;
  return `${url.origin}/signin-with-chatgpt?return_to=%2F`;
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
  const expectedProject = process.env.STOCKFLOW_AUTH_EXPECTED_PROJECT;
  if (expectedProject && (!/^[a-z0-9]{20}$/.test(expectedProject) || project.origin !== `https://${expectedProject}.supabase.co`)) throw new Error('Authentication project does not match this deployment');
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
  let result;
  try { result = await staffAuthClient().auth.getUser(token); }
  catch { throw new StaffSessionUnavailableError(); }
  const { data, error } = result;
  // Only an authoritative credential rejection means signed out. Network,
  // throttling and provider failures must never masquerade as expired login.
  if (error) {
    if ([400, 401, 403].includes(error.status ?? 0)) return null;
    throw new StaffSessionUnavailableError();
  }
  const user = data.user;
  if (!user?.id || !user.email || !user.email_confirmed_at || user.is_anonymous) return null;
  const email = user.email.trim().toLowerCase();
  return { userId: user.id, email, displayName: email.split('@')[0] };
}

type VerifiedStaff = NonNullable<Awaited<ReturnType<typeof verifiedStaff>>>;
/**
 * Short per-isolate memory of successful sign-in checks, so ordinary page requests
 * skip a Supabase Auth round trip (owner approved, 19 Oct 2026). Rules:
 * - only page/API identity (getChatGPTUser) uses it; password login and recovery verify fresh;
 * - only a verified user is stored; rejections and provider failures never are;
 * - an entry lives at most 60 s and never past the token's own expiry;
 * - keys are SHA-256 hashes of the token, never the token itself; at most 256 entries.
 * Membership, roles and suspension are still checked by the database gateway on every
 * request. Forgetting entries is best effort (this isolate only); the TTL is the bound.
 */
const VERIFIED_STAFF_TTL_MS = 60_000;
const VERIFIED_STAFF_MAX = 256;
const verifiedStaffCache = new Map<string, { user: VerifiedStaff; expiresAt: number }>();

async function tokenKey(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The token's own expiry, used only to shorten a cache entry; never trusted for identity. */
function tokenExpiryMs(token: string) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')));
    return typeof json.exp === 'number' && Number.isFinite(json.exp) ? json.exp * 1000 : null;
  } catch { return null; }
}

export async function cachedVerifiedStaff(token: string | undefined, now = Date.now()): Promise<{ user: VerifiedStaff | null; cached: boolean }> {
  if (!token || token.length > 8192) return { user: null, cached: false };
  const key = await tokenKey(token);
  const entry = verifiedStaffCache.get(key);
  if (entry && entry.expiresAt > now) return { user: entry.user, cached: true };
  if (entry) verifiedStaffCache.delete(key);
  const user = await verifiedStaff(token);
  if (user) {
    const expiresAt = Math.min(now + VERIFIED_STAFF_TTL_MS, tokenExpiryMs(token) ?? Infinity);
    if (expiresAt > now) {
      while (verifiedStaffCache.size >= VERIFIED_STAFF_MAX) verifiedStaffCache.delete(verifiedStaffCache.keys().next().value!);
      verifiedStaffCache.set(key, { user, expiresAt });
    }
  }
  return { user, cached: false };
}

/** Drop a token's cached check (sign-out). Best effort: this isolate only. */
export async function forgetVerifiedStaffToken(token: string | undefined) {
  if (token && token.length <= 8192) verifiedStaffCache.delete(await tokenKey(token));
}

/** Drop every cached check for an account (password reset signs out all sessions). */
export function forgetVerifiedStaffEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  for (const [key, entry] of verifiedStaffCache) if (entry.user.email === normalized) verifiedStaffCache.delete(key);
}

export function resetVerifiedStaffCacheForTests() {
  verifiedStaffCache.clear();
}

export async function staffPasswordLogin(email: string, password: string) {
  const { data, error } = await staffAuthClient().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error || !data.session || !data.session.refresh_token || data.session.refresh_token.length > 4096) return null;
  if (!Number.isFinite(data.session.expires_in) || data.session.expires_in <= 0) return null;
  const user = await verifiedStaff(data.session.access_token);
  if (!user) return null;
  // Password authentication does not grant membership, pricing or administrator rights.
  const member = await callOrderGateway<{ email: string; role: string }>(user.email, 'session');
  if (member.email !== user.email) return null;
  return { token: data.session.access_token, refreshToken: data.session.refresh_token, expiresIn: Math.min(data.session.expires_in, 3600) };
}

export function staffCookie(token: string, expiresIn: number) {
  return `${STAFF_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(expiresIn))}`;
}

// Scheduling hint only, after provider verification. Never used for identity or permissions.
export function staffRenewalDelay(token: string | undefined, now = Date.now()) {
  try {
    const payload = JSON.parse(atob((token?.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.exp === 'number' && Number.isFinite(payload.exp)) {
      return Math.max(30, Math.min(3000, Math.floor(payload.exp - now / 1000 - 60)));
    }
  } catch { /* malformed hint cannot authorize or extend a session */ }
  return 60;
}

export function staffRefreshCookie(token: string) {
  // Browser cookie retention is renewed whenever the provider rotates tokens.
  // This is not an application account/session timeout.
  return `${STAFF_REFRESH_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${token ? 34560000 : 0}`;
}

export async function renewStaffSession(refreshToken: string) {
  if (!refreshToken || refreshToken.length > 4096) return null;
  const { data, error } = await staffAuthClient().auth.refreshSession({ refresh_token: refreshToken });
  if (error) {
    if ([400, 401, 403].includes(error.status ?? 0)) return null;
    throw new StaffSessionUnavailableError();
  }
  const session = data.session;
  if (!session?.access_token || !session.refresh_token || !Number.isFinite(session.expires_in) || session.expires_in <= 0) return null;
  const user = await verifiedStaff(session.access_token);
  if (!user) return null;
  // Membership must be current. A provider session alone cannot restore a
  // suspended account or grant roles from a stale token.
  const member = await callOrderGateway<{ email: string }>(user.email, 'session');
  if (member.email !== user.email) return null;
  return { token: session.access_token, refreshToken: session.refresh_token, expiresIn: Math.min(session.expires_in, 3600) };
}
