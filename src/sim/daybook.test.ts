import { describe, expect, it } from 'vitest';
import { createNewGame } from '../newGame';
import { Game } from '../game';
import { events } from '../events';
import { dawnLines, dawnReport, liveNotices } from './daybook';
import { createStarterDuck } from './duck';
import { installFakeStorage, pushEgg } from '../testFixtures';
import { NIGHT_END, TICKS_PER_HOUR, dayOf, hourOf, isNight } from './time';

describe('dawn report', () => {
  it("lists yesterday's passages from the chronicle, and lets older news go", () => {
    const { state } = createNewGame(9);
    state.clock.totalTicks = 4 * 24 * TICKS_PER_HOUR;
    const dayNow = dayOf(state.clock);
    state.chronicle.push({ day: dayNow - 1, kind: 'death', text: 'Puddles passed peacefully at 20 days.' });
    state.chronicle.push({ day: dayNow, kind: 'elder', text: 'Maple grew into an honoured elder at 14 days.' });
    state.chronicle.push({ day: dayNow - 1, kind: 'ofAge', text: 'Sorrel came of age.' });
    state.chronicle.push({ day: dayNow - 3, kind: 'death', text: 'Old news from days ago.' });
    // A carried entry from a previous pond: recent-looking day, older era.
    state.heritage = 1;
    state.chronicle.forEach((c) => { c.era = 1; });
    state.chronicle.push({ day: dayNow, kind: 'death', text: 'A previous pond passing.' });
    state.chronicle[state.chronicle.length - 1].era = 0;
    const report = dawnReport(state);
    expect(report.sections.some((s) => s.title === 'Milestones')).toBe(true);
    const text = dawnLines(report).join('\n');
    expect(text).toContain('Puddles');
    expect(text).toContain('Maple');
    expect(text).toContain('Sorrel');
    expect(text).not.toContain('Old news');
    expect(text).not.toContain('previous pond passing');
  });

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

  it('live notices: nothing on a content pond; each situation gets a card, urgent first', () => {
    const { state, rng } = createNewGame(8);
    for (const d of state.ducks) d.needs.hunger = 90;
    expect(liveNotices(state)).toEqual([]);
    state.pond.cleanliness = 40;
    let notes = liveNotices(state);
    expect(notes.map((n) => n.kind)).toEqual(['pond']);
    expect(notes[0].urgent).toBeFalsy();
    state.pond.cleanliness = 20;
    expect(liveNotices(state)[0].urgent).toBe(true);
    const sick = state.ducks[0];
    sick.sick = true;
    notes = liveNotices(state);
    expect(notes[0]).toMatchObject({ kind: 'sick', duckId: sick.id, urgent: true });
    state.lifeEvent = { id: 1, kind: 'broody', duckId: state.ducks[1].id, day: 0 } as unknown as typeof state.lifeEvent;
    expect(liveNotices(state)[0].kind).toBe('life');
    const egg = pushEgg(state, rng);
    egg.warmth = 10;
    expect(liveNotices(state).some((n) => n.kind === 'egg-cold' && n.urgent)).toBe(true);
    egg.readyToHatch = true;
    expect(liveNotices(state).some((n) => n.kind === 'egg-ready' && n.duckId === egg.id)).toBe(true);
    state.commissions.push({ id: 9, client: 'Marta', key: 'M|D|solid|n', reward: 100, postedDay: 0, expiresDay: dayOf(state.clock) + 1 } as unknown as (typeof state.commissions)[number]);
    expect(liveNotices(state).some((n) => n.kind === 'commission' && n.key === 'commission:9')).toBe(true);
  });

  it('names the duck nearest Champion and what it lacks, once the line is in view', () => {
    const { state } = createNewGame(7);
    expect(dawnLines(dawnReport(state)).join('\n')).not.toContain('to Champion');
    state.goals['chapter:ducks-life'] = true;
    const text = dawnLines(dawnReport(state)).join('\n');
    expect(text).toContain('of the way to Champion');
    expect(text).toContain('needs gen');
  });

  it('warns when the pond is overcrowded; elders do not count against the cap', () => {
    const { state, rng } = createNewGame(6);
    for (let i = 0; i < 5; i += 1) state.ducks.push(createStarterDuck(rng, { x: 0, y: 0 }));
    const text = dawnLines(dawnReport(state)).join('\n');
    expect(text).toContain('overcrowded by 1 duck');
    // Promoting a duck to elder frees its slot — the warning disappears.
    state.ducks[0].stage = 'elder';
    expect(dawnLines(dawnReport(state)).join('\n')).not.toContain('overcrowded');
  });
});

describe('sleep until dawn', () => {
  it('ticks through the night to exactly 06:00 and fires the dawn event once', () => {
    // Game touches browser globals in its constructor; stub the minimum.
    installFakeStorage();
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
