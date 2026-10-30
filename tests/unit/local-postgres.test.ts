import { describe, expect, it } from 'vitest';
import { desiredSettings, parseCommand, settingsToFix } from '../local-postgres.mjs';

describe('local Postgres command parsing', () => {
  it('accepts each supported command', () => {
    for (const command of ['ensure', 'status', 'restart', 'tune']) {
      expect(parseCommand([command])).toBe(command);
    }
  });

  it('rejects invalid commands and arguments as usage errors', () => {
    expect(parseCommand([])).toBeNull();
    expect(parseCommand(['start'])).toBeNull();
    expect(parseCommand(['status', 'extra'])).toBeNull();
  });
});

describe('local Postgres WAL settings', () => {
  it('does not emit statements when all settings are correct', () => {
    expect(settingsToFix(desiredSettings)).toEqual([]);
  });

  it.each([
    ['wal_recycle', 'on', "alter system set wal_recycle = 'off';"],
    ['wal_init_zero', 'on', "alter system set wal_init_zero = 'off';"],
    ['max_wal_size', '1GB', "alter system set max_wal_size = '512MB';"],
  ])('fixes an incorrect %s value', (name, value, statement) => {
    expect(settingsToFix({ ...desiredSettings, [name]: value })).toEqual([statement]);
  });
});
