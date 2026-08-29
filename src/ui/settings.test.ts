import { describe, expect, it } from 'vitest';
import { actionForKey, DEFAULT_KEYS, keyFor, keyLabel, matchesKey, normalizeKey, rebindKey, resetKeys, settings } from './settings';

const ev = (key: string) => ({ key }) as KeyboardEvent;

describe('key bindings', () => {
  it('start at the defaults and match case-insensitively', () => {
    resetKeys();
    expect(keyFor('shop')).toBe('2');
    expect(matchesKey(ev('c'), 'cards')).toBe(true);
    expect(matchesKey(ev('C'), 'cards')).toBe(true);
    expect(matchesKey(ev('='), 'faster')).toBe(true); // unshifted +
    expect(matchesKey(ev(' '), 'paddle')).toBe(true);
    expect(actionForKey('5')).toBe('race');
    expect(actionForKey('x')).toBeNull();
  });

  it('rebinding moves a key over and unbinds the action that had it', () => {
    resetKeys();
    expect(rebindKey('race', 'r')).toBeNull();
    expect(keyFor('race')).toBe('r');
    expect(actionForKey('5')).toBeNull();
    // Take Shop's key for the Book: Shop is left unbound.
    expect(rebindKey('book', '2')).toBe('shop');
    expect(keyFor('shop')).toBe('');
    expect(matchesKey(ev('2'), 'shop')).toBe(false);
    expect(matchesKey(ev('2'), 'book')).toBe(true);
    expect(settings().keys.book).toBe('2');
    resetKeys();
    expect(settings().keys).toEqual(DEFAULT_KEYS);
  });

  it('labels keys for people', () => {
    expect(keyLabel(' ')).toBe('Space');
    expect(keyLabel('c')).toBe('C');
    expect(keyLabel('ArrowUp')).toBe('Up');
    expect(keyLabel('')).toBe('unbound');
    expect(normalizeKey('_')).toBe('-');
  });
});
