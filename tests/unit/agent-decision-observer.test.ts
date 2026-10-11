import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRecord, classifyPath, decide, parseAgentFiles, summarize } from '../agent-decision-observer.mjs';

const policy = JSON.parse(readFileSync(new URL('../agent-decision-policy.json', import.meta.url), 'utf8'));
const modulePath = fileURLToPath(new URL('../agent-decision-observer.mjs', import.meta.url));
const tmpRoot = fileURLToPath(new URL('../../work/tmp/', import.meta.url));
type Tier = 'light' | 'standard' | 'heavy';
const requested = (tier: Tier = 'light') => ({ tier, effort: 'medium', sandbox: 'workspace-write', network: false, resume: false });
const block = (write: string[], read: string[] = []) => `\`\`\`agent-files\nread: ${read.join(', ')}\nwrite: ${write.join(', ')}\n\`\`\``;
const record = (text: string, tier: Tier = 'light') => buildRecord({ text, policy, requested: requested(tier), now: '2026-10-11T00:00:00.000Z' });
const answer = (text: string, question: string, tier: Tier = 'light') => record(text, tier).decisions.find(decision => decision.question === question);
const folders: string[] = [];
function tempFolder() {
  mkdirSync(tmpRoot, { recursive: true });
  const folder = mkdtempSync(resolve(tmpRoot, 'agent-decision-'));
  folders.push(folder);
  return folder;
}
function cli(...args: string[]) {
  return spawnSync(process.execPath, [modulePath, ...args], { encoding: 'utf8', env: { ...process.env, TEMP: tmpRoot, TMP: tmpRoot } });
}
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('observation-only typed decision layer', () => {
  it('parses only the first agent-files fence and normalizes and deduplicates paths', () => {
    const text = '```text\n```agent-files\nwrite: hidden.ts\n```\n' +
      '~~~agent-files\nread: lib\\order-types.ts, lib/order-types.ts, \nwrite: ./docs/x.md\nwrite: docs/x.md, tests/x.ts\n~~~\n' + block(['ignored.ts']);
    expect(parseAgentFiles(text)).toEqual({ read: ['lib/order-types.ts'], write: ['docs/x.md', 'tests/x.ts'] });
    expect(parseAgentFiles('```agent-files extra\nwrite: docs/x.md\n```')).toBeNull();
    expect(parseAgentFiles('```agent-files\nwrite: docs/x.md')).toBeNull();
    expect(parseAgentFiles('plain text')).toBeNull();
  });

  it.each([
    ['tests/pricing-release-preflight.mjs', 'restricted'],
    ['supabase/migration-history-map.json', 'restricted'],
    ['.env.local', 'restricted'],
    ['cert.pem', 'restricted'],
    ['keys/nested/private.key', 'restricted'],
    ['.codex/setup-worker-keys-local.ps1', 'restricted'],
    ['wrangler.jsonc', 'restricted'],
    ['nested/wrangler.toml', 'restricted'],
    ['supabase/migrations/x.sql', 'sensitive'],
    ['app/api/orders/route.ts', 'sensitive'],
    ['lib/customer-pricing.ts', 'sensitive'],
    ['public/sw.js', 'sensitive'],
    ['components/page-header.tsx', 'app'],
    ['app/page.tsx', 'app'],
    ['docs/x.md', 'public'],
    ['tests/unit/x.test.ts', 'public'],
    ['README.md', 'public'],
    ['unknown/file.ts', 'app'],
    ['lib/nested/pricing.ts', 'app'],
    ['nested/.env.local', 'app'],
  ])('classifies %s as %s using ordered segment globs', (path, classification) => {
    expect(classifyPath(path, policy).class).toBe(classification);
  });

  it('reports the matched rule and defaults, including Windows path separators', () => {
    expect(classifyPath('supabase\\migration-history-map.json', policy)).toEqual({ class: 'restricted', rule: 'supabase/migration-history-map.json' });
    expect(classifyPath('unknown/file.ts', policy)).toEqual({ class: 'app', rule: 'default' });
  });

  it.each(policy.denyPatterns as string[])('denies %s without a file block', pattern => {
    const text = pattern === 'write .*secret' ? 'WRITE a new SECRET' : pattern.toUpperCase();
    expect(answer(text, 'permission.handoff')?.answer).toBe('deny');
    expect(answer(text, 'security.sensitivity')?.answer).toBeNull();
    expect(answer(text, 'route.tier')?.answer).toBeNull();
  });

  it('asks for sensitive or restricted writes, permits docs, and applies deny first', () => {
    expect(answer(block(['app/api/orders/route.ts']), 'permission.handoff')?.answer).toBe('ask');
    expect(answer(block(['.env.local']), 'permission.handoff')?.answer).toBe('ask');
    expect(answer(block(['docs/x.md']), 'permission.handoff')?.answer).toBe('allow');
    expect(answer(`Deploy\n${block(['docs/x.md'])}`, 'permission.handoff')?.answer).toBe('ask');
    expect(answer(`Migration\n${block(['docs/x.md'])}`, 'permission.handoff')?.answer).toBe('ask');
    expect(answer(`wrangler deploy\n${block(['.env.local'])}`, 'permission.handoff')?.answer).toBe('deny');
  });

  it('abstains for missing or empty declarations, including ask keywords without files', () => {
    for (const text of ['Describe the change', 'deploy migration', block([])]) {
      expect(record(text).decisions.every(decision => decision.answer === null && decision.confidence === 0)).toBe(true);
    }
    expect(decide({ text: '', files: null, requested: requested(), policy }).map(decision => decision.answer)).toEqual([null, null, null, null]);
  });

  it.each([
    [block(['docs/x.md']), 'light'],
    [block(['components/page-header.tsx']), 'light'],
    [block(['tests/a.ts', 'tests/b.ts']), 'standard'],
    [`Update state and effect\n${block(['components/page-header.tsx'])}`, 'standard'],
    [block(['app/api/orders/route.ts']), 'heavy'],
    [block(['.env.local']), 'heavy'],
  ] as [string, Tier][])('suggests the tier and records agreement: %s', (text, tier) => {
    expect(answer(text, 'route.tier', tier)).toMatchObject({ answer: tier, requested: tier, agrees: true, confidence: 1 });
    const other = tier === 'heavy' ? 'light' : 'heavy';
    expect(answer(text, 'route.tier', other)).toMatchObject({ answer: tier, requested: other, agrees: false });
  });

  it('abstains for read-only or six public writes and routes public writes with restricted reads', () => {
    expect(answer(block([], ['docs/x.md']), 'route.tier')?.answer).toBeNull();
    expect(answer(block(Array.from({ length: 6 }, (_, i) => `tests/${i}.ts`)), 'route.tier')?.answer).toBeNull();
    expect(answer(block(['docs/x.md'], ['tests/pricing-release-preflight.mjs']), 'route.tier')?.answer).toBe('light');
    expect(answer(`deploy\n${block(['docs/x.md'])}`, 'route.tier')?.answer).toBe('light');
    expect(answer(`danger-full-access\n${block(['app/api/orders/route.ts'])}`, 'route.tier')?.answer).toBeNull();
  });

  it('scores tests-only writes as public and reports restricted reads separately', () => {
    const text = block(['tests/agent-decision-observer.mjs', 'tests/agent-decision-policy.json', 'tests/unit/agent-decision-observer.test.ts'], ['docs/AGENT-DECISION-LAYER.md', 'AGENTS.md', 'tests/pricing-release-preflight.mjs', 'tests/staff-auth-preflight.mjs', 'tests/unit/pricing-release-preflight.test.ts']);
    expect(answer(text, 'security.sensitivity')?.answer).toMatchObject({ class: 'public', score: 0.1, readClass: 'restricted', restrictedReads: ['tests/pricing-release-preflight.mjs'] });
    expect(answer(text, 'permission.handoff')?.answer).toBe('allow');
    expect(answer(text, 'route.tier', 'standard')?.answer).toBe('standard');
    expect(answer(block(['tests/agent-decision-observer.mjs']), 'security.sensitivity')?.answer).toMatchObject({ class: 'public', score: 0.1, readClass: null, restrictedReads: [] });
  });

  it('classifies reads-only handoffs by reads with the fallback reason', () => {
    const text = block([], ['docs/x.md', 'tests/pricing-release-preflight.mjs']);
    expect(answer(text, 'security.sensitivity')).toMatchObject({
      answer: { class: 'restricted', score: 1, readClass: 'restricted', restrictedReads: ['tests/pricing-release-preflight.mjs'] },
      reasons: ['no writes declared; classified by reads'],
    });
    expect(answer(text, 'permission.handoff')?.answer).toBe('allow');
    expect(answer(text, 'route.tier')?.answer).toBeNull();
  });

  it('retains both kinds when a file is declared for reading and writing', () => {
    const text = block(['docs/x.md', 'docs/x.md'], ['docs/x.md', '.env.local', '.env.local']);
    expect(answer(text, 'security.sensitivity')?.answer).toEqual({
      class: 'public', score: 0.1, readClass: 'restricted', restrictedReads: ['.env.local'],
      matches: [
        { path: 'docs/x.md', class: 'public', rule: 'docs/**', kind: 'read' },
        { path: '.env.local', class: 'restricted', rule: '.env*', kind: 'read' },
        { path: 'docs/x.md', class: 'public', rule: 'docs/**', kind: 'write' },
      ],
    });
  });

  it('uses the highest write class and read class independently', () => {
    const text = block(['docs/x.md', 'app/api/orders/route.ts'], ['components/page-header.tsx', 'docs/x.md']);
    expect(answer(text, 'security.sensitivity')?.answer).toMatchObject({ class: 'sensitive', score: 0.75, readClass: 'app', restrictedReads: [] });
    expect(answer(text, 'permission.handoff')?.answer).toBe('ask');
    expect(answer(text, 'route.tier', 'heavy')?.answer).toBe('heavy');
  });

  it('reports overlap with in-flight write sets, ignoring read overlap', () => {
    const text = block(['components/page-header.tsx', 'docs/x.md']);
    const decisions = decide({ text, files: parseAgentFiles(text), policy, requested: requested(), inFlight: [
      { handoff: 'other.decisions.json', files: { read: ['docs/x.md'], write: ['components\\page-header.tsx'] } },
    ] });
    expect(decisions.find(decision => decision.question === 'ownership.overlap')?.answer).toEqual({ overlapping: [{ path: 'components/page-header.tsx', handoff: 'other.decisions.json' }] });
    expect(answer(text, 'ownership.overlap')?.answer).toEqual({ overlapping: [] });
  });

  it('stores a stable digest and typed metadata without the handoff text', () => {
    const text = `Private handoff prose: unique sentinel 589746\n${block(['docs/x.md'])}`;
    const built = record(text);
    expect(built.handoffDigest).toBe(createHash('sha256').update(text).digest('hex'));
    expect(record(text).handoffDigest).toBe(built.handoffDigest);
    expect(JSON.stringify(built)).not.toContain('unique sentinel');
    expect(built).toMatchObject({ schema: 'jev.decision/v1', policyVersion: '2026-10-11.1', createdAt: '2026-10-11T00:00:00.000Z', observedOnly: true, actionTaken: 'launched-unchanged', requested: requested() });
    expect(built.decisions.every(decision => decision.confidence >= 0 && decision.confidence <= 1)).toBe(true);
  });

  it('summarizes non-null tier agreement, review counts, abstained runs and requested-tier outcomes', () => {
    const good = record(block(['docs/x.md']));
    good.outcome = { exitCode: 0, seconds: 2, tokens: '10' };
    const ask = record(block(['app/api/orders/route.ts']), 'standard');
    ask.outcome = { exitCode: 1, seconds: 4 };
    const denied = record('danger-full-access', 'heavy');
    const summary = summarize([good, ask, denied]);
    expect(summary).toMatchObject({ runs: 3, tierAgreementRate: 0.5, wouldAsk: 1, wouldDeny: 1, abstained: 1 });
    expect(summary.outcomesByTier.light).toEqual({ runs: 1, completed: 1, succeeded: 1, failed: 0, seconds: 2 });
    expect(summary.outcomesByTier.standard).toEqual({ runs: 1, completed: 1, succeeded: 0, failed: 1, seconds: 4 });
    expect(summary.restrictedReadRuns).toBe(0);
    expect(summarize([])).toMatchObject({ runs: 0, tierAgreementRate: null, abstained: 0, restrictedReadRuns: 0 });
  });

  it('counts restricted-read runs once each, including reads-only records', () => {
    const mixed = record(block(['tests/x.ts'], ['.env.local', 'tests/pricing-release-preflight.mjs']));
    const readsOnly = record(block([], ['supabase/migration-history-map.json']));
    const ordinary = record(block(['docs/x.md'], ['components/page-header.tsx']));
    const noFiles = record('No declarations');
    expect(summarize([mixed, readsOnly, ordinary, noFiles])).toMatchObject({ runs: 4, restrictedReadRuns: 2 });
  });
});

