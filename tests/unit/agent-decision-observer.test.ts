import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { agentFilesStatus, buildRecord, classifyPath, decide, parseAgentFiles, summarize } from '../agent-decision-observer.mjs';

const policy = JSON.parse(readFileSync(new URL('../agent-decision-policy.json', import.meta.url), 'utf8'));
const modulePath = fileURLToPath(new URL('../agent-decision-observer.mjs', import.meta.url));
const tmpRoot = fileURLToPath(new URL('../../work/tmp/', import.meta.url));
type Tier = 'light' | 'standard' | 'heavy';
const requested = (tier: Tier = 'light') => ({ tier, effort: 'medium', sandbox: 'workspace-write', network: false, resume: false });
const block = (write: string[], read: string[] = [], actions?: string[]) => `\`\`\`agent-files\nread: ${read.join(', ')}\nwrite: ${write.join(', ')}\n${actions ? `actions: ${actions.join(', ')}\n` : ''}\`\`\``;
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
function runFixture(text: string, tier: Tier = 'light') {
  const folder = tempFolder();
  const handoff = resolve(folder, 'run.md');
  const output = resolve(folder, 'run.decisions.json');
  writeFileSync(handoff, text);
  const observe = (...extra: string[]) => cli('observe', '--handoff', handoff, '--tier', tier, '--effort', 'low', '--sandbox', 'workspace-write', '--repo', folder, ...extra);
  const outcome = (...extra: string[]) => cli('outcome', '--handoff', handoff, '--exit', '0', '--seconds', '1', '--repo', folder, ...extra);
  const saved = () => JSON.parse(readFileSync(output, 'utf8'));
  return { folder, handoff, output, observe, outcome, saved };
}
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('observation-only typed decision layer', () => {
  it('parses only the first agent-files fence and normalizes and deduplicates paths', () => {
    const text = '```text\n```agent-files\nwrite: hidden.ts\n```\n' +
      '~~~agent-files\nread: lib\\order-types.ts, lib/order-types.ts, \nwrite: ./docs/x.md\nwrite: docs/x.md, tests/x.ts\n~~~\n' + block(['ignored.ts']);
    expect(parseAgentFiles(text)).toEqual({ read: ['lib/order-types.ts'], write: ['docs/x.md', 'tests/x.ts'], actions: [], verify: [] });
    expect(agentFilesStatus(text)).toBe('valid');
    expect(parseAgentFiles('```agent-files extra\nwrite: docs/x.md\n```')).toBeNull();
    expect(agentFilesStatus('```agent-files extra\nwrite: docs/x.md\n```')).toBe('missing');
    expect(agentFilesStatus('```text\n```agent-files\nwrite: hidden.ts\n```')).toBe('missing');
    expect(parseAgentFiles('```agent-files\nwrite: docs/x.md')).toBeNull();
    expect(parseAgentFiles('plain text')).toBeNull();
  });

  it.each([
    { actions: ['edit', 'deploy'], permission: 'deny' },
    { actions: ['edit'], permission: 'allow' },
  ])('parses a leading BOM and decides $permission for $actions', ({ actions, permission }) => {
    const declaration = block(['docs/x.md'], [], actions);
    const text = `\uFEFF${declaration}`;
    expect(agentFilesStatus(text)).toBe('valid');
    expect(parseAgentFiles(text)).toEqual(parseAgentFiles(declaration));
    expect(answer(text, 'permission.handoff')).toMatchObject({ answer: permission, confidence: 1 });
    expect(record(text).handoffDigest).toBe(createHash('sha256').update(text).digest('hex'));
  });

  it.each([
    '```agent-files\nwrite: docs/x.md\nactions: edit, deploy',
    '\uFEFF~~~agent-files\nwrite: docs/x.md\nactions: edit\n```',
    '````agent-files\nwrite: docs/x.md\nactions: edit\n```',
  ])('denies an agent-files fence without a matching close: %s', text => {
    expect(agentFilesStatus(text)).toBe('invalid');
    expect(parseAgentFiles(text)).toBeNull();
    expect(answer(text, 'permission.handoff')).toMatchObject({
      answer: 'deny', confidence: 1, reasons: ['Invalid agent-files block: fix the declaration before launch.'],
    });
    expect(record(text).decisions.filter(decision => decision.question !== 'permission.handoff').every(decision => decision.answer === null)).toBe(true);
  });

  it('parses optional actions, lowercases, trims and deduplicates them', () => {
    expect(parseAgentFiles(block(['docs/x.md'], [], [' EDIT ', 'Test', 'edit', '', 'PUSH']))).toEqual({ read: [], write: ['docs/x.md'], actions: ['edit', 'test', 'push'], verify: [] });
    expect(parseAgentFiles('```agent-files\nactions: EDIT, test\nactions: edit, COMMIT\n```')).toEqual({ read: [], write: [], actions: ['edit', 'test', 'commit'], verify: [] });
  });

  it('parses multiple assertions in both modes and preserves literals verbatim', () => {
    const text = '```agent-files\nwrite: docs/x.md\nverify: docs/x.md must-contain  "quoted" `two words`  \nverify: tests/x.ts must-not-contain TODO pending\nverify: docs/x.md must-contain another\n```';
    expect(parseAgentFiles(text)?.verify).toEqual([
      { path: 'docs/x.md', mode: 'contain', literal: ' "quoted" `two words`  ' },
      { path: 'tests/x.ts', mode: 'not-contain', literal: 'TODO pending' },
      { path: 'docs/x.md', mode: 'contain', literal: 'another' },
    ]);
    expect(parseAgentFiles(block([]))?.verify).toEqual([]);
  });

  it.each([
    'verify: docs/x.md must-contain',
    'verify: docs/x.md must-contain ',
    'verify: docs/x.md contains literal',
    'verify: docs/my file.md must-contain literal',
    'verify: must-not-contain literal',
    'verify:',
    'verify: /absolute.md must-contain literal',
    'verify: C:\\absolute.md must-contain literal',
    'verify: ../outside.md must-contain literal',
  ])('invalidates the entire first block for malformed assertion %s', declaration => {
    const text = `\`\`\`agent-files\nread: .env.local\nwrite: docs/x.md\nactions: edit, deploy\n${declaration}\n\`\`\`\n${block(['valid.md'])}`;
    expect(parseAgentFiles(text)).toBeNull();
    expect(agentFilesStatus(text)).toBe('invalid');
    const decisions = record(text).decisions;
    expect(decisions.find(decision => decision.question === 'permission.handoff')).toMatchObject({
      answer: 'deny', confidence: 1, reasons: ['Invalid agent-files block: fix the declaration before launch.'],
    });
    expect(decisions.filter(decision => decision.question !== 'permission.handoff').every(decision => decision.answer === null)).toBe(true);
  });

  it('abstains on other questions even when files are supplied for an invalid block', () => {
    const text = '```agent-files\nverify: broken\n```';
    const files = parseAgentFiles(block(['.env.local'], ['lib/order-types.ts'], ['deploy']));
    const decisions = decide({ text, files, requested: requested(), policy, inFlight: [{ handoff: 'other.md', files: { read: [], write: ['.env.local'], actions: ['edit'] } }] });
    expect(decisions.map(decision => decision.answer)).toEqual([null, 'deny', null, null, null]);
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
    ['tests/agent-decision-observer.mjs', 'sensitive'],
    ['tests/agent-decision-policy.json', 'sensitive'],
    ['tests/staff-auth-preflight.mjs', 'sensitive'],
    ['tests/example-preflight-check.mjs', 'sensitive'],
    ['AGENTS.md', 'sensitive'],
    ['.github/workflows/check.yml', 'sensitive'],
    ['.gitignore', 'sensitive'],
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

  it.each([...(policy.denyPatterns as string[]), ...(policy.askPatterns as string[])])('records %s as informational with no block', pattern => {
    const text = pattern === 'write .*secret' ? 'WRITE a new SECRET' : pattern.toUpperCase();
    expect(answer(text, 'permission.handoff')).toMatchObject({ answer: null, mentions: expect.arrayContaining([pattern]), reasons: expect.arrayContaining([`mentions: ${pattern}`]) });
    expect(answer(text, 'security.sensitivity')?.answer).toBeNull();
    expect(answer(text, 'route.tier')?.answer).toBeNull();
  });

  it('asks for sensitive or restricted writes and permits docs despite prose mentions', () => {
    expect(answer(block(['app/api/orders/route.ts']), 'permission.handoff')?.answer).toBe('ask');
    expect(answer(block(['.env.local']), 'permission.handoff')?.answer).toBe('ask');
    expect(answer(block(['docs/x.md']), 'permission.handoff')?.answer).toBe('allow');
    expect(answer(`Deploy\n${block(['docs/x.md'])}`, 'permission.handoff')?.answer).toBe('allow');
    expect(answer(`Migration\n${block(['docs/x.md'])}`, 'permission.handoff')?.answer).toBe('allow');
    expect(answer(`wrangler deploy\n${block(['.env.local'])}`, 'permission.handoff')?.answer).toBe('ask');
    const text = `Scan for service_role; no deployments, no migrations.\n${block(['docs/x.md'], [], ['edit', 'test'])}`;
    expect(answer(text, 'permission.handoff')).toMatchObject({ answer: 'allow', mentions: ['service_role', 'migration', 'deploy'], reasons: expect.arrayContaining(['mentions: service_role', 'mentions: migration', 'mentions: deploy']) });
  });

  it.each(['deploy', 'hosted-db', 'secrets'])('denies declared action %s ahead of ask rules', action => {
    expect(answer(block(['.env.local'], [], ['push', action]), 'permission.handoff')?.answer).toBe('deny');
    expect(answer(block([], [], [action]), 'permission.handoff')?.answer).toBe('deny');
  });

  it.each(['migrate', 'commit', 'push', 'network'])('asks for declared action %s', action => {
    expect(answer(block(['docs/x.md'], [], [action]), 'permission.handoff')?.answer).toBe('ask');
    expect(answer(block([], [], [action]), 'permission.handoff')?.answer).toBe('ask');
  });

  it('denies a dangerous requested sandbox only when a block exists', () => {
    const launch = { ...requested(), sandbox: 'danger-full-access' };
    for (const text of [block(['docs/x.md']), block([])]) {
      expect(buildRecord({ text, policy, requested: launch }).decisions.find(decision => decision.question === 'permission.handoff')?.answer).toBe('deny');
    }
    expect(buildRecord({ text: 'No block', policy, requested: launch }).decisions.find(decision => decision.question === 'permission.handoff')?.answer).toBeNull();
  });

  it('abstains without a block but allows an empty block with no declared actions', () => {
    for (const text of ['Describe the change', 'deploy migration']) {
      expect(agentFilesStatus(text)).toBe('missing');
      expect(parseAgentFiles(text)).toBeNull();
      expect(record(text).decisions.every(decision => decision.answer === null && decision.confidence === (decision.question === 'gate.lane' ? 0.7 : 0))).toBe(true);
    }
    expect(decide({ text: '', files: null, requested: requested(), policy }).map(decision => decision.answer)).toEqual([null, null, null, null, null]);
    expect(record(block([])).decisions.map(decision => decision.answer)).toEqual([null, 'allow', null, null, { lane: 'contained', reasons: expect.any(Array) }]);
  });

  it.each([
    [block(['components/foo.tsx']), 'contained'],
    [block(['lib/x.ts']), 'wide'],
    [block(['supabase/migrations/1.sql', 'lib/x.ts']), 'closed'],
    [block(['desktop-connector/x.ts']), 'closed'],
    [block(['components/foo.tsx'], [], ['edit', 'migrate']), 'closed'],
    [block(Array.from({ length: 6 }, (_, i) => `app/${i}/page.tsx`)), 'wide'],
    [block(Array.from({ length: 5 }, (_, i) => `app/${i}/page.tsx`)), 'contained'],
    [block(['app/api/x/route.ts']), 'wide'],
    [block(['AGENTS.md']), 'wide'],
    [block(['.env.local']), 'wide'],
    [block([], ['supabase/migrations/1.sql', '.env.local'], ['test']), 'contained'],
    [block([], [], ['edit']), 'contained'],
  ])('records blast-radius lane %s as %s with typed reasons', (text, lane) => {
    const gate = answer(text, 'gate.lane');
    expect(gate).toMatchObject({ question: 'gate.lane', answer: { lane, reasons: expect.any(Array) }, confidence: lane === 'closed' ? 0.9 : 0.7 });
    expect(gate?.reasons.length).toBeGreaterThan(0);
    expect(record(text).decisions.map(decision => decision.question)).toEqual(['security.sensitivity', 'permission.handoff', 'route.tier', 'ownership.overlap', 'gate.lane']);
  });

  it.each(['migrate', 'deploy', 'hosted-db', 'secrets', 'delete'])('records action %s in the closed lane even without writes', action => {
    expect(answer(block([], [], [action]), 'gate.lane')).toMatchObject({ answer: { lane: 'closed' }, confidence: 0.9 });
  });

  it('records a null lane without a block, regardless of prose mentions', () => {
    expect(answer('migrate deploy delete lib/x.ts', 'gate.lane')).toMatchObject({ answer: null, confidence: 0.7 });
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
    expect(answer(`danger-full-access\n${block(['app/api/orders/route.ts'])}`, 'route.tier')?.answer).toBe('heavy');
  });

  it('scores tests-only writes as public and reports restricted reads separately', () => {
    const text = block(['tests/example.test.ts', 'tests/unit/agent-decision-observer.test.ts'], ['docs/AGENT-DECISION-LAYER.md', 'AGENTS.md', 'tests/pricing-release-preflight.mjs', 'tests/staff-auth-preflight.mjs', 'tests/unit/pricing-release-preflight.test.ts']);
    expect(answer(text, 'security.sensitivity')?.answer).toMatchObject({ class: 'public', score: 0.1, readClass: 'restricted', restrictedReads: ['tests/pricing-release-preflight.mjs'] });
    expect(answer(text, 'permission.handoff')?.answer).toBe('allow');
    expect(answer(text, 'route.tier', 'standard')?.answer).toBe('standard');
    expect(answer(block(['tests/example.test.ts']), 'security.sensitivity')?.answer).toMatchObject({ class: 'public', score: 0.1, readClass: null, restrictedReads: [] });
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
      { handoff: 'other.decisions.json', files: { read: ['docs/x.md'], write: ['components\\page-header.tsx'], actions: [] } },
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
    expect(built).toMatchObject({ schema: 'jev.decision/v2', policyVersion: '2026-10-12.3', createdAt: '2026-10-11T00:00:00.000Z', observedOnly: true, actionTaken: 'launched-unchanged', attempt: 1, requested: requested() });
    expect(built.decisions.every(decision => decision.confidence >= 0 && decision.confidence <= 1)).toBe(true);
  });

  it('captures v2 assertions and SHA-256 write digests relative to the supplied repo', () => {
    const folder = tempFolder();
    const content = Buffer.from([0, 1, 255, 10]);
    writeFileSync(resolve(folder, 'existing.bin'), content);
    const text = '```agent-files\nwrite: existing.bin, missing.txt\nverify: existing.bin must-not-contain unfinished\nactions: edit\n```';
    const built = buildRecord({ text, policy, requested: requested(), repo: folder });
    expect(built).toMatchObject({ schema: 'jev.decision/v2', verify: [{ path: 'existing.bin', mode: 'not-contain', literal: 'unfinished' }] });
    expect(built.writeDigests).toEqual({ 'existing.bin': createHash('sha256').update(content).digest('hex'), 'missing.txt': null });
    expect(record('No block')).toMatchObject({ verify: [], writeDigests: {} });
    const defaultRoot = record(block(['tests/agent-decision-policy.json']));
    expect(defaultRoot.writeDigests?.['tests/agent-decision-policy.json']).toBe(createHash('sha256').update(readFileSync(new URL('../agent-decision-policy.json', import.meta.url))).digest('hex'));
  });

  it('summarizes non-null tier agreement, review counts, abstained runs and requested-tier outcomes', () => {
    const good = record(block(['docs/x.md']));
    good.outcome = { exitCode: 0, seconds: 2, tokens: '10' };
    const ask = record(block(['app/api/orders/route.ts']), 'standard');
    ask.outcome = { exitCode: 1, seconds: 4 };
    const denied = record(block([], [], ['deploy']), 'heavy');
    const summary = summarize([good, ask, denied]);
    expect(summary).toMatchObject({ runs: 3, tierAgreementRate: 0.5, wouldAsk: 1, wouldDeny: 1, abstained: 1 });
    expect(summary.outcomesByTier.light).toEqual({ runs: 1, completed: 1, succeeded: 1, failed: 0, seconds: 2, verified: 0, passed: 0, escalated: 0 });
    expect(summary.outcomesByTier.standard).toEqual({ runs: 1, completed: 1, succeeded: 0, failed: 1, seconds: 4, verified: 0, passed: 0, escalated: 0 });
    expect(summary.restrictedReadRuns).toBe(0);
    expect(summarize([])).toMatchObject({ runs: 0, tierAgreementRate: null, abstained: 0, restrictedReadRuns: 0, resumedRuns: 0 });
  });

  it('counts refused runs and verification verdicts independently of exit success', () => {
    const passed = record(block(['docs/x.md']));
    passed.outcome = { exitCode: 0, seconds: 1 };
    passed.verification = { checks: [], verdict: 'pass', suggestedTier: null };
    const escalated = record(block(['docs/y.md']));
    escalated.outcome = { exitCode: 0, seconds: 2 };
    escalated.verification = { checks: [{ id: 'writes.unchanged', fired: true, reason: 'unchanged' }], verdict: 'escalate', suggestedTier: 'standard' };
    const refused = record(block([], [], ['deploy']), 'heavy');
    refused.actionTaken = 'refused';
    expect(summarize([passed, escalated, refused])).toMatchObject({ refused: 1, outcomesByTier: {
      light: { runs: 2, succeeded: 2, verified: 2, passed: 1, escalated: 1 },
      standard: { verified: 0, passed: 0, escalated: 0 },
      heavy: { runs: 1, completed: 0, verified: 0, passed: 0, escalated: 0 },
    } });
    expect(summarize([]).refused).toBe(0);
  });

  it('counts restricted-read runs once each, including reads-only records', () => {
    const mixed = record(block(['tests/x.ts'], ['.env.local', 'tests/pricing-release-preflight.mjs']));
    const readsOnly = record(block([], ['supabase/migration-history-map.json']));
    const ordinary = record(block(['docs/x.md'], ['components/page-header.tsx']));
    const noFiles = record('No declarations');
    expect(summarize([mixed, readsOnly, ordinary, noFiles])).toMatchObject({ runs: 4, restrictedReadRuns: 2 });
  });

  it('summarizes only current records while counting all saved history entries', () => {
    const previous = record(block(['app/api/orders/route.ts']), 'heavy');
    previous.outcome = { exitCode: 1, seconds: 10 };
    const current = record(block(['docs/x.md']));
    current.history = [previous, previous];
    expect(summarize([current])).toMatchObject({ runs: 1, resumedRuns: 2, wouldAsk: 0, wouldDeny: 0, tierAgreementRate: 1, outcomesByTier: { heavy: { runs: 0, completed: 0, seconds: 0 } } });
  });

  it('counts each current lane, including null answers and records without a lane decision', () => {
    const contained = record(block(['components/foo.tsx']));
    const wide = record(block(['lib/x.ts']));
    const closed = record(block(['supabase/migrations/1.sql']));
    const noBlock = record('No declarations');
    const legacy = record(block(['docs/x.md']));
    legacy.decisions = legacy.decisions.filter(decision => decision.question !== 'gate.lane');
    contained.history = [wide, closed];
    expect(summarize([contained, wide, closed, noBlock, legacy]).lanes).toEqual({ contained: 1, wide: 1, closed: 1, null: 2 });
    expect(summarize([]).lanes).toEqual({ contained: 0, wide: 0, closed: 0, null: 0 });
  });
});

describe('fail-open observer CLI', () => {
  it.each([
    { name: 'BOM-prefixed deploy', text: `\uFEFF${block(['result.txt'], [], ['edit', 'deploy'])}`, status: 'valid' },
    { name: 'malformed assertion', text: '```agent-files\nwrite: result.txt\nactions: edit, deploy\nverify: result.txt contains finished\n```', status: 'invalid' },
    { name: 'unterminated fence', text: '```agent-files\nwrite: result.txt\nactions: edit', status: 'invalid' },
  ])('refuses $name through existing enforcement', ({ text, status }) => {
    expect(agentFilesStatus(text)).toBe(status);
    const fixture = runFixture(text);
    const observed = fixture.observe();
    expect(observed.status).toBe(0);
    expect(observed.stdout).toContain('permission=deny');
    expect(observed.stdout).not.toContain('jev gate:');
    expect(fixture.saved()).toMatchObject({ observedOnly: true, actionTaken: 'launched-unchanged' });
    const enforced = fixture.observe('--enforce');
    expect(enforced.status).toBe(3);
    expect(enforced.stderr).toBe('');
    expect(enforced.stdout).toContain('jev gate: DENY');
    const saved = fixture.saved();
    expect(saved).toMatchObject({ observedOnly: false, actionTaken: 'refused' });
    if (status === 'invalid') {
      expect(saved.decisions.find((decision: { question: string }) => decision.question === 'permission.handoff')).toMatchObject({
        answer: 'deny', confidence: 1, reasons: ['Invalid agent-files block: fix the declaration before launch.'],
      });
      expect(saved.decisions.filter((decision: { question: string }) => decision.question !== 'permission.handoff').every((decision: { answer: unknown }) => decision.answer === null)).toBe(true);
    }
  });

  it('allows a BOM-prefixed edit block with --enforce', () => {
    const fixture = runFixture(`\uFEFF${block(['result.txt'], [], ['edit'])}`);
    const result = fixture.observe('--enforce');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('permission=allow');
    expect(result.stdout).not.toContain('jev gate:');
    expect(fixture.saved()).toMatchObject({ observedOnly: false, actionTaken: 'launched-unchanged' });
  });

  it('prints the lane, including null, without enforcing closed lanes', () => {
    const missingBlock = runFixture('No declarations');
    expect(missingBlock.observe().stdout.trim()).toMatch(/ lane=null$/);
    const closed = runFixture(block([], [], ['migrate']));
    const result = closed.observe('--enforce');
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/ lane=closed$/);
    expect(closed.saved()).toMatchObject({ actionTaken: 'launched-unchanged' });
  });

  it.each([2, 3, 4])('suggests the expected tier for a failing assertion on attempt %i', attempt => {
    const fixture = runFixture('```agent-files\nactions: test\nverify: missing.txt must-contain finished\n```');
    for (let index = 1; index <= attempt; index++) {
      expect(fixture.observe('--resume').status).toBe(0);
      expect(fixture.saved().attempt).toBe(index);
      expect(fixture.saved().history).toHaveLength(index - 1);
      const result = fixture.outcome();
      expect(result.status).toBe(0);
      if (index >= 3) {
        expect(result.stdout.trim()).toBe('jev verify: ESCALATE -> conductor (attempt cap; assert.1)');
        expect(fixture.saved().verification).toMatchObject({ verdict: 'escalate', suggestedTier: 'conductor', capReason: 'attempt cap: re-plan this unit' });
      } else {
        expect(result.stdout.trim()).toBe('jev verify: ESCALATE -> standard (assert.1)');
        expect(fixture.saved().verification).toMatchObject({ verdict: 'escalate', suggestedTier: 'standard' });
        expect(fixture.saved().verification).not.toHaveProperty('capReason');
      }
    }
  }, 30000);

  it('does not cap a passing verification on attempt three', () => {
    const fixture = runFixture('```agent-files\nactions: test\nverify: result.txt must-contain finished\n```');
    for (let index = 0; index < 3; index++) expect(fixture.observe().status).toBe(0);
    writeFileSync(resolve(fixture.folder, 'result.txt'), 'finished');
    expect(fixture.outcome().stdout.trim()).toBe('jev verify: pass');
    expect(fixture.saved()).toMatchObject({ attempt: 3, verification: { verdict: 'pass', suggestedTier: null } });
    expect(fixture.saved().verification).not.toHaveProperty('capReason');
  }, 30000);

  it.each(['custom', 'absent', 'corrupt', 'missing'])('loads the outcome attempt cap with a %s policy', variant => {
    const fixture = runFixture('```agent-files\nactions: test\nverify: missing.txt must-contain finished\n```');
    for (let index = 0; index < 3; index++) expect(fixture.observe().status).toBe(0);
    const copy = resolve(fixture.folder, 'observer.mjs');
    writeFileSync(copy, readFileSync(modulePath));
    const policyPath = resolve(fixture.folder, 'agent-decision-policy.json');
    if (variant === 'custom') writeFileSync(policyPath, JSON.stringify({ ...policy, lanes: { ...policy.lanes, maxAttempts: 4 } }));
    if (variant === 'absent') writeFileSync(policyPath, JSON.stringify({ ...policy, lanes: undefined }));
    if (variant === 'corrupt') writeFileSync(policyPath, '{ corrupt');
    const result = spawnSync(process.execPath, [copy, 'outcome', '--handoff', fixture.handoff, '--exit', '0', '--seconds', '1', '--repo', fixture.folder], { encoding: 'utf8', env: { ...process.env, TEMP: tmpRoot, TMP: tmpRoot } });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    if (variant === 'custom') {
      expect(result.stdout.trim()).toBe('jev verify: ESCALATE -> standard (assert.1)');
      expect(fixture.saved().verification).not.toHaveProperty('capReason');
    } else {
      expect(result.stdout.trim()).toBe('jev verify: ESCALATE -> conductor (attempt cap; assert.1)');
      expect(fixture.saved().verification.capReason).toBe('attempt cap: re-plan this unit');
    }
  }, 30000);

  it('refuses typed deny only with --enforce and saves the action before exiting 3', () => {
    const fixture = runFixture(block([], [], ['deploy']));
    const observed = fixture.observe();
    expect(observed.status).toBe(0);
    expect(observed.stdout).not.toContain('jev gate:');
    expect(fixture.saved()).toMatchObject({ observedOnly: true, actionTaken: 'launched-unchanged' });
    const enforced = fixture.observe('--enforce');
    expect(enforced.status).toBe(3);
    expect(enforced.stderr).toBe('');
    expect(enforced.stdout.trim().split(/\r?\n/).at(-1)).toBe('jev gate: DENY — launch refused (Deny action declared.; mentions: deploy)');
    expect(fixture.saved()).toMatchObject({ observedOnly: false, actionTaken: 'refused' });
    expect(JSON.parse(cli('summary', fixture.folder).stdout).refused).toBe(1);
  });

  it.each([['push', 'ask'], ['test', 'allow']])('keeps %s recorded only with --enforce', (action, permission) => {
    const fixture = runFixture(block(['result.txt'], [], [action]));
    const result = fixture.observe('--enforce');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`permission=${permission}`);
    expect(result.stdout).not.toContain('jev gate:');
    expect(fixture.saved()).toMatchObject({ observedOnly: false, actionTaken: 'launched-unchanged' });
  });

  it.each(['record', 'REFUSE', '', null])('only the exact policy value refuse enables denial (%s)', deny => {
    const fixture = runFixture(block([], [], ['deploy']));
    const copy = resolve(fixture.folder, 'observer.mjs');
    writeFileSync(copy, readFileSync(modulePath));
    const customPolicy = { ...policy, enforcement: { ...policy.enforcement, deny } };
    writeFileSync(resolve(fixture.folder, 'agent-decision-policy.json'), JSON.stringify(customPolicy));
    const result = spawnSync(process.execPath, [copy, 'observe', '--handoff', fixture.handoff, '--tier', 'light', '--effort', 'low', '--sandbox', 'read-only', '--enforce'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('permission=deny');
    expect(fixture.saved()).toMatchObject({ observedOnly: false, actionTaken: 'launched-unchanged' });
  });

  it('fails open with --enforce for a corrupt policy or missing handoff', () => {
    const fixture = runFixture(block([], [], ['deploy']));
    const copy = resolve(fixture.folder, 'observer.mjs');
    writeFileSync(copy, readFileSync(modulePath));
    writeFileSync(resolve(fixture.folder, 'agent-decision-policy.json'), '{ corrupt');
    const corrupt = spawnSync(process.execPath, [copy, 'observe', '--handoff', fixture.handoff, '--tier', 'light', '--effort', 'low', '--sandbox', 'read-only', '--enforce'], { encoding: 'utf8' });
    const missing = cli('observe', '--handoff', resolve(fixture.folder, 'missing.md'), '--tier', 'light', '--effort', 'low', '--sandbox', 'read-only', '--enforce');
    for (const result of [corrupt, missing]) {
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('jev observe: skipped (');
      expect(result.stdout).not.toContain('jev gate:');
      expect(result.stderr).toBe('');
    }
    expect(readdirSync(fixture.folder)).not.toContain('run.decisions.json');
  });

  it('escalates exit-zero unchanged edit writes, including files missing before and after', () => {
    const fixture = runFixture(block(['result.txt', 'missing.txt'], [], ['edit']));
    writeFileSync(resolve(fixture.folder, 'result.txt'), 'before');
    expect(fixture.observe().status).toBe(0);
    const result = fixture.outcome();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('jev verify: ESCALATE -> standard (writes.unchanged)');
    expect(fixture.saved().verification).toMatchObject({ verdict: 'escalate', suggestedTier: 'standard', checks: [
      { id: 'exit.nonzero', fired: false, reason: expect.any(String) },
      { id: 'writes.unchanged', fired: true, reason: expect.any(String) },
    ] });
  });

  it('escalates a changed file that fails must-not-contain', () => {
    const fixture = runFixture('```agent-files\nwrite: result.txt\nactions: edit\nverify: result.txt must-not-contain TODO `unfinished work`\n```');
    writeFileSync(resolve(fixture.folder, 'result.txt'), 'before');
    expect(fixture.observe().status).toBe(0);
    writeFileSync(resolve(fixture.folder, 'result.txt'), 'after TODO `unfinished work`');
    const result = fixture.outcome();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('jev verify: ESCALATE -> standard (assert.1)');
    expect(fixture.saved().verification.checks.map((check: { id: string, fired: boolean }) => [check.id, check.fired])).toEqual([
      ['exit.nonzero', false], ['writes.unchanged', false], ['assert.1', true],
    ]);
  });

  it('passes changed writes and satisfied assertions, including a missing must-not-contain file', () => {
    const fixture = runFixture('```agent-files\nwrite: result.txt, missing.txt\nactions: edit\nverify: result.txt must-contain finished\nverify: missing.txt must-not-contain TODO\n```');
    writeFileSync(resolve(fixture.folder, 'result.txt'), 'before');
    expect(fixture.observe().status).toBe(0);
    writeFileSync(resolve(fixture.folder, 'result.txt'), 'finished');
    const result = fixture.outcome();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('jev verify: pass');
    const verification = fixture.saved().verification;
    expect(verification).toMatchObject({ verdict: 'pass', suggestedTier: null });
    expect(verification.checks.map((check: { id: string, fired: boolean }) => [check.id, check.fired])).toEqual([
      ['exit.nonzero', false], ['writes.unchanged', false], ['assert.1', false], ['assert.2', false],
    ]);
    expect(JSON.parse(cli('summary', fixture.folder).stdout)).toMatchObject({ outcomesByTier: { light: { verified: 1, passed: 1, escalated: 0 } } });
  });

  it.each(['light', 'standard', 'heavy'] as Tier[])('combines fired checks in order and escalates from %s', tier => {
    const fixture = runFixture('```agent-files\nwrite: missing.txt\nactions: edit\nverify: missing.txt must-contain finished\n```', tier);
    expect(fixture.observe().status).toBe(0);
    const result = cli('outcome', '--handoff', fixture.handoff, '--exit', '2', '--seconds', '1', '--repo', fixture.folder);
    const next = tier === 'light' ? 'standard' : tier === 'standard' ? 'heavy' : 'conductor';
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(`jev verify: ESCALATE -> ${next} (exit.nonzero, writes.unchanged, assert.1)`);
    expect(fixture.saved().verification).toMatchObject({ verdict: 'escalate', suggestedTier: next });
  });

  it.each([{ actions: ['edit'] }, { actions: ['test'] }, { actions: [] }])('does not fire unchanged writes for empty write sets or non-edit actions $actions', ({ actions }) => {
    const fixture = runFixture(block(actions.includes('edit') ? [] : ['result.txt'], [], actions));
    expect(fixture.observe().status).toBe(0);
    expect(fixture.outcome().stdout.trim()).toBe('jev verify: pass');
  });

  it('reads v1 records without digest checks and includes them in summary and history', () => {
    const fixture = runFixture(block(['missing.txt'], [], ['edit']));
    expect(fixture.observe().status).toBe(0);
    const legacy = fixture.saved();
    legacy.schema = 'jev.decision/v1';
    delete legacy.writeDigests;
    delete legacy.verify;
    delete legacy.files.verify;
    writeFileSync(fixture.output, JSON.stringify(legacy));
    const result = fixture.outcome();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('jev verify: pass');
    expect(fixture.saved().verification.checks).toEqual([{ id: 'exit.nonzero', fired: false, reason: expect.any(String) }]);
    expect(JSON.parse(cli('summary', fixture.folder).stdout)).toMatchObject({ runs: 1, skippedRecords: 0, outcomesByTier: { light: { verified: 1, passed: 1 } } });
    expect(fixture.observe().status).toBe(0);
    expect(fixture.saved().history[0].schema).toBe('jev.decision/v1');
  });

  it('records distinct lowercase report mentions without changing a passing verdict', () => {
    const fixture = runFixture(block([], [], ['test']));
    expect(fixture.observe().status).toBe(0);
    const report = resolve(fixture.folder, 'report.md');
    writeFileSync(report, 'INCOMPLETE incomplete. Could Not finish; UNABLE TO test; not done. Remain unchanged; remains incomplete.');
    const result = fixture.outcome('--report', report);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('jev verify: pass');
    expect(fixture.saved().verification).toMatchObject({ verdict: 'pass', suggestedTier: null, reportMentions: [
      'incomplete', 'could not', 'unable to', 'not done', 'remain unchanged', 'remains incomplete',
    ] });
    const unreadable = fixture.outcome('--report', resolve(fixture.folder, 'missing-report.md'));
    expect(unreadable.status).toBe(0);
    expect(unreadable.stdout.trim()).toBe('jev verify: pass');
    expect(fixture.saved().verification).not.toHaveProperty('reportMentions');
  });

  it('fails open for malformed outcome records while preserving the saved outcome on verification errors', () => {
    const fixture = runFixture(block(['result.txt'], [], ['edit']));
    expect(fixture.observe().status).toBe(0);
    mkdirSync(resolve(fixture.folder, 'result.txt'));
    const result = fixture.outcome();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('jev observe: skipped (');
    expect(fixture.saved().outcome).toEqual({ exitCode: 0, seconds: 1 });
    writeFileSync(fixture.output, '{ corrupt');
    expect(fixture.outcome().stdout).toContain('jev observe: skipped (');
  });

  it('writes only its adjacent record, adds outcomes, and summarizes', () => {
    const folder = tempFolder();
    const handoff = resolve(folder, 'sample.handoff.md');
    const text = `Private sentinel CLI-589746\n${block(['tests/example.test.ts'])}`;
    writeFileSync(handoff, text);
    const result = cli('observe', '--handoff', handoff, '--tier', 'light', '--effort', 'medium', '--sandbox', 'workspace-write', '--network', '--resume');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('jev observe: sensitivity=public permission=allow tier=light/light agrees=true overlap=0 lane=contained');
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
    expect(readdirSync(folder)).toEqual([]);
  }, 30000);

  it('records failed outcomes with an empty tokens value', () => {
    const folder = tempFolder();
    const handoff = resolve(folder, 'empty-tokens.md');
    writeFileSync(handoff, block(['docs/x.md']));
    cli('observe', '--handoff', handoff, '--tier', 'light', '--effort', 'low', '--sandbox', 'read-only');
    const result = cli('outcome', '--handoff', handoff, '--exit', '1', '--seconds', '0', '--tokens', '');
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('skipped');
    expect(JSON.parse(readFileSync(resolve(folder, 'empty-tokens.decisions.json'), 'utf8')).outcome).toEqual({ exitCode: 1, seconds: 0, tokens: '' });
    expect(cli('outcome', '--handoff', handoff, '--exit', '', '--seconds', '0').stdout).toContain('skipped');
  });

  it('re-observes with newest-first flat history capped at ten entries', () => {
    const folder = tempFolder();
    const handoff = resolve(folder, 'resumed.md');
    const output = resolve(folder, 'resumed.decisions.json');
    const firstText = block(['docs/first.md']);
    writeFileSync(handoff, firstText);
    const observe = () => cli('observe', '--handoff', handoff, '--tier', 'light', '--effort', 'low', '--sandbox', 'read-only', '--resume');
    expect(observe().stdout).not.toContain('skipped');
    cli('outcome', '--handoff', handoff, '--exit', '1', '--seconds', '2', '--tokens', '');
    const first = JSON.parse(readFileSync(output, 'utf8'));
    expect(first.attempt).toBe(1);
    writeFileSync(handoff, block(['docs/second.md']));
    expect(observe().stdout).not.toContain('skipped');
    const second = JSON.parse(readFileSync(output, 'utf8'));
    expect(second.attempt).toBe(2);
    expect(second.outcome).toBeUndefined();
    expect(second.history).toHaveLength(1);
    expect(second.history[0]).toMatchObject({ handoffDigest: first.handoffDigest, outcome: { exitCode: 1, seconds: 2, tokens: '' } });
    expect(second.history[0]).not.toHaveProperty('history');
    expect(observe().stdout).not.toContain('skipped');
    const third = JSON.parse(readFileSync(output, 'utf8'));
    expect(third.attempt).toBe(3);
    expect(third.history).toHaveLength(2);
    expect(third.history[0].handoffDigest).toBe(second.handoffDigest);
    expect(third.history[1].handoffDigest).toBe(first.handoffDigest);
    third.history = Array.from({ length: 10 }, (_, index) => ({ ...third.history[0], createdAt: `saved-${index}` }));
    writeFileSync(output, JSON.stringify(third));
    expect(observe().stdout).not.toContain('skipped');
    const fourth = JSON.parse(readFileSync(output, 'utf8'));
    expect(fourth.attempt).toBe(11);
    expect(fourth.history).toHaveLength(10);
    expect(fourth.history[0].createdAt).toBe(third.createdAt);
    expect(fourth.history[1].createdAt).toBe('saved-0');
    expect(fourth.history[9].createdAt).toBe('saved-8');
    expect(fourth.history.every((entry: Record<string, unknown>) => !('history' in entry))).toBe(true);
    expect(JSON.parse(cli('summary', folder).stdout)).toMatchObject({ runs: 1, resumedRuns: 10, skippedRecords: 0 });
  }, 30000);

  it('skips corrupt and different-schema records without disabling observe or summary', () => {
    const folder = tempFolder();
    const handoff = resolve(folder, 'valid.md');
    const broken = resolve(folder, 'broken.decisions.json');
    const foreign = resolve(folder, 'foreign.decisions.json');
    const brokenText = '{ malformed secret sentinel';
    writeFileSync(broken, brokenText);
    writeFileSync(foreign, JSON.stringify({ schema: 'other/v1' }));
    writeFileSync(handoff, block(['docs/x.md']));
    const result = cli('observe', '--handoff', handoff, '--tier', 'light', '--effort', 'low', '--sandbox', 'read-only');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('permission=allow');
    const summary = cli('summary', folder);
    expect(summary.status).toBe(0);
    expect(summary.stdout).not.toContain('sentinel');
    expect(JSON.parse(summary.stdout)).toMatchObject({ runs: 1, skippedRecords: 2 });
    expect(readFileSync(broken, 'utf8')).toBe(brokenText);
    expect(readdirSync(folder).sort()).toEqual(['broken.decisions.json', 'foreign.decisions.json', 'valid.decisions.json', 'valid.md']);
  });
});
