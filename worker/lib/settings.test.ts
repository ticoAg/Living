import { describe, expect, it } from 'vite-plus/test';
import { fakeD1 } from '../test-utils';
import { REGISTRATION_MODES, asRegistration, getRegistration } from './settings';

describe('asRegistration', () => {
  it('keeps the three known modes', () => {
    for (const mode of REGISTRATION_MODES) expect(asRegistration(mode)).toBe(mode);
  });

  it('reads anything else as invite', () => {
    for (const value of [null, undefined, '', 'OPEN', 'everyone', 1]) expect(asRegistration(value)).toBe('invite');
  });
});

describe('getRegistration', () => {
  it('reads the registration setting', async () => {
    const { db, calls } = fakeD1(() => ({ value: 'open' }));
    expect(await getRegistration(db)).toBe('open');
    expect(calls).toEqual([{ sql: `SELECT value FROM settings WHERE key = 'registration'`, params: [], method: 'first' }]);
  });

  it('falls back to invite when the setting is missing or unknown', async () => {
    expect(await getRegistration(fakeD1(() => null).db)).toBe('invite');
    expect(await getRegistration(fakeD1(() => ({ value: 'everyone' })).db)).toBe('invite');
  });
});
