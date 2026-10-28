import { describe, expect, it } from 'vitest';
import { verifyDependencyAudit } from '../../lib/dependency-audit.mjs';

const hash = '2882843b9208645c81fd1ab72aacc28cebb92e2651b795bece8a4d1e8a03958f';
const now = Date.parse('2026-10-18T00:00:00Z');
const evidence = {
  patchHash: hash,
  workspace: 'patchedDependencies:\n  braces@3.0.3: patches/braces@3.0.3.patch\n',
  lockfile: `patchedDependencies:\n  braces@3.0.3: ${hash}\n`,
};
const report = () => ({
  advisories: { 1: { github_advisory_id: 'GHSA-vfj7-8cjw-p6xm', module_name: 'braces', severity: 'high',
    findings: [{ version: '3.0.3', paths: ['.>shadcn>fast-glob>micromatch>braces'] }] } },
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 } },
});

describe('hash-bound dependency mitigation gate', () => {
  it('recognizes only the documented exact mitigation', () => {
    expect(verifyDependencyAudit(report(), 1, evidence, now)).toEqual({ mitigated: true });
  });
  it('accepts a genuinely clean raw audit', () => {
    const clean = report();
    clean.advisories = {};
    clean.metadata.vulnerabilities.high = 0;
    expect(verifyDependencyAudit(clean, 0, {}, now)).toEqual({ mitigated: false });
  });
  it('accepts complete lower-severity reports under the unchanged high/critical release policy', () => {
    const lower = {
      advisories: { 1: { severity: 'moderate' }, 2: { severity: 'low' } },
      metadata: { vulnerabilities: { info: 0, low: 1, moderate: 1, high: 0, critical: 0 } },
    };
    expect(verifyDependencyAudit(lower, 1, {}, Date.now())).toEqual({ mitigated: false });
    expect(() => verifyDependencyAudit(lower, 0, {}, now)).toThrow();
    expect(() => verifyDependencyAudit({ ...lower, advisories: {} }, 1, {}, now)).toThrow();
  });
  it('rejects any unmitigated high or critical advisory in a complete report', () => {
    for (const severity of ['high', 'critical']) {
      const unsafe = {
        advisories: { 1: { severity, module_name: 'unreviewed' } },
        metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, [severity]: 1 } },
      };
      expect(() => verifyDependencyAudit(unsafe, 1, {}, Date.now())).toThrow();
    }
  });
  for (const field of ['patchHash', 'workspace', 'lockfile']) {
    it(`fails closed on missing or changed ${field}`, () => {
      expect(() => verifyDependencyAudit(report(), 1, { ...evidence, [field]: '' }, now)).toThrow();
    });
  }
  it('expires the review', () => {
    expect(() => verifyDependencyAudit(report(), 1, evidence, Date.parse('2026-10-25T00:00:00Z'))).toThrow('expired');
  });
  it('keeps the assessed mitigation valid only before the renewed cutoff', () => {
    expect(verifyDependencyAudit(report(), 1, evidence, Date.parse('2026-10-24T23:59:59.999Z'))).toEqual({ mitigated: true });
  });
  for (const [field, value] of [['github_advisory_id', 'OTHER'], ['module_name', 'other'], ['severity', 'critical']]) {
    it(`rejects another ${field}`, () => {
      const changed = report();
      changed.advisories[1][field] = value;
      expect(() => verifyDependencyAudit(changed, 1, evidence, now)).toThrow();
    });
  }
  it('rejects unreviewed versions and dependency paths', () => {
    for (const findings of [[{ version: '3.0.2', paths: ['.>shadcn>fast-glob>micromatch>braces'] }],
      [{ version: '3.0.3', paths: ['.>unreviewed>braces'] }], []]) {
      const changed = report();
      changed.advisories[1].findings = findings;
      expect(() => verifyDependencyAudit(changed, 1, evidence, now)).toThrow();
    }
  });
  it('rejects an additional high advisory', () => {
    const changed = report();
    changed.advisories[2] = { ...changed.advisories[1], github_advisory_id: 'OTHER' };
    changed.metadata.vulnerabilities.high = 2;
    expect(() => verifyDependencyAudit(changed, 1, evidence, now)).toThrow();
  });
  it('rejects failed, malformed and inconsistent audit responses', () => {
    for (const [body, status] of [[null, 1], [{ error: 'offline' }, 1], [report(), null], [report(), 0],
      [{ ...report(), metadata: {} }, 1]]) {
      expect(() => verifyDependencyAudit(body, status, evidence, now)).toThrow();
    }
  });
});
