import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Read-only configuration shape check. Never print environment values or
// claim hosted acceptance based on configuration alone.
export function staffAuthPreflight(env) {
  const blockers = [];
  const httpsOrigin = value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url : null;
    } catch { return null; }
  };
  if (env.STOCKFLOW_AUTH_MODE !== 'supabase') blockers.push('Staff authentication mode is not enabled');
  const origin = httpsOrigin(env.STOCKFLOW_STAFF_ORIGIN);
  if (!origin) blockers.push('Configure an exact HTTPS staff origin');
  else if (origin.hostname.endsWith('.chatgpt.site') || origin.hostname === 'chatgpt.site') blockers.push('Staff mode requires an isolated direct host, not the Sites host');
  if (!httpsOrigin(env.SUPABASE_URL)) blockers.push('Configure an HTTPS Supabase project origin');
  if (env.STOCKFLOW_AUTH_EXPECTED_PROJECT && (!/^[a-z0-9]{20}$/.test(env.STOCKFLOW_AUTH_EXPECTED_PROJECT) || httpsOrigin(env.SUPABASE_URL)?.origin !== `https://${env.STOCKFLOW_AUTH_EXPECTED_PROJECT}.supabase.co`)) blockers.push('Authentication project does not match the deployment target');
  const key = env.STOCKFLOW_AUTH_PUBLISHABLE_KEY || '';
  if (!key.startsWith('sb_publishable_') || key.length < 30 || /replace|example/i.test(key)) blockers.push('Configure a modern publishable key, never a secret/service-role key');
  const adminKey = env.STOCKFLOW_AUTH_ADMIN_KEY || '';
  if (!adminKey.startsWith('sb_secret_') || adminKey.length < 30 || /replace|example/i.test(adminKey)) blockers.push('Configure a separate modern server-only staff provisioning secret');
  for (const name of ['STOCKFLOW_ORDER_GATEWAY_KEY', 'STOCKFLOW_READ_KEY']) {
    if (!env[name] || /replace|example/i.test(env[name])) blockers.push(`Configure ${name} securely`);
  }
  if (env.STOCKFLOW_AUTH_EMAIL_RESET_ENABLED !== 'true') blockers.push('Recovery-email delivery has not been enabled after verification');
  return {
    configurationReady: blockers.length === 0,
    deploymentReady: false,
    blockers,
    remainingChecks: ['Approved Auth accounts and OMS membership aligned; public signup disabled', 'SMTP delivery and exact recovery redirect verified', 'Direct-host abuse throttling and free-tier resource limits measured', 'Hosted login, reset and actual Android acceptance completed'],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = staffAuthPreflight(process.env);
  console.log(JSON.stringify(report, null, 2));
  if (!report.configurationReady) process.exitCode = 1;
}
