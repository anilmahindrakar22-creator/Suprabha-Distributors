import { describe, expect, it } from 'vitest';
import { staffAuthPreflight } from '../staff-auth-preflight.mjs';

const configured = {
  STOCKFLOW_AUTH_MODE: 'supabase', STOCKFLOW_STAFF_ORIGIN: 'https://staff.example.test',
  SUPABASE_URL: 'https://project.supabase.co', STOCKFLOW_AUTH_PUBLISHABLE_KEY: 'sb_publishable_012345678901234567890',
  STOCKFLOW_AUTH_ADMIN_KEY: 'sb_secret_012345678901234567890123456789',
  STOCKFLOW_ORDER_GATEWAY_KEY: 'synthetic-gateway-private', STOCKFLOW_READ_KEY: 'synthetic-read-private',
  STOCKFLOW_AUTH_EMAIL_RESET_ENABLED: 'true',
};
describe('staff-auth configuration preflight', () => {
  it('reports missing configuration without claiming deployment readiness', () => {
    const report = staffAuthPreflight({});
    expect(report.configurationReady).toBe(false);
    expect(report.deploymentReady).toBe(false);
    expect(report.blockers).toHaveLength(8);
  });
  it('requires live acceptance even with a complete configuration shape', () => {
    const report = staffAuthPreflight(configured);
    expect(report.configurationReady).toBe(true);
    expect(report.deploymentReady).toBe(false);
    expect(report.remainingChecks).toHaveLength(4);
    const output = JSON.stringify(report);
    for (const value of Object.values(configured).filter(value => value.includes('private') || value.startsWith('sb_'))) expect(output).not.toContain(value);
  });
  it.each(['http://staff.example.test', 'https://user:password@staff.example.test', 'https://staff.example.test/path', 'https://staff.example.test?key=private', 'https://staff.example.test#private', 'https://suprabha-stockflow.anil.chatgpt.site'])('rejects unsafe staff origin %s', origin => {
    expect(staffAuthPreflight({ ...configured, STOCKFLOW_STAFF_ORIGIN: origin }).configurationReady).toBe(false);
  });
  it.each(['sb_secret_privatecredential', 'legacy-service-role-jwt', 'sb_publishable_replace-with-project-key'])('rejects incorrect or placeholder auth key', key => {
    const report = staffAuthPreflight({ ...configured, STOCKFLOW_AUTH_PUBLISHABLE_KEY: key });
    expect(report.configurationReady).toBe(false);
    expect(JSON.stringify(report)).not.toContain(key);
  });
  it('keeps recovery disabled until configured', () => {
    expect(staffAuthPreflight({ ...configured, STOCKFLOW_AUTH_EMAIL_RESET_ENABLED: 'false' }).configurationReady).toBe(false);
  });
  it.each(['', 'sb_publishable_012345678901234567890', 'sb_secret_replace-with-secret', 'legacy-service-role-jwt'])('rejects invalid provisioning configuration without disclosing it', key => {
    const report = staffAuthPreflight({ ...configured, STOCKFLOW_AUTH_ADMIN_KEY: key });
    expect(report.configurationReady).toBe(false);
    if (key) expect(JSON.stringify(report)).not.toContain(key);
  });
  it('blocks a production target configured against acceptance data', () => {
    expect(staffAuthPreflight({ ...configured, STOCKFLOW_AUTH_EXPECTED_PROJECT: 'aormuidjbdqruglmyseh', SUPABASE_URL: 'https://ayrvhemxzizpkfcycvip.supabase.co' }).configurationReady).toBe(false);
    expect(staffAuthPreflight({ ...configured, STOCKFLOW_AUTH_EXPECTED_PROJECT: 'aormuidjbdqruglmyseh', SUPABASE_URL: 'https://aormuidjbdqruglmyseh.supabase.co' }).configurationReady).toBe(true);
  });
});
