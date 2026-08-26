import { describe, expect, it } from 'vitest';
import { createNewGame } from '../state';
import { canRetire, heritageMutationRate, retirePond } from './heritage';
import { isUnlocked, UNLOCKABLES } from './unlocks';
import { ALL_BREED_KEYS } from './breedBook';
import { duckCapacity } from './economy';
import { MUTATION_RATE } from './genetics';
import { createStarterDuck, layEgg } from './duck';

describe('heritage', () => {
  it('retires the pond carrying the legacy and founder pair, with permanent bonuses', () => {
    const { state } = createNewGame(80);
    expect(canRetire(state).ok).toBe(false);
    for (const k of ALL_BREED_KEYS.slice(0, 10)) state.breedBook[k] = { firstName: 'x', day: 1, count: 1 };
    state.awards['M|D|solid|n'] = { pure: 2 };
    state.society.rank = 3;
    state.chronicle.push({ day: 1, kind: 'milestone', text: 'old times' });
    state.stats.biggestSale = 500;
    const drake = state.ducks.find((d) => d.sex === 'M')!;
    const hen = state.ducks.find((d) => d.sex === 'F')!;
    expect(canRetire(state).ok).toBe(true);
    const next = retirePond(state, drake.id, hen.id, 123);
    const s = next.state;
    expect(s.heritage).toBe(1);
    expect(s.ducks).toHaveLength(2);
    expect(s.ducks.map((d) => d.name).sort()).toEqual([drake.name, hen.name].sort());
    expect(s.ducks[0].genome).toEqual(drake.sex === 'M' ? drake.genome : hen.genome);
    expect(Object.keys(s.breedBook).length).toBeGreaterThanOrEqual(10);
    expect(s.awards['M|D|solid|n']?.pure).toBe(2);
    expect(s.society.rank).toBe(3);
    expect(s.chronicle.some((c) => c.text === 'old times')).toBe(true);
    expect(s.chronicle[s.chronicle.length - 1].text).toContain('founded a new one');
    expect(s.stats.biggestSale).toBe(500);
    expect(s.stats.ducksHatched).toBe(0);
    expect(s.money).toBe(150);
    expect(duckCapacity(s)).toBe(duckCapacity(state) + 1);
    // Nothing re-locks on a heritage pond — the goal chain that would
    // re-introduce the panels is already done.
    for (const u of UNLOCKABLES) expect(isUnlocked(s, u)).toBe(true);
    expect(heritageMutationRate(s.heritage, MUTATION_RATE)).toBeCloseTo(0.03);
    // Founders are gen 0 and can breed straight away.
    const egg = layEgg(next.rng, s.ducks.find((d) => d.sex === 'F')!, s.ducks.find((d) => d.sex === 'M')!, { x: 0, y: 0 });
    expect(egg.lineage!.gen).toBe(1);
    void createStarterDuck;
  });
});
