import { describe, expect, it } from 'vitest';
import { createNewGame } from '../state';
import { Game } from '../game';
import { events } from '../events';
import { dawnLines, dawnReport } from './daybook';
import { createStarterDuck } from './duck';
import { NIGHT_END, TICKS_PER_HOUR, hourOf, isNight } from './time';

describe('dawn report', () => {
  it('lists festival, buyer, cold eggs, and pond state', () => {
    const { state } = createNewGame(5);
    state.clock.totalTicks = 3 * 24 * TICKS_PER_HOUR + 6 * TICKS_PER_HOUR; // day 4 = Egg Show
    state.request = { wants: { pattern: 'spotted' }, multiplier: 2.5, expiresDay: 9 };
    state.pond.cleanliness = 50;
    const egg = { ...state.ducks[0], id: 'e', stage: 'egg' as const, warmth: 10 };
    state.ducks.push(egg);
    const report = dawnReport(state);
    const text = dawnLines(report).join('\n');
    expect(report.festivalChip).toBe('Spring Egg Show today!');
    expect(text).toContain('spotted duck');
    expect(text).toContain('went cold');
    expect(text).toContain('50% clean');
    expect(report.dayLabel).toBe('Day 4 of Spring · Year 1');
    expect(report.stats.pond).toBe(50);
    expect(report.sections.map((s) => s.title)).toEqual(['Opportunities', 'The nest', 'Chores']);
  });

  it('warns when the pond is overcrowded, naming elders that could retire', () => {
    const { state, rng } = createNewGame(6);
    for (let i = 0; i < 5; i += 1) state.ducks.push(createStarterDuck(rng, { x: 0, y: 0 }));
    state.ducks[0].stage = 'elder';
    const text = dawnLines(dawnReport(state)).join('\n');
    expect(text).toContain('overcrowded by 1 duck');
    expect(text).toContain('1 elder could retire');
  });
});

describe('sleep until dawn', () => {
  it('ticks through the night to exactly 06:00 and fires the dawn event once', () => {
    // Game touches browser globals in its constructor; stub the minimum.
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    };
    (globalThis as any).window = { addEventListener: () => {} };
    const game = new Game();
    game.state.clock.totalTicks = 22 * TICKS_PER_HOUR; // 22:00
    let dawns = 0;
    const off = events.on('dawn', () => (dawns += 1));
    const slept = game.sleepUntilDawn();
    off();
    expect(slept).toBe(8 * TICKS_PER_HOUR);
    expect(hourOf(game.state.clock)).toBe(NIGHT_END);
    expect(isNight(game.state.clock)).toBe(false);
    expect(dawns).toBe(1);
    // Not at night: no-op.
    expect(game.sleepUntilDawn()).toBe(0);
  });
});
