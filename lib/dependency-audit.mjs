import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const patchHash = '2882843b9208645c81fd1ab72aacc28cebb92e2651b795bece8a4d1e8a03958f';
const advisoryId = 'GHSA-vfj7-8cjw-p6xm';
const paths = new Set([
  '.>shadcn>fast-glob>micromatch>braces',
  '.>shadcn>ts-morph>@ts-morph/common>fast-glob>micromatch>braces',
  '.>vinext>vite-plugin-commonjs>vite-plugin-dynamic-import>fast-glob>micromatch>braces',
]);

// Temporary, exact-patch mitigation review; never a package-wide advisory ignore.
export function verifyDependencyAudit(report, status, evidence, now = Date.now()) {
  if (![0, 1].includes(status) || !report || report.error || !report.advisories ||
      typeof report.advisories !== 'object' || Array.isArray(report.advisories)) {
    throw new Error('Dependency audit unavailable or malformed');
  }
  const counts = report.metadata?.vulnerabilities;
  const advisories = Object.values(report.advisories);
  for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
    if (!Number.isInteger(counts?.[severity]) || counts[severity] < 0 ||
        counts[severity] !== advisories.filter(item => item?.severity === severity).length) {
      throw new Error('Dependency audit severity counts do not match');
    }
  }
  if (advisories.some(item => !['info', 'low', 'moderate', 'high', 'critical'].includes(item?.severity))) {
    throw new Error('Unknown dependency audit severity');
  }
  const blocking = advisories.filter(item => ['high', 'critical'].includes(item.severity));
  if (!blocking.length) {
    if (status !== 0) throw new Error('Dependency audit failed without a reported blocker');
    return { mitigated: false };
  }
  if (status !== 1 || blocking.length !== 1) throw new Error('Unmitigated dependency advisory');
  const item = blocking[0];
  if (item.github_advisory_id !== advisoryId || item.module_name !== 'braces' || item.severity !== 'high' ||
      !Array.isArray(item.findings) || !item.findings.length || item.findings.some(finding =>
        finding.version !== '3.0.3' || !Array.isArray(finding.paths) || !finding.paths.length ||
        finding.paths.some(path => !paths.has(path)))) {
    throw new Error('Unmitigated dependency advisory');
  }
  if (!Number.isFinite(now) || now >= Date.parse('2026-10-17T00:00:00Z')) {
    throw new Error('Braces mitigation review expired; reassess upstream fix');
  }
  if (evidence?.patchHash !== patchHash ||
      !/^  braces@3\.0\.3: patches\/braces@3\.0\.3\.patch$/m.test(evidence.workspace ?? '') ||
      !new RegExp(`^  braces@3\\.0\\.3: ${patchHash}$`, 'm').test(evidence.lockfile ?? '')) {
    throw new Error('Braces patch evidence missing or changed');
  }
  return { mitigated: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (!process.env.npm_execpath) throw new Error('Run this gate through pnpm');
    const runPnpm = args => spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
      encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
    });
    const audit = runPnpm(['audit', '--prod', '--audit-level=high', '--json']);
    process.stdout.write(audit.stdout ?? '');
    if (audit.error || audit.signal) throw new Error('Dependency audit execution failed');
    const result = verifyDependencyAudit(JSON.parse(audit.stdout), audit.status, {
      patchHash: createHash('sha256').update(readFileSync('patches/braces@3.0.3.patch')).digest('hex'),
      workspace: readFileSync('pnpm-workspace.yaml', 'utf8'),
      lockfile: readFileSync('pnpm-lock.yaml', 'utf8'),
    });
    if (result.mitigated) {
      const regression = runPnpm(['exec', 'vitest', 'run', 'tests/unit/braces-security.test.mjs']);
      process.stdout.write(regression.stdout ?? '');
      process.stderr.write(regression.stderr ?? '');
      if (regression.error || regression.signal || regression.status !== 0) {
        throw new Error('Installed braces mitigation regression failed');
      }
      console.log(`${advisoryId}: locally mitigated by exact tested patch; upstream advisory remains open. Review expires 2026-10-17.`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Dependency audit gate failed');
    process.exitCode = 1;
  }
}
