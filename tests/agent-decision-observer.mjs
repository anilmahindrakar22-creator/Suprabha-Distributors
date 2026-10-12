import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @typedef {'public' | 'app' | 'sensitive' | 'restricted'} Sensitivity */
/** @typedef {'light' | 'standard' | 'heavy'} Tier */
/** @typedef {{ read: string[], write: string[], actions: string[] }} Files */
/** @typedef {{ policyVersion: string, classes: Record<Sensitivity, string[]>, scores: Record<Sensitivity, number>, denyPatterns: string[], askPatterns: string[], logicKeywords: string[] }} Policy */
/** @typedef {{ tier: Tier, effort: string, sandbox: string, network: boolean, resume: boolean }} Requested */
/** @typedef {{ path: string, class: Sensitivity, rule: string, kind: 'read' | 'write' }} Match */
/** @typedef {{ handoff: string, files: Files }} InFlight */
/** @typedef {{ question: 'security.sensitivity', answer: { class: Sensitivity, score: number, readClass: Sensitivity | null, restrictedReads: string[], matches: Match[] } | null, confidence: number, reasons: string[] }} SecurityDecision */
/** @typedef {{ question: 'permission.handoff', answer: 'allow' | 'ask' | 'deny' | null, confidence: number, reasons: string[], mentions: string[] }} PermissionDecision */
/** @typedef {{ question: 'route.tier', answer: Tier | null, requested: Tier, agrees: boolean, confidence: number, reasons: string[] }} TierDecision */
/** @typedef {{ question: 'ownership.overlap', answer: { overlapping: { path: string, handoff: string }[] } | null, confidence: number, reasons: string[] }} OwnershipDecision */
/** @typedef {SecurityDecision | PermissionDecision | TierDecision | OwnershipDecision} Decision */
/** @typedef {{ exitCode: number, seconds: number, tokens?: string }} Outcome */
/** @typedef {{ schema: 'jev.decision/v1', policyVersion: string, createdAt: string, handoffDigest: string, files: Files, requested: Requested, decisions: Decision[], observedOnly: true, actionTaken: 'launched-unchanged', outcome?: Outcome, history?: Omit<DecisionRecord, 'history'>[] }} DecisionRecord */

/** @param {string} path */
const normalizePath = path => path.trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');

/** @param {string} text @returns {Files | null} */
export function parseAgentFiles(text) {
  const lines = text.split(/\r?\n/);
  let fence = null;
  let selected = false;
  /** @type {Files} */
  const files = { read: [], write: [], actions: [] };
  for (const line of lines) {
    if (!fence) {
      const opening = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(line);
      if (!opening) continue;
      fence = opening[1];
      selected = opening[2].trim() === 'agent-files';
      continue;
    }
    const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
    if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) {
      if (selected) return files;
      fence = null;
      continue;
    }
    if (!selected) continue;
    const declaration = /^\s*(read|write|actions):\s*(.*)$/.exec(line);
    if (!declaration) continue;
    const key = /** @type {keyof Files} */ (declaration[1]);
    const values = declaration[2].split(',').map(value => key === 'actions' ? value.trim().toLowerCase() : normalizePath(value)).filter(Boolean);
    files[key] = [...new Set([...files[key], ...values])];
  }
  return null;
}

