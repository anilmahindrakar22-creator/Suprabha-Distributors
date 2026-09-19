import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Evidence-only: no database connection, SQL execution or migration-history repair.
const pricingReleaseFiles = new Set([
  '20260912193000_customer_pricing_engine.sql',
  '20260913130000_customer_price_book.sql',
  '20260913131000_customer_price_book_resolution.sql',
  '20260913132000_price_book_gateway.sql',
  '20260914100000_billing_pricing_evidence_gate.sql',
  '20260914120000_pricing_submission_recovery.sql',
  '20260914140000_contract_policy_recovery.sql',
  '20260914160000_close_unresolved_pricing.sql',
]);
const sha = (sql) => createHash('sha256').update(sql.replace(/\r/g, '').trim(), 'utf8').digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const versionPattern = /^\d{14}$/;

export function pricingReleasePreflight(evidence, files) {
  if (evidence.projectId !== 'aormuidjbdqruglmyseh') throw new Error('Unexpected evidence project');
  const seen = new Set();
  const versions = new Set();
  const deployed = [];
  const pending = [];
  function addVersion(version) {
    if (!versionPattern.test(version ?? '') || versions.has(version)) throw new Error('Invalid or duplicate remote version');
    versions.add(version);
  }
  for (const bootstrap of evidence.remoteOnly) {
    addVersion(bootstrap.version);
    if (!hashPattern.test(bootstrap.hash)) throw new Error('Invalid bootstrap hash');
    if (!bootstrap.localFile || seen.has(bootstrap.localFile) || !files.has(bootstrap.localFile)) throw new Error('Missing or duplicate bootstrap migration');
    if (sha(files.get(bootstrap.localFile)) !== bootstrap.hash) throw new Error(`Migration hash changed: ${bootstrap.localFile}`);
    seen.add(bootstrap.localFile);
    deployed.push({ localFile: bootstrap.localFile, remoteVersion: bootstrap.version });
  }
  for (const entry of evidence.migrations) {
    const name = entry.localFile;
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(name) || seen.has(name)) throw new Error('Invalid or duplicate local migration');
    seen.add(name);
    if (!files.has(name)) throw new Error(`Missing migration: ${name}`);
    if (sha(files.get(name)) !== entry.localSha256) throw new Error(`Migration hash changed: ${name}`);
    if (entry.status === 'not_deployed') {
      if (entry.remoteVersion !== null || entry.remoteSha256 !== null || !pricingReleaseFiles.has(name)) {
        throw new Error(`Unreviewed pending migration: ${name}`);
      }
      pending.push(name);
    } else {
      addVersion(entry.remoteVersion);
      if (!hashPattern.test(entry.remoteSha256 ?? '')) throw new Error(`Invalid remote hash: ${name}`);
      if (entry.status === 'exact_normalized_match') {
        if (entry.localSha256 !== entry.remoteSha256) throw new Error(`Inconsistent exact match: ${name}`);
      } else if (entry.status !== 'formatting_difference_reviewed' || !entry.review?.trim()) {
        throw new Error(`Unreviewed migration status: ${name}`);
      }
      deployed.push({ localFile: name, remoteVersion: entry.remoteVersion });
    }
  }
  if (files.size !== seen.size) throw new Error('Unmapped local migrations; refresh evidence');
  const latestRemoteVersion = [...versions].sort((a, b) => a.localeCompare(b)).at(-1);
  pending.sort((a, b) => a.localeCompare(b));
  if (pending.some((name) => name.slice(0, 14) <= latestRemoteVersion)) throw new Error('Pending migration predates deployed history');
  return {
    evidenceDate: evidence.checkedAt,
    liveHistoryRechecked: false,
    releaseReady: false,
    deployed: deployed.sort((a, b) => a.remoteVersion.localeCompare(b.remoteVersion)),
    pending,
    blockers: [
      'Refresh live migration history and compare content again before release.',
      'Run the deployed-order clean-install replay immediately before release.',
      'Complete isolated authenticated acceptance and final consolidation checks.',
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = resolve(root, 'supabase/migrations');
  try {
    const evidence = JSON.parse(readFileSync(resolve(root, 'supabase/migration-history-map.json'), 'utf8'));
    const files = new Map(readdirSync(directory).filter((name) => name.endsWith('.sql')).map((name) => [name, readFileSync(resolve(directory, name), 'utf8')]));
    console.log(JSON.stringify(pricingReleasePreflight(evidence, files), null, 2));
  } catch (error) {
    console.error(`Preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}
