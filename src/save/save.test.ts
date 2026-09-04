/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import v1 from './fixtures/v1.json?raw';
import { createNewGame } from '../newGame';
import { tickLifecycle } from '../sim/lifecycle';
import { tickNeeds } from '../sim/needs';
import { CORRUPT_KEY, deserialize, loadFromStorage, SAVE_KEY, SAVE_VERSION, saveToStorage, serialize } from './save';
import { LOCI, type Genome } from '../sim/genetics';
import { advanceTicks, installFakeStorage, uninstallFakeStorage } from '../testFixtures';

describe('save round-trip', () => {
  it('deserialize(serialize(state)) preserves the whole game state', () => {
    const { state, rng } = createNewGame(1234);
    // Advance the sim a bit so the state isn't trivially fresh.
    advanceTicks(state, rng, 500, [tickNeeds, tickLifecycle]);
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
    const map = installFakeStorage();
    const bad = '{"version":1,"state":{"broken":true}}';
    map.set(SAVE_KEY, bad);
    const res = loadFromStorage();
    expect(res.kind).toBe('corrupt');
    expect(map.get(SAVE_KEY)).toBe(bad); // original untouched
    expect(map.get(CORRUPT_KEY)).toBe(bad); // and stashed for recovery
    uninstallFakeStorage();
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
    const json = serialize(state).replace(`"version":${SAVE_VERSION}`, '"version":99');
    expect(() => deserialize(json)).toThrow(/unknown save version/i);
    expect(() => deserialize(serialize(state).replace(`"version":${SAVE_VERSION}`, '"version":0'))).toThrow(/unknown save version/i);
  });

  it('walks a v1 save up the migration chain: temperament loci are filled in everywhere', () => {
    const { state, rng } = createNewGame(21);
    advanceTicks(state, rng, 500, [tickNeeds, tickLifecycle]);
    // Forge a v1 blob: strip the temper loci from every stored genome.
    const raw = JSON.parse(serialize(state));
    raw.version = 1;
    const strip = (g: Record<string, unknown> | undefined | null) => {
      if (!g) return;
      delete g.temper1;
      delete g.temper2;
    };
    for (const d of raw.state.ducks) {
      strip(d.genome);
      if (d.lineage) {
        strip(d.lineage.sire?.genome);
        strip(d.lineage.dam?.genome);
        for (const g of d.lineage.grand) strip(g?.genome);
      }
    }
    raw.state.memorial = [{ name: 'Old', sex: 'F', bodyColor: '#fff', genome: (() => { const g = JSON.parse(JSON.stringify(state.ducks[0].genome)); strip(g); return g; })(), diedOnDay: 1, rarityScore: 0 }];
    delete raw.state.stats.drills;
    delete raw.state.lifeEvent;
    const restored = deserialize(JSON.stringify(raw));
    expect(restored.version).toBe(SAVE_VERSION);
    for (const duck of restored.ducks) {
      for (const def of LOCI) expect(duck.genome[def.id]).toHaveLength(2);
      expect(Number.isFinite(duck.phenotype.boldness)).toBe(true);
    }
    expect(restored.memorial[0].genome?.temper1).toHaveLength(2);
    expect(restored.stats.drills).toBe(0);
    expect(restored.lifeEvent).toBeNull();
    // Living ducks draw varied pairs from a per-duck seed, not all mid.
    const bold = restored.ducks.map((d) => d.phenotype.boldness);
    expect(new Set(bold).size).toBeGreaterThan(1);
  });
});

describe('a real v1 save on disk', () => {
  // Every genome a v1 blob can carry: the flock's, its ancestors', the
  // memorial's, the visitor's, and the rival flocks'.
  const allGenomes = (state: ReturnType<typeof deserialize>): Genome[] => {
    const out: Genome[] = [];
    for (const d of state.ducks) {
      out.push(d.genome);
      if (d.lineage) {
        for (const a of [d.lineage.sire, d.lineage.dam, ...d.lineage.grand]) if (a) out.push(a.genome);
      }
    }
    for (const m of state.memorial) if (m.genome) out.push(m.genome);
    if (state.visitor?.duck) out.push(state.visitor.duck.genome);
    for (const r of state.rivals) out.push(...r.flock);
    return out;
  };

  it('is genuinely v1: no genome in it carries the temperament loci', () => {
    const raw = JSON.parse(v1);
    expect(raw.version).toBe(1);
    expect(raw.state.ducks.length).toBeGreaterThan(4); // a bred egg rides along
    expect(raw.state.ducks.some((d: { genome: Record<string, unknown> }) => 'temper1' in d.genome || 'temper2' in d.genome)).toBe(false);
    expect(raw.state.ducks.some((d: { lineage?: unknown }) => d.lineage)).toBe(true);
  });

  it('loads at the current version with both temperament loci in every genome', () => {
    const restored = deserialize(v1);
    expect(restored.version).toBe(SAVE_VERSION);
    expect(restored.ducks.length).toBe(JSON.parse(v1).state.ducks.length);
    const genomes = allGenomes(restored);
    expect(genomes.length).toBeGreaterThan(restored.ducks.length); // ancestors and rivals included
    for (const g of genomes) {
      expect(g.temper1).toHaveLength(2);
      expect(g.temper2).toHaveLength(2);
      for (const def of LOCI) expect(g[def.id]).toHaveLength(2);
    }
    for (const duck of restored.ducks) expect(Number.isFinite(duck.phenotype.boldness)).toBe(true);
  });

  it('migrates idempotently: saving the migrated state and loading it again changes nothing', () => {
    const once = deserialize(v1);
    for (const duck of once.ducks) duck.prevPos = { ...duck.pos };
    const twice = deserialize(serialize(once));
    for (const duck of twice.ducks) duck.prevPos = { ...duck.pos };
    expect(twice).toEqual(once);
    // And loading the same v1 blob twice is deterministic (the per-duck seeds).
    expect(deserialize(v1)).toEqual(deserialize(v1));
  });
});

describe('saveToStorage honesty', () => {
  it('reports success and failure truthfully', () => {
    const { state } = createNewGame(12);
    installFakeStorage();
    expect(saveToStorage(state)).toBe(true);
    (globalThis as unknown as { localStorage: { setItem: (k: string, v: string) => void } }).localStorage.setItem = () => {
      throw new Error('quota');
    };
    expect(saveToStorage(state)).toBe(false);
    uninstallFakeStorage();
  });
});

describe('memorial cap', () => {
  it('keeps the newest entries plus the record holders', async () => {
    const { MEMORIAL_CAP, trimMemorial } = await import('../state');
    const entry = (i: number, ageDays: number, descendants: number) =>
      ({ name: `d${i}`, sex: 'F', bodyColor: '#fff', genome: {}, diedOnDay: i, rarityScore: 0, diedStage: 'elder', ageDays, gen: 0, pedigree: 0, descendants }) as never;
    const memorial = [entry(0, 99, 0), entry(1, 1, 42)];
    for (let i = 2; i < MEMORIAL_CAP + 40; i += 1) memorial.push(entry(i, 5, 1));
    const trimmed = trimMemorial(memorial);
    expect(trimmed.length).toBe(MEMORIAL_CAP);
    expect(trimmed.some((m) => (m as { name: string }).name === 'd0')).toBe(true); // longest-lived kept
    expect(trimmed.some((m) => (m as { name: string }).name === 'd1')).toBe(true); // most descendants kept
    expect(trimmed[trimmed.length - 1]).toBe(memorial[memorial.length - 1]); // recency order intact
  });
});