/** @param {string} glob @param {string} path */
function matchesGlob(glob, path) {
  let source = '^';
  for (let i = 0; i < glob.length; i++) {
    if (glob[i] === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') {
        source += '(?:.*/)?';
        i++;
      } else source += '.*';
    } else if (glob[i] === '*') source += '[^/]*';
    else source += glob[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${source}$`).test(path);
}

/** @param {string} path @param {Policy} policy @returns {{ class: Sensitivity, rule: string }} */
export function classifyPath(path, policy) {
  /** @type {Sensitivity[]} */
  const classes = ['restricted', 'sensitive', 'app', 'public'];
  for (const classification of classes) {
    for (const rule of policy.classes[classification]) {
      if (matchesGlob(rule, normalizePath(path))) return { class: classification, rule };
    }
  }
  return { class: 'app', rule: 'default' };
}

/** @param {string[]} patterns @param {string} text */
const mentions = (patterns, text) => patterns.some(pattern => new RegExp(pattern, 'i').test(text));

/**
 * @param {{ text: string, files: Files | null, requested: Requested, policy: Policy, inFlight?: InFlight[] }} input
 * @returns {Decision[]}
 */
export function decide({ text, files, requested, policy, inFlight = [] }) {
  /** @param {string[]} paths @param {'read' | 'write'} kind @returns {Match[]} */
  const matchFiles = (paths, kind) => [...new Set(paths)].map(path => ({ path, ...classifyPath(path, policy), kind }));
  const readMatches = matchFiles(files?.read ?? [], 'read');
  const writeMatches = matchFiles(files?.write ?? [], 'write');
  const matches = [...readMatches, ...writeMatches];
  /** @param {Match[]} candidates */
  const maximum = candidates => candidates.reduce((best, match) => !best || policy.scores[match.class] > policy.scores[best.class] ? match : best, /** @type {Match | null} */ (null));
  const strongestRead = maximum(readMatches);
  const strongest = maximum(writeMatches) ?? strongestRead;
  const writeClasses = writeMatches.map(match => match.class);
  const sensitiveWrites = writeClasses.some(value => value === 'restricted' || value === 'sensitive');
  /** @type {SecurityDecision} */
  const security = {
    question: 'security.sensitivity',
    answer: strongest ? {
      class: strongest.class, score: policy.scores[strongest.class],
      readClass: strongestRead?.class ?? null,
      restrictedReads: readMatches.filter(match => match.class === 'restricted').map(match => match.path),
      matches,
    } : null,
    confidence: strongest ? 1 : 0,
    reasons: [strongest ? writeMatches.length ? 'Maximum declared write sensitivity.' : 'no writes declared; classified by reads' : 'No declared files.'],
  };
  /** @type {PermissionDecision} */
  const permission = {
    question: 'permission.handoff', answer: null, confidence: 0, reasons: ['No declared agent-files block.'],
    mentions: [...new Set([...policy.denyPatterns, ...policy.askPatterns])].filter(pattern => mentions([pattern], text)),
  };
  if (files) {
    const actions = files.actions ?? [];
    const denyAction = actions.some(action => ['deploy', 'hosted-db', 'secrets'].includes(action));
    const dangerousSandbox = requested.sandbox === 'danger-full-access';
    const askAction = actions.some(action => ['migrate', 'commit', 'push', 'network'].includes(action));
    Object.assign(permission, {
      answer: denyAction || dangerousSandbox ? 'deny' : sensitiveWrites || askAction ? 'ask' : 'allow', confidence: 1,
      reasons: [denyAction ? 'Deny action declared.' : dangerousSandbox ? 'Dangerous sandbox requested.' : sensitiveWrites ? 'Sensitive or restricted write declared.' : askAction ? 'Review action declared.' : 'No permission rule requires review.'],
    });
  }
  permission.reasons.push(...permission.mentions.map(pattern => `mentions: ${pattern}`));
  /** @type {TierDecision} */
  const tier = { question: 'route.tier', answer: null, requested: requested.tier, agrees: false, confidence: 0, reasons: ['No tier rule matches the declared files.'] };
  if (strongest && files) {
    const count = files.write.length;
    if ((permission.answer === 'ask' && sensitiveWrites) || (count > 5 && writeClasses.includes('sensitive'))) {
      tier.answer = 'heavy';
      tier.reasons = ['Sensitive write review or more than five writes touching sensitive files.'];
    } else if ((count >= 2 && count <= 5) || (strongest.class === 'app' && mentions(policy.logicKeywords, text))) {
      tier.answer = 'standard';
      tier.reasons = ['Two to five writes or app logic keywords.'];
    } else if (count === 1 && (strongest.class === 'public' || strongest.class === 'app')) {
      tier.answer = 'light';
      tier.reasons = ['Single public or app write.'];
    }
  }
  tier.confidence = tier.answer ? 1 : 0;
  tier.agrees = tier.answer !== null && tier.answer === requested.tier;
  /** @type {OwnershipDecision} */
  const ownership = { question: 'ownership.overlap', answer: null, confidence: 0, reasons: ['No declared write files.'] };
  if (files?.write.length) {
    const overlapping = inFlight.flatMap(record => [...new Set(files.write)].filter(path => record.files.write.map(normalizePath).includes(normalizePath(path))).map(path => ({ path, handoff: record.handoff })));
    Object.assign(ownership, { answer: { overlapping }, confidence: 1, reasons: ['Compared declared writes with in-flight records.'] });
  }
  return [security, permission, tier, ownership];
}

/**
 * @param {{ text: string, requested: Requested, policy: Policy, inFlight?: InFlight[], now?: Date | string }} input
 * @returns {DecisionRecord}
 */
export function buildRecord({ text, requested, policy, inFlight = [], now = new Date() }) {
  const files = parseAgentFiles(text);
  return {
    schema: 'jev.decision/v1', policyVersion: policy.policyVersion,
    createdAt: new Date(now).toISOString(),
    handoffDigest: createHash('sha256').update(text, 'utf8').digest('hex'),
    files: files ?? { read: [], write: [], actions: [] }, requested: { ...requested },
    decisions: decide({ text, files, requested, policy, inFlight }),
    observedOnly: true, actionTaken: 'launched-unchanged',
  };
}

/** @param {DecisionRecord[]} records */
export function summarize(records) {
  let compared = 0;
  let agreed = 0;
  let wouldAsk = 0;
  let wouldDeny = 0;
  let restrictedReadRuns = 0;
  let resumedRuns = 0;
  // Abstained counts runs with at least one null answer.
  let abstained = 0;
  const empty = () => ({ runs: 0, completed: 0, succeeded: 0, failed: 0, seconds: 0 });
  const outcomesByTier = { light: empty(), standard: empty(), heavy: empty() };
  for (const record of records) {
    resumedRuns += record.history?.length ?? 0;
    for (const decision of record.decisions) {
      if (decision.question === 'route.tier' && decision.answer !== null) {
        compared++;
        if (decision.agrees) agreed++;
      }
      if (decision.question === 'permission.handoff') {
        if (decision.answer === 'ask') wouldAsk++;
        if (decision.answer === 'deny') wouldDeny++;
      }
    }
    if (record.decisions.some(decision => decision.answer === null)) abstained++;
    if (record.decisions.some(decision => decision.question === 'security.sensitivity' && decision.answer?.restrictedReads?.length)) restrictedReadRuns++;
    const bucket = outcomesByTier[record.requested.tier];
    bucket.runs++;
    if (record.outcome) {
      bucket.completed++;
      bucket.seconds += record.outcome.seconds;
      if (record.outcome.exitCode === 0) bucket.succeeded++;
      else bucket.failed++;
    }
  }
  return { runs: records.length, tierAgreementRate: compared ? agreed / compared : null, wouldAsk, wouldDeny, abstained, restrictedReadRuns, resumedRuns, outcomesByTier };
}

/** @param {string} handoff */
function recordPath(handoff) {
  const absolute = resolve(handoff);
  return resolve(dirname(absolute), `${basename(absolute, extname(absolute))}.decisions.json`);
}

/** @param {string[]} args @param {string[]} valued @param {string[]} flags */
function parseOptions(args, valued, flags = []) {
  /** @type {Record<string, string | boolean>} */
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key in options) throw new Error('arguments');
    if (flags.includes(key)) options[key] = true;
    else if (valued.includes(key)) {
      const value = args[++index];
      if (value === undefined || (value === '' && key !== '--tokens') || value.startsWith('--')) throw new Error('arguments');
      options[key] = value;
    } else throw new Error('arguments');
  }
  for (const key of valued.filter(key => key !== '--tokens')) {
    if (!(key in options)) throw new Error('arguments');
  }
  return options;
}

/** @param {string} directory @returns {{ records: { path: string, record: DecisionRecord }[], skippedRecords: number }} */
function readRecords(directory) {
  /** @type {{ path: string, record: DecisionRecord }[]} */
  const records = [];
  let skippedRecords = 0;
  for (const name of readdirSync(directory).filter(name => name.endsWith('.decisions.json'))) {
    const path = resolve(directory, name);
    try {
      const record = JSON.parse(readFileSync(path, 'utf8'));
      if (record?.schema !== 'jev.decision/v1' || !Array.isArray(record.files?.read) || !Array.isArray(record.files?.write) || !Array.isArray(record.decisions) || !['light', 'standard', 'heavy'].includes(record.requested?.tier)) throw new Error('record');
      records.push({ path, record });
    } catch { skippedRecords++; }
  }
  return { records, skippedRecords };
}

/** @param {string[]} args */
function runCli([command, ...args]) {
  try {
    if (command === 'observe') {
      const options = parseOptions(args, ['--handoff', '--tier', '--effort', '--sandbox'], ['--network', '--resume']);
      const handoff = String(options['--handoff']);
      const tier = String(options['--tier']);
      if (!['light', 'standard', 'heavy'].includes(tier)) throw new Error('arguments');
      const target = recordPath(handoff);
      if (resolve(handoff) === target) throw new Error('arguments');
      const text = readFileSync(handoff, 'utf8');
      const policy = JSON.parse(readFileSync(new URL('./agent-decision-policy.json', import.meta.url), 'utf8'));
      const { records } = readRecords(dirname(target));
      const inFlight = records.filter(entry => entry.path !== target && !entry.record.outcome).map(entry => ({ handoff: entry.path, files: entry.record.files }));
      const record = buildRecord({ text, policy, inFlight, requested: {
        tier: /** @type {Tier} */ (tier), effort: String(options['--effort']), sandbox: String(options['--sandbox']),
        network: options['--network'] === true, resume: options['--resume'] === true,
      } });
      const existing = records.find(entry => entry.path === target)?.record;
      record.history = [];
      if (existing) {
        const { history = [], ...previous } = existing;
        record.history = [previous, ...history].slice(0, 10);
      }
      writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
      const [security, permission, route, ownership] = /** @type {[SecurityDecision, PermissionDecision, TierDecision, OwnershipDecision]} */ (record.decisions);
      console.log(`jev observe: sensitivity=${security.answer?.class ?? null} permission=${permission.answer} tier=${route.answer}/${route.requested} agrees=${route.agrees} overlap=${ownership.answer?.overlapping.length ?? 0}`);
    } else if (command === 'outcome') {
      const options = parseOptions(args, ['--handoff', '--exit', '--seconds', '--tokens']);
      const exitCode = Number(options['--exit']);
      const seconds = Number(options['--seconds']);
      if (!Number.isInteger(exitCode) || !Number.isFinite(seconds) || seconds < 0) throw new Error('arguments');
      const target = recordPath(String(options['--handoff']));
      if (resolve(String(options['--handoff'])) === target) throw new Error('arguments');
      let record;
      try { record = JSON.parse(readFileSync(target, 'utf8')); }
      catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return;
        throw error;
      }
      if (record.schema !== 'jev.decision/v1') throw new Error('record');
      record.outcome = { exitCode, seconds, ...(options['--tokens'] === undefined ? {} : { tokens: String(options['--tokens']) }) };
      writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    } else if (command === 'summary' && args.length === 1) {
      const { records, skippedRecords } = readRecords(resolve(args[0]));
      console.log(JSON.stringify({ ...summarize(records.map(entry => entry.record)), skippedRecords }, null, 2));
    } else throw new Error('arguments');
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    const reason = code === 'ENOENT' ? 'missing file' : code === 'EACCES' || code === 'EPERM' ? 'access unavailable' : 'invalid input or unavailable observation';
    console.log(`jev observe: skipped (${reason})`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli(process.argv.slice(2));
}
