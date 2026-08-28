import { describe, expect, it } from 'vitest';
import { createNewGame } from '../state';
import { tickLifecycle } from '../sim/lifecycle';
import { tickNeeds } from '../sim/needs';
import { CORRUPT_KEY, deserialize, loadFromStorage, SAVE_KEY, serialize } from './save';

describe('save round-trip', () => {
  it('deserialize(serialize(state)) preserves the whole game state', () => {
    const { state, rng } = createNewGame(1234);
    // Advance the sim a bit so the state isn't trivially fresh.
    for (let i = 0; i < 500; i += 1) {
      state.clock.totalTicks += 1;
      tickNeeds(state, rng);
      tickLifecycle(state, rng);
    }
    state.rngState = rng.getState();

    const restored = deserialize(serialize(state));
    expect(restored).toEqual(state);
  });

  it('migrates the renamed nestSlot perk to pondSlot', () => {
    const { state } = createNewGame(2);
    state.society.perks.push('pondSlot');
    const json = serialize(state).replace('"pondSlot"', '"nestSlot"');
    const restored = deserialize(json);
    expect(restored.society.perks).toContain('pondSlot');
    expect(restored.society.perks).not.toContain('nestSlot');
  });

  it('an unreadable save is stashed and never overwritten', () => {
    const map = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
    const bad = '{"version":1,"state":{"broken":true}}';
    map.set(SAVE_KEY, bad);
    const res = loadFromStorage();
    expect(res.kind).toBe('corrupt');
    expect(map.get(SAVE_KEY)).toBe(bad); // original untouched
    expect(map.get(CORRUPT_KEY)).toBe(bad); // and stashed for recovery
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('rejects a blob without a recognizable flock', () => {
    expect(() => deserialize('{"version":1,"state":{}}')).toThrow(/recognizable/i);
    expect(() => deserialize('null')).toThrow();
  });

  it('migration tolerates missing container objects', () => {
    const { state } = createNewGame(11);
    const raw = JSON.parse(serialize(state));
    for (const k of ['inventory', 'upgrades', 'stats', 'foodPellets', 'memorial', 'pendingClutches', 'pond']) {
      delete raw.state[k];
    }
    const restored = deserialize(JSON.stringify(raw));
    expect(restored.inventory.feed).toBe(0);
    expect(restored.upgrades).toEqual({});
    expect(restored.stats.eggsSold).toBe(0);
    expect(restored.pond.cleanliness).toBe(100);
    expect(restored.foodPellets).toEqual([]);
  });

  it('rejects unknown save versions', () => {
    const { state } = createNewGame(1);
    const json = serialize(state).replace('"version":1', '"version":99');
    expect(() => deserialize(json)).toThrow(/unknown save version/i);
  });
});
