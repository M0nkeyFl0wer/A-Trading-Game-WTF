// @vitest-environment jsdom
// jsdom gives us a real window.localStorage; the root package already ships it.
import { beforeEach, describe, expect, test } from 'vitest';
import {
  DEV_USER_ID_KEY,
  SAFE_DEV_ID_RE,
  devDisplayName,
  devIdToken,
  getDevUserId,
} from './devIdentity';

describe('dev identity helper (issue #10)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('generates a server-safe id and persists it under dev-user-id', () => {
    const id = getDevUserId();
    expect(id).toMatch(SAFE_DEV_ID_RE);
    expect(id).not.toContain('-');           // UUID dashes are stripped
    expect(id).toHaveLength(32);
    expect(window.localStorage.getItem(DEV_USER_ID_KEY)).toBe(id);
  });

  test('returns the same id on subsequent calls (stable per browser)', () => {
    const first = getDevUserId();
    const second = getDevUserId();
    expect(second).toBe(first);
  });

  test('replaces a stored id that would fail the server allowlist', () => {
    window.localStorage.setItem(DEV_USER_ID_KEY, 'not valid!!');
    const id = getDevUserId();
    expect(id).toMatch(SAFE_DEV_ID_RE);
    expect(id).not.toBe('not valid!!');
  });

  test('works with an in-memory storage stand-in', () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, v); },
    };
    const id = getDevUserId(storage);
    expect(mem.get(DEV_USER_ID_KEY)).toBe(id);
    expect(getDevUserId(storage)).toBe(id);
  });

  test('token and display name derive from the id in the server-expected shapes', () => {
    expect(devIdToken('abcd1234')).toBe('dev:abcd1234');
    expect(devDisplayName('abcd1234')).toBe('Dev Trader abcd');
    // Same regex the API uses to parse the bearer token.
    expect(devIdToken('abcd1234')).toMatch(/^dev:([a-zA-Z0-9_-]{1,64})$/);
  });
});
