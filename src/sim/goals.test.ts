import { describe, expect, it } from 'vitest';
import { createNewGame } from '../state';
import { catchBugAt, tickBugs } from './bugs';
import { GOALS, tickGoals } from './goals';
import { fillFeeder } from './needs';
import { TICKS_PER_HOUR } from './time';

describe('goals', () => {
  it('awards each goal once when its condition is met', () => {
    const { state } = createNewGame(5);
    state.upgrades.feedingTrough = 1;
    const money = state.money;
    fillFeeder(state);
    tickGoals(state);
    expect(state.goals['fill-trough']).toBe(true);
    // Owning the trough also satisfies the "buy any upgrade" goal.
    expect(state.goals['first-upgrade']).toBe(true);
    const expected =
      GOALS.find((g) => g.id === 'fill-trough')!.reward +
      GOALS.find((g) => g.id === 'first-upgrade')!.reward;
    expect(state.money).toBe(money + expected);
    // Running again must not pay twice.
    const after = state.money;
    tickGoals(state);
    expect(state.money).toBe(after);
  });

  it('tracks progress-based goals via stats', () => {
    const { state } = createNewGame(6);
    state.stats.ducksHatched = 1;
    state.stats.bugsCaught = 5;
    tickGoals(state);
    expect(state.goals['first-hatch']).toBe(true);
    expect(state.goals['catch-bugs']).toBe(true);
    expect(state.goals['sell-duck']).toBeUndefined();
  });
});

describe('bugs', () => {
  it('spawns bugs over time during the day', () => {
    const { state, rng } = createNewGame(7);
    state.ducks = []; // no ducks to eat them
    for (let i = 0; i < 6 * TICKS_PER_HOUR; i += 1) tickBugs(state, rng);
    expect(state.bugs.length).toBeGreaterThan(0);
  });

  it('catching a bug pays coins and counts toward stats', () => {
    const { state, rng } = createNewGame(8);
    state.ducks = [];
    const isCritter = () => state.bugs.find((b) => b.kind === 'beetle' || b.kind === 'snail');
    for (let i = 0; i < 12 * TICKS_PER_HOUR && !isCritter(); i += 1) {
      tickBugs(state, rng);
    }
    const bug = isCritter()!;
    const money = state.money;
    const pickup = catchBugAt(state, bug.pos.x, bug.pos.y)!;
    expect(pickup.coins).toBeGreaterThan(0);
    expect(state.money).toBe(money + pickup.coins);
    expect(state.stats.bugsCaught).toBe(1);
    // A miss far away pays nothing.
    expect(catchBugAt(state, -500, -500)).toBeNull();
  });

  it('ducks molt feathers that fill the album, and duckweed pays in feed', () => {
    const { state, rng } = createNewGame(9);
    for (let i = 0; i < 24 * TICKS_PER_HOUR; i += 1) tickBugs(state, rng);
    const feather = state.bugs.find((b) => b.kind === 'feather')!;
    expect(feather).toBeDefined();
    expect(feather.color).toBeTruthy();
    const got = catchBugAt(state, feather.pos.x, feather.pos.y)!;
    expect(got.kind).toBe('feather');
    expect(state.featherAlbum[feather.color!]).toBe(1);
    expect(state.stats.feathersCollected).toBe(1);

    const weed = state.bugs.find((b) => b.kind === 'duckweed')!;
    expect(weed).toBeDefined();
    const feed = state.inventory.feed;
    const gotWeed = catchBugAt(state, weed.pos.x, weed.pos.y)!;
    expect(gotWeed.feed).toBe(1);
    expect(state.inventory.feed).toBe(feed + 1);
  });

  it('fireflies only glow at night and vanish at dawn', () => {
    const { state, rng } = createNewGame(10);
    state.ducks = [];
    state.clock.totalTicks = 22 * TICKS_PER_HOUR; // 22:00
    for (let i = 0; i < 4 * TICKS_PER_HOUR; i += 1) {
      state.clock.totalTicks += 1;
      tickBugs(state, rng);
    }
    expect(state.bugs.some((b) => b.kind === 'firefly')).toBe(true);
    expect(state.bugs.some((b) => b.kind === 'beetle' || b.kind === 'snail')).toBe(false);
    state.clock.totalTicks = 24 * TICKS_PER_HOUR + 7 * TICKS_PER_HOUR; // 07:00 next day
    tickBugs(state, rng);
    expect(state.bugs.some((b) => b.kind === 'firefly')).toBe(false);
  });
});