describe('fail-open observer CLI', () => {
  it('writes only its adjacent record, adds outcomes, and summarizes', () => {
    const folder = tempFolder();
    const handoff = resolve(folder, 'sample.handoff.md');
    const text = `Private sentinel CLI-589746\n${block(['tests/agent-decision-observer.mjs'])}`;
    writeFileSync(handoff, text);
    const result = cli('observe', '--handoff', handoff, '--tier', 'light', '--effort', 'medium', '--sandbox', 'workspace-write', '--network', '--resume');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('jev observe: sensitivity=public permission=allow tier=light/light agrees=true overlap=0');
    expect(readdirSync(folder).sort()).toEqual(['sample.handoff.decisions.json', 'sample.handoff.md']);
    expect(readFileSync(handoff, 'utf8')).toBe(text);
    const output = resolve(folder, 'sample.handoff.decisions.json');
    expect(readFileSync(output, 'utf8')).not.toContain('CLI-589746');
    expect(JSON.parse(readFileSync(output, 'utf8')).requested).toMatchObject({ network: true, resume: true });
    expect(cli('outcome', '--handoff', handoff, '--exit', '0', '--seconds', '1.25', '--tokens', '123 tokens').status).toBe(0);
    expect(JSON.parse(readFileSync(output, 'utf8')).outcome).toEqual({ exitCode: 0, seconds: 1.25, tokens: '123 tokens' });
    expect(JSON.parse(cli('summary', folder).stdout)).toMatchObject({ runs: 1, tierAgreementRate: 1 });
    expect(readdirSync(folder)).toHaveLength(2);
  });

  it('discovers other unfinished records and excludes itself and completed records', () => {
    const folder = tempFolder();
    const text = block(['docs/shared.md']);
    const first = resolve(folder, 'first.md');
    const second = resolve(folder, 'second.md');
    writeFileSync(first, text);
    writeFileSync(second, text);
    const observe = (handoff: string) => cli('observe', '--handoff', handoff, '--tier', 'light', '--effort', 'low', '--sandbox', 'read-only');
    expect(observe(first).stdout).toContain('overlap=0');
    expect(observe(first).stdout).toContain('overlap=0');
    expect(observe(second).stdout).toContain('overlap=1');
    cli('outcome', '--handoff', first, '--exit', '0', '--seconds', '2');
    expect(observe(second).stdout).toContain('overlap=0');
  });

  it('treats missing outcomes as a no-op', () => {
    const folder = tempFolder();
    const result = cli('outcome', '--handoff', resolve(folder, 'missing.md'), '--exit', '0', '--seconds', '2');
    expect(result.status).toBe(0);
    expect(readdirSync(folder)).toEqual([]);
  });

  it('fails open for missing files, malformed arguments, records, and summaries', () => {
    const folder = tempFolder();
    const missing = resolve(folder, 'missing.md');
    const cases = [
      [], ['unknown'], ['observe'],
      ['observe', '--handoff', missing, '--tier', 'light', '--effort', 'low', '--sandbox', 'read-only'],
      ['observe', '--handoff', missing, '--tier', 'invalid', '--effort', 'low', '--sandbox', 'read-only'],
      ['observe', '--handoff', missing, '--tier', 'light', '--effort', 'low', '--sandbox', 'read-only', '--extra'],
      ['outcome', '--handoff', missing, '--exit', 'NaN', '--seconds', '1'],
      ['outcome', '--handoff', missing, '--exit', '0', '--seconds', '-1'],
      ['summary'], ['summary', missing],
    ];
    for (const args of cases) {
      const result = cli(...args);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('jev observe: skipped (');
      expect(result.stderr).toBe('');
    }
    writeFileSync(resolve(folder, 'broken.decisions.json'), '{ malformed secret sentinel');
    const summary = cli('summary', folder);
    expect(summary.status).toBe(0);
    expect(summary.stdout).toContain('skipped');
    expect(summary.stdout).not.toContain('sentinel');
    writeFileSync(missing, block(['docs/x.md']));
    expect(cli('observe', '--handoff', missing, '--tier', 'light', '--effort', 'low', '--sandbox', 'read-only').stdout).toContain('skipped');
    expect(readdirSync(folder).sort()).toEqual(['broken.decisions.json', 'missing.md']);
  }, 30000);
});
