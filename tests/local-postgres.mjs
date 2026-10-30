import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const desiredSettings = Object.freeze({ wal_recycle: 'off', wal_init_zero: 'off', max_wal_size: '512MB' });

const usage = 'Usage: node tests/local-postgres.mjs <ensure|status|restart|tune>';

export function parseCommand(argv) {
  return argv.length === 1 && ['ensure', 'status', 'restart', 'tune'].includes(argv[0]) ? argv[0] : null;
}

export function settingsToFix(current) {
  return Object.entries(desiredSettings)
    .filter(([name, value]) => String(current[name] ?? '').toLowerCase() !== value.toLowerCase())
    .map(([name, value]) => `alter system set ${name} = '${value}';`);
}

function resolvePaths() {
  const local = process.env.LOCALAPPDATA;
  const root = local ? path.join(local, 'Programs', 'PostgreSQL', '17-portable') : null;
  const bin = process.env.STOCKFLOW_POSTGRES_BIN || (root && path.join(root, 'pgsql', 'bin'));
  const data = process.env.STOCKFLOW_POSTGRES_DATA || (root && path.join(root, 'data'));
  if (!bin || !data) throw new Error('Set LOCALAPPDATA or STOCKFLOW_POSTGRES_BIN and STOCKFLOW_POSTGRES_DATA.');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const program = (name) => {
    const candidate = path.join(bin, `${name}${suffix}`);
    return existsSync(candidate) ? candidate : name;
  };
  return { bin, data, log: path.join(root || path.dirname(data), 'pg-session.log'), program };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.error) throw result.error;
  return result;
}

function pgCtl(paths, args) {
  return run(paths.program('pg_ctl'), ['-D', paths.data, ...args]);
}

function running(paths) {
  return pgCtl(paths, ['status']).status === 0;
}

function ready(paths) {
  return run(paths.program('pg_isready'), ['-q']).status === 0;
}

function query(paths, sql) {
  const user = process.env.STOCKFLOW_POSTGRES_USER || 'postgres';
  const result = run(paths.program('psql'), ['-U', user, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres', '-c', sql]);
  if (result.status !== 0) throw new Error((result.stderr || 'psql failed').trim());
  return result.stdout.trim();
}

function readSettings(paths) {
  const output = query(paths, "select name || '=' || setting from pg_settings where name in ('wal_recycle','wal_init_zero','max_wal_size') order by name");
  return Object.fromEntries(output.split(/\r?\n/).filter(Boolean).map((line) => {
    const split = line.indexOf('=');
    return [line.slice(0, split), line.slice(split + 1)];
  }));
}

function tune(paths) {
  if (!ready(paths)) throw new Error('PostgreSQL is not ready; cannot tune settings.');
  const current = readSettings(paths);
  const statements = settingsToFix(current);
  if (statements.length === 0) {
    console.log('PostgreSQL WAL settings already match the desired values.');
    return;
  }
  const altered = query(paths, `${statements.join(' ')} select pg_reload_conf();`);
  for (const statement of statements) console.log(`Changed: ${statement}`);
  console.log(`Configuration reload: ${altered || 'requested'}`);
}

function start(paths) {
  if (!running(paths)) {
    const taskCheck = process.platform === 'win32' && run('schtasks', ['/query', '/tn', 'StockFlowTestPostgres'], { stdio: 'ignore' }).status === 0;
    if (taskCheck) {
      const result = run('schtasks', ['/run', '/tn', 'StockFlowTestPostgres'], { stdio: 'inherit' });
      if (result.status !== 0) throw new Error('Could not start scheduled task StockFlowTestPostgres.');
    } else {
      const result = pgCtl(paths, ['-l', paths.log, '-W', 'start']);
      if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'pg_ctl start failed').trim());
    }
  }
  const deadline = Date.now() + 600_000;
  let waitingMessagePrinted = false;
  while (!ready(paths)) {
    if (Date.now() >= deadline) throw new Error('PostgreSQL was still not ready after 600 seconds.');
    if (!waitingMessagePrinted) {
      console.log('Waiting for PostgreSQL recovery…');
      waitingMessagePrinted = true;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
  }
}

export function main(argv = process.argv.slice(2)) {
  const command = parseCommand(argv);
  if (!command) {
    console.error(usage);
    return 2;
  }
  try {
    const paths = resolvePaths();
    if (command === 'status') {
      const isRunning = running(paths);
      const isReady = isRunning && ready(paths);
      console.log(`running: ${isRunning ? 'yes' : 'no'}`);
      console.log(`ready: ${isReady ? 'yes' : 'no'}`);
      if (isReady) console.log(`wal_recycle: ${readSettings(paths).wal_recycle ?? 'unknown'}`);
      return 0;
    }
    if (command === 'restart') {
      const stopped = pgCtl(paths, ['-m', 'immediate', '-w', '-t', '60', 'stop']);
      if (stopped.status !== 0 && running(paths)) throw new Error((stopped.stderr || stopped.stdout || 'pg_ctl stop failed').trim());
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
    }
    if (command === 'ensure' || command === 'restart') start(paths);
    tune(paths);
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
