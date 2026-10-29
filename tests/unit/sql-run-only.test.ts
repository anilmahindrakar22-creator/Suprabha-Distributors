import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../sql-run-only.mjs';

describe('sql-run-only arguments', () => {
  it('accepts a test database and SQL files', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'sql-run-only-'));
    const file = path.join(directory, 'a.sql');
    try {
      writeFileSync(file, 'select 1;');
      expect(parseArgs(['--db', 'stockflow_test_0123456789abcdef', file])).toEqual({
        database: 'stockflow_test_0123456789abcdef', drop: false, files: [file],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('rejects missing database, non-test database, and non-SQL files', () => {
    expect(parseArgs(['tests/a.sql'])).toBeNull();
    expect(parseArgs(['--db', 'postgres', 'tests/a.sql'])).toBeNull();
    expect(parseArgs(['--db', 'stockflow_test_0123456789abcdef', 'tests/a.txt'])).toBeNull();
  });
  it('accepts drop with no files and preserves default cleanup in the replay script', () => {
    expect(parseArgs(['--db', 'stockflow_test_0123456789abcdef', '--drop'])).toEqual({
      database: 'stockflow_test_0123456789abcdef', drop: true, files: [],
    });
    expect(readFileSync('tests/pricing-migration-local.ps1', 'utf8')).toMatch(/dropdbProgram -U \$databaseUser --if-exists/);
  });
});
