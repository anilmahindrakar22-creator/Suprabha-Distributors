/**
 * The database lives in Tokyo. Supabase otherwise runs an Edge Function in the region
 * nearest the caller (measured 19 Oct 2026: Zurich for most traffic, 455 ms median),
 * and each call then crosses to Tokyo for its database work. Pin functions next to it.
 */
export const SUPABASE_FUNCTION_REGION = 'ap-northeast-1';
