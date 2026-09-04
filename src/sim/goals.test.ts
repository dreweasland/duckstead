import { describe, expect, it } from 'vitest';
import { createNewGame } from '../newGame';
import { advanceTicks } from '../testFixtures';
import { catchBugAt, tickBugs } from './bugs';
import { CHAPTERS, chapterGoals, currentChapter, GOALS, goalLater, tickGoals, widgetGoals } from './goals';
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
    advanceTicks(state, rng, 4 * TICKS_PER_HOUR, [tickBugs]);
    expect(state.bugs.some((b) => b.kind === 'firefly')).toBe(true);
    expect(state.bugs.some((b) => b.kind === 'beetle' || b.kind === 'snail')).toBe(false);
    state.clock.totalTicks = 24 * TICKS_PER_HOUR + 7 * TICKS_PER_HOUR; // 07:00 next day
    tickBugs(state, rng);
    expect(state.bugs.some((b) => b.kind === 'firefly')).toBe(false);
  });
});

describe('goal chapters', () => {
  it('every goal belongs to a chapter and carries a hint', () => {
    for (const goal of GOALS) {
      expect(CHAPTERS.some((c) => c.id === goal.chapter)).toBe(true);
      expect(goal.hint.length).toBeGreaterThan(20);
      if (goal.after) expect(GOALS.some((g) => g.id === goal.after)).toBe(true);
    }
    for (const ch of CHAPTERS) expect(chapterGoals(ch.id).length).toBeGreaterThan(0);
  });

  it('a chapter pays its purse once, when its last goal lands', () => {
    const { state } = createNewGame(21);
    const first = chapterGoals('first-days');
    for (const g of first.slice(0, -1)) state.goals[g.id] = true;
    tickGoals(state);
    expect(state.goals['chapter:first-days']).toBeUndefined();
    expect(currentChapter(state).id).toBe('first-days');
    const money = state.money;
    state.goals[first[first.length - 1].id] = true;
    tickGoals(state);
    expect(state.goals['chapter:first-days']).toBe(true);
    expect(state.money).toBe(money + CHAPTERS[0].reward);
    expect(currentChapter(state).id).toBe('daily-round');
    tickGoals(state);
    expect(state.money).toBe(money + CHAPTERS[0].reward);
  });

  it('says why a goal is for later: a locked panel, an earlier goal, or its own reason', () => {
    const { state } = createNewGame(22);
    const nest = GOALS.find((g) => g.id === 'nest-pair')!;
    expect(goalLater(state, nest)).toMatch(/Breeding/);
    state.stats.pets = 4;
    expect(goalLater(state, nest)).toBeUndefined();
    const basket = GOALS.find((g) => g.id === 'sell-basket')!;
    state.stats.ducksBred = 1; // the shop is open
    expect(goalLater(state, basket)).toMatch(/After/);
    state.goals['egg-basket'] = true;
    expect(goalLater(state, basket)).toBeUndefined();
    const heritage = GOALS.find((g) => g.id === 'heritage-1')!;
    expect(goalLater(state, heritage)).toMatch(/10 breeds/);
  });

  it('the widget leads with what can be done now and borrows from the next chapter when little can', () => {
    const { state } = createNewGame(23);
    const rows = widgetGoals(state, 5);
    expect(rows[0].later).toBeUndefined();
    const firstLater = rows.findIndex((r) => r.later);
    if (firstLater >= 0) expect(rows.slice(firstLater).every((r) => r.later || r.upNext)).toBe(true);
    // Finish all but one doable goal of the first chapter: the widget fills
    // from the daily round, marked as up next.
    for (const g of chapterGoals('first-days')) if (g.id !== 'catch-bugs') state.goals[g.id] = true;
    state.stats.pets = 4;
    state.stats.ducksBred = 1;
    state.stats.ducksHatched = 1;
    const later = widgetGoals(state, 5);
    expect(later[0].goal.id).toBe('catch-bugs');
    expect(later.some((r) => r.upNext)).toBe(true);
    expect(later.filter((r) => r.upNext).every((r) => r.goal.chapter === 'daily-round' && !r.later)).toBe(true);
  });
});
