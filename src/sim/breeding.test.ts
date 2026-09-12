import { describe, expect, it } from 'vitest';
import {
  BREEDING_COOLDOWN_TICKS,
  clutchFather,
  COURTSHIP_TICKS,
  nestFull,
  nestPair,
  nestSlotOffset,
  nestUsed,
  NEST_FULL_REASON,
  pairViability,
  tickBreeding,
  type PendingClutch,
} from './breeding';
import { nestCapacity } from './economy';
import { CLUTCH_SIZE } from './nest';
import { nestPos } from './pond';
import { hireStud, studOffers } from './rivals';
import { advanceTicks, newGameWithPair, pushEgg } from '../testFixtures';

describe('nestPair', () => {
  it('refuses ids that are not on the pond', () => {
    const { state, hen } = newGameWithPair();
    expect(nestPair(state, 'nobody', hen.id)).toEqual({ ok: false, reason: 'Duck not found' });
    expect(nestPair(state, hen.id, 'nobody')).toEqual({ ok: false, reason: 'Duck not found' });
    expect(state.pendingClutches).toHaveLength(0);
  });

  it("passes canBreedPair's verdict through untouched", () => {
    const { state, rng, hen, drake } = newGameWithPair();
    const otherHen = state.ducks.find((d) => d.sex === 'F' && d !== hen)!;
    expect(nestPair(state, hen.id, otherHen.id)).toEqual({ ok: false, reason: 'Pair must be male and female' });
    expect(nestPair(state, hen.id, hen.id)).toEqual({ ok: false, reason: 'A duck cannot breed with itself' });
    const egg = pushEgg(state, rng);
    expect(nestPair(state, drake.id, egg.id)).toEqual({ ok: false, reason: 'Both ducks must be adults' });
    expect(state.pendingClutches).toHaveLength(0);
    expect(state.stats.clutchesStarted).toBe(0);
  });

  it('refuses when the nest is full — eggs and pending clutches both count', () => {
    const { state, rng, hen, drake } = newGameWithPair();
    const cap = nestCapacity(state);
    for (let i = 0; i < cap; i += 1) pushEgg(state, rng);
    expect(nestUsed(state)).toBe(cap);
    expect(nestFull(state)).toBe(true);
    expect(nestPair(state, hen.id, drake.id)).toEqual({ ok: false, reason: NEST_FULL_REASON });
    expect(hen.breedingCooldownTicks).toBe(0);

    // A courting pair reserves a whole clutch: clear one egg and it still
    // won't fit, clear a clutch's worth and it does — and then fills it.
    state.ducks.pop();
    expect(nestFull(state)).toBe(true);
    for (let i = 1; i < CLUTCH_SIZE; i += 1) state.ducks.pop();
    expect(nestFull(state)).toBe(false);
    state.pendingClutches.push({ motherId: hen.id, fatherId: drake.id, ticksRemaining: 10 });
    expect(nestUsed(state)).toBe(cap);
    expect(nestFull(state)).toBe(true);
    expect(nestPair(state, hen.id, drake.id)).toEqual({ ok: false, reason: NEST_FULL_REASON });
  });

  it('starts a clutch with mother and father set by sex, and rests both parents', () => {
    const { state, hen, drake } = newGameWithPair();
    // Drake first: the roles come from sex, not argument order.
    expect(nestPair(state, drake.id, hen.id)).toEqual({ ok: true });
    expect(state.pendingClutches).toEqual([{ motherId: hen.id, fatherId: drake.id, ticksRemaining: COURTSHIP_TICKS }]);
    expect(hen.breedingCooldownTicks).toBe(BREEDING_COOLDOWN_TICKS);
    expect(drake.breedingCooldownTicks).toBe(BREEDING_COOLDOWN_TICKS);
    expect(state.stats.clutchesStarted).toBe(1);
    // Resting parents can't be paired again straight away.
    expect(nestPair(state, hen.id, drake.id).ok).toBe(false);
    expect(nestPair(state, hen.id, drake.id).reason).toMatch(/resting/);
  });

  it('pairViability reports a chance in (0, 1] for a healthy starter pair', () => {
    const { state, hen, drake } = newGameWithPair();
    const v = pairViability(state, hen, drake);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});

describe('tickBreeding', () => {
  it('lays a clutch exactly when the courtship runs out', () => {
    const { state, rng, hen, drake } = newGameWithPair();
    // A perfect pair: every egg of the clutch takes.
    for (const d of [hen, drake]) {
      d.needs.happiness = 100;
      d.needs.health = 100;
    }
    nestPair(state, hen.id, drake.id);
    advanceTicks(state, rng, COURTSHIP_TICKS - 1, [tickBreeding]);
    expect(state.pendingClutches[0].ticksRemaining).toBe(1);
    expect(state.ducks.filter((d) => d.stage === 'egg')).toHaveLength(0);

    advanceTicks(state, rng, 1, [tickBreeding]);
    expect(state.pendingClutches).toHaveLength(0);
    const eggs = state.ducks.filter((d) => d.stage === 'egg');
    expect(eggs).toHaveLength(CLUTCH_SIZE);
    // Each egg takes its own spot in the straw.
    expect(new Set(eggs.map((e) => `${e.nestOffset!.x},${e.nestOffset!.y}`)).size).toBe(CLUTCH_SIZE);
    const egg = eggs[0];
    expect(egg.parents).toEqual([hen.id, drake.id]);
    expect(egg.lineage?.dam?.id).toBe(hen.id);
    expect(egg.lineage?.sire?.id).toBe(drake.id);
    expect(egg.lineage?.gen).toBe(1);
    expect(egg.nestOffset).toBeDefined();
    const nest = nestPos();
    expect(egg.pos).toEqual({ x: nest.x + egg.nestOffset!.x, y: nest.y + egg.nestOffset!.y });
    expect(state.stats.ducksBred).toBe(CLUTCH_SIZE);
    expect(state.stats.clutchesStarted).toBe(1);
  });

  it('a poor pair loses some of the clutch — each egg rolls on its own', () => {
    const { state, rng, hen, drake } = newGameWithPair();
    state.stats.ducksBred = 1; // past the guaranteed first clutch
    for (const d of [hen, drake]) {
      d.needs.happiness = 70;
      d.needs.health = 70;
    }
    // Across many clutches the take rate should sit near the viability.
    let laid = 0;
    const trials = 40;
    for (let i = 0; i < trials; i += 1) {
      state.ducks = state.ducks.filter((d) => d.stage !== 'egg');
      hen.breedingCooldownTicks = 0;
      drake.breedingCooldownTicks = 0;
      expect(nestPair(state, hen.id, drake.id).ok).toBe(true);
      advanceTicks(state, rng, COURTSHIP_TICKS, [tickBreeding]);
      laid += state.ducks.filter((d) => d.stage === 'egg').length;
    }
    const share = laid / (trials * CLUTCH_SIZE);
    const viability = pairViability(state, hen, drake);
    expect(share).toBeGreaterThan(viability - 0.15);
    expect(share).toBeLessThan(viability + 0.15);
  });

  it('a clutch whose mother left the pond is dropped without an egg', () => {
    const { state, rng, hen, drake } = newGameWithPair();
    nestPair(state, hen.id, drake.id);
    state.ducks = state.ducks.filter((d) => d !== hen); // sold mid-courtship
    advanceTicks(state, rng, COURTSHIP_TICKS, [tickBreeding]);
    expect(state.pendingClutches).toHaveLength(0);
    expect(state.ducks.filter((d) => d.stage === 'egg')).toHaveLength(0);
    expect(state.stats.ducksBred).toBe(0);
  });

  it('a clutch whose father left the pond is dropped too', () => {
    const { state, rng, hen, drake } = newGameWithPair();
    nestPair(state, hen.id, drake.id);
    state.ducks = state.ducks.filter((d) => d !== drake);
    advanceTicks(state, rng, COURTSHIP_TICKS, [tickBreeding]);
    expect(state.pendingClutches).toHaveLength(0);
    expect(state.ducks.filter((d) => d.stage === 'egg')).toHaveLength(0);
  });

  it('the very first clutch always takes, even for a miserable pair', () => {
    const { state, rng, hen, drake } = newGameWithPair();
    nestPair(state, hen.id, drake.id);
    // Below the breeding bar now, but the roll happens at lay time and the
    // first clutch skips it.
    hen.needs.happiness = 1;
    drake.needs.happiness = 1;
    hen.needs.health = 1;
    drake.needs.health = 1;
    expect(state.stats.ducksBred).toBe(0);
    advanceTicks(state, rng, COURTSHIP_TICKS, [tickBreeding]);
    expect(state.ducks.filter((d) => d.stage === 'egg').length).toBeGreaterThanOrEqual(1);
  });

  it('a stud clutch lays an egg sired by the rebuilt stud', () => {
    const { state, rng, hen } = newGameWithPair();
    state.money = 1_000_000;
    const offer = studOffers(state)[0];
    expect(hireStud(state, offer.rivalId, hen.id)).toEqual({ ok: true });
    const clutch = state.pendingClutches[0];
    expect(clutch.stud?.rivalId).toBe(offer.rivalId);
    advanceTicks(state, rng, COURTSHIP_TICKS, [tickBreeding]);
    const eggs = state.ducks.filter((d) => d.stage === 'egg');
    expect(eggs.length).toBeGreaterThanOrEqual(1);
    expect(eggs[0].parents).toEqual([hen.id, offer.drake.id]);
    expect(eggs[0].lineage?.sire?.name).toBe(offer.drake.name);
    expect(eggs[0].lineage?.sire?.genome).toEqual(offer.drake.genome);
  });
});

describe('clutchFather', () => {
  it('is the drake on the pond for an ordinary clutch', () => {
    const { state, hen, drake } = newGameWithPair();
    nestPair(state, hen.id, drake.id);
    expect(clutchFather(state, state.pendingClutches[0])).toBe(drake);
  });

  it('is undefined once that drake is gone', () => {
    const { state, hen, drake } = newGameWithPair();
    nestPair(state, hen.id, drake.id);
    state.ducks = state.ducks.filter((d) => d !== drake);
    expect(clutchFather(state, state.pendingClutches[0])).toBeUndefined();
  });

  it('rebuilds a hired stud from what the clutch remembers', () => {
    const { state, hen } = newGameWithPair();
    state.money = 1_000_000;
    const offer = studOffers(state)[0];
    expect(hireStud(state, offer.rivalId, hen.id).ok).toBe(true);
    const clutch = state.pendingClutches[0];
    const father = clutchFather(state, clutch)!;
    expect(father).toBeDefined();
    expect(father.id).toBe(clutch.fatherId);
    expect(father.name).toBe(offer.drake.name);
    expect(father.sex).toBe('M');
    expect(father.genome).toEqual(offer.drake.genome);
    // Not a pond duck: nobody on the flock carries that id.
    expect(state.ducks.some((d) => d.id === clutch.fatherId)).toBe(false);
  });

  it('rebuilds a stud even when its rival pond is gone from the save', () => {
    const { state, drake } = newGameWithPair();
    const clutch: PendingClutch = {
      motherId: 'm',
      fatherId: 'stud-1',
      ticksRemaining: 5,
      stud: { rivalId: 'no-such-rival', name: 'Torrent', genome: drake.genome },
    };
    const father = clutchFather(state, clutch)!;
    expect(father.id).toBe('stud-1');
    expect(father.name).toBe('Torrent');
    expect(father.sex).toBe('M');
    expect(father.stage).toBe('adult');
    expect(father.genome).toEqual(drake.genome);
  });
});

describe('nestSlotOffset', () => {
  it('gives the second egg a spot far from the first', () => {
    const { state, rng } = newGameWithPair();
    const first = nestSlotOffset(state, rng);
    // Every candidate sits within the straw.
    expect(Math.abs(first.x)).toBeLessThanOrEqual(35);
    expect(Math.abs(first.y)).toBeLessThanOrEqual(15);
    const egg = pushEgg(state, rng);
    egg.nestOffset = first;
    const second = nestSlotOffset(state, rng);
    expect(second).not.toEqual(first);
    expect(Math.hypot(second.x - first.x, second.y - first.y)).toBeGreaterThan(40);
  });

  it('keeps choosing the clearest spot as the nest fills', () => {
    const { state, rng } = newGameWithPair();
    const offsets: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 5; i += 1) {
      const offset = nestSlotOffset(state, rng);
      for (const prev of offsets) expect(Math.hypot(offset.x - prev.x, offset.y - prev.y)).toBeGreaterThan(15);
      offsets.push(offset);
      pushEgg(state, rng).nestOffset = offset;
    }
  });
});
