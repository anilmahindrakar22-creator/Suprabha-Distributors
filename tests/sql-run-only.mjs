import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const usage = 'Usage: node tests/sql-run-only.mjs --db <database> <file.sql> [<file.sql> ...] | --db <database> --drop';
const databasePattern = /^stockflow_test_[0-9a-f]{16}$/;

export function parseArgs(argv) {
  let database;
  let drop = false;
  const files = [];
  for (const arg of argv) {
    if (arg === '--drop') {
      if (drop) return null;
      drop = true;
    } else if (arg === '--db') {
      if (database !== undefined) return null;
      database = '';
    } else if (database === '') {
      database = arg;
    } else {
      files.push(arg);
    }
  }
  if (!database || !databasePattern.test(database)) return null;
  if (drop ? files.length !== 0 : files.length === 0) return null;
  if (files.some((file) => !file.endsWith('.sql') || !existsSync(path.resolve(process.cwd(), file)))) return null;
  return { database, drop, files };
}

function resolvePsql() {
  const bin = process.env.STOCKFLOW_POSTGRES_BIN;
  if (bin) {
    const candidate = path.join(bin, process.platform === 'win32' ? 'psql.exe' : 'psql');
    if (existsSync(candidate)) return candidate;
  }
  if (process.env.LOCALAPPDATA) {
    const candidate = path.join(process.env.LOCALAPPDATA, 'Programs', 'PostgreSQL', '17-portable', 'pgsql', 'bin', process.platform === 'win32' ? 'psql.exe' : 'psql');
    if (existsSync(candidate)) return candidate;
  }
  return 'psql';
}

function run(psql, args) {
  return spawnSync(psql, args, { stdio: 'inherit' });
}

export function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  if (!parsed) {
    console.error(usage);
    return 2;
  }
  const psql = resolvePsql();
  const user = process.env.STOCKFLOW_POSTGRES_USER || 'postgres';
  if (parsed.drop) {
    const result = run(psql, ['-U', user, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres', '-c', `drop database if exists ${parsed.database} with (force)`]);
    return result.status === 0 ? 0 : 1;
  }
  for (const file of parsed.files) {
    const start = performance.now();
    const result = run(psql, ['-U', user, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', parsed.database, '-f', file]);
    const seconds = ((performance.now() - start) / 1000).toFixed(2);
    if (result.status !== 0) {
      console.error(`FAIL ${file}`);
      return 1;
    }
    console.log(`PASS ${file} (${seconds}s)`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
