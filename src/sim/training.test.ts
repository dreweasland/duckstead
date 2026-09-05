import { describe, expect, it } from 'vitest';
import { createNewGame } from '../newGame';
import { canDrill, drillsLeft, drillsPerDay, isTrainingDay, nextTrainingDayIn, squadFor, squadSize, tickTraining, train, trainingAptitude, TRAINING, trainSquad } from './training';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from './time';

describe('training', () => {
  it('a drill raises the stat, costs hunger, and uses a daily slot', () => {
    const { state } = createNewGame(10);
    const duck = state.ducks[0];
    const hunger = duck.needs.hunger;
    expect(drillsLeft(state, duck)).toBe(1);
    const gain = train(state, duck.id, 'paddle', 1);
    expect(gain).toBeGreaterThanOrEqual(TRAINING.gainMin);
    expect(duck.training?.paddle).toBe(gain);
    expect(duck.needs.hunger).toBe(hunger - TRAINING.hungerCost);
    expect(drillsLeft(state, duck)).toBe(0);
    expect(train(state, duck.id, 'paddle', 1)).toBe(0); // no drills left
    expect(state.stats.drills).toBe(1);
  });

  it('the Training Perch buys extra drills a day', () => {
    const { state } = createNewGame(10);
    state.upgrades.trainingPerch = 2;
    expect(drillsPerDay(state)).toBe(3);
  });

  it('drills only happen on training day, every third day, for triple points', () => {
    const { state } = createNewGame(10);
    const duck = state.ducks[0];
    expect(isTrainingDay(state)).toBe(true); // day 0
    const gain = train(state, duck.id, 'paddle', 1);
    // A perfect drill on a fresh stat: (2 + 14) × aptitude × 3, give or take rounding and a friend.
    expect(gain).toBeGreaterThanOrEqual(Math.round(TRAINING.gainMax * 0.8 * TRAINING.gainScale));
    state.clock.totalTicks += TICKS_PER_DAY; // day 1
    expect(isTrainingDay(state)).toBe(false);
    expect(nextTrainingDayIn(state)).toBe(2);
    expect(canDrill(state, duck).reason).toBe('Training day is in 2 days');
    expect(train(state, duck.id, 'paddle', 1)).toBe(0);
    state.clock.totalTicks += TICKS_PER_DAY; // day 2
    expect(canDrill(state, duck).reason).toBe('Training day is tomorrow');
    state.clock.totalTicks += TICKS_PER_DAY; // day 3
    expect(isTrainingDay(state)).toBe(true);
    expect(train(state, duck.id, 'paddle', 1)).toBeGreaterThan(0);
  });

  it('one drill trains a squad of the nearest eligible ducks, one more per perch level', () => {
    const { state } = createNewGame(12);
    const [leader, near, far, penned] = state.ducks;
    leader.pos = { x: 400, y: 400 };
    near.pos = { x: 420, y: 400 };
    far.pos = { x: 700, y: 400 };
    penned.pos = { x: 410, y: 400 };
    penned.penned = true;
    expect(squadSize(state)).toBe(1);
    expect(squadFor(state, leader)).toEqual([]);
    state.upgrades.trainingPerch = 1;
    expect(squadSize(state)).toBe(2);
    expect(squadFor(state, leader).map((d) => d.id)).toEqual([near.id]); // nearest, and never a penned duck
    const result = trainSquad(state, leader.id, 'stamina', 0.7);
    expect(result.gain).toBeGreaterThan(0);
    expect(result.squad.map((m) => m.duck.id)).toEqual([near.id]);
    expect(near.training?.stamina).toBe(result.squad[0].gain);
    expect(far.training).toBeUndefined();
    expect(drillsLeft(state, near)).toBe(drillsPerDay(state) - 1); // the squad-mate used a slot too
    expect(state.stats.drills).toBe(2);
  });

  it('quality scales the gain; a fumbled drill still teaches a little', () => {
    const { state } = createNewGame(11);
    const [a, b] = state.ducks;
    const perfect = train(state, a.id, 'stamina', 1);
    const fumbled = train(state, b.id, 'stamina', 0);
    expect(perfect).toBeGreaterThan(fumbled);
    expect(fumbled).toBeGreaterThanOrEqual(1);
  });

  it('bold ducks take to paddle, timid ones to poise', () => {
    const { state } = createNewGame(12);
    const duck = state.ducks[0];
    duck.phenotype.boldness = 1;
    expect(trainingAptitude(duck, 'paddle')).toBeGreaterThan(1);
    expect(trainingAptitude(duck, 'poise')).toBeLessThan(1);
    duck.phenotype.boldness = 0;
    expect(trainingAptitude(duck, 'paddle')).toBeLessThan(1);
    expect(trainingAptitude(duck, 'poise')).toBeGreaterThan(1);
    expect(trainingAptitude(duck, 'stamina')).toBe(1);
  });

  it('stats fade a point at dawn and never below zero', () => {
    const { state } = createNewGame(13);
    const duck = state.ducks[0];
    duck.training = { paddle: 10, stamina: 1, poise: 0 };
    state.clock.totalTicks = TICKS_PER_DAY + 6 * TICKS_PER_HOUR;
    tickTraining(state);
    expect(duck.training).toEqual({ paddle: 9, stamina: 0, poise: 0 });
    state.clock.totalTicks += 1;
    tickTraining(state); // not dawn: nothing
    expect(duck.training.paddle).toBe(9);
  });

  it('sick, hungry, and young ducks can\'t drill', () => {
    const { state } = createNewGame(14);
    const duck = state.ducks[0];
    duck.sick = true;
    expect(canDrill(state, duck).ok).toBe(false);
    duck.sick = false;
    duck.needs.hunger = 10;
    expect(canDrill(state, duck).ok).toBe(false);
    duck.needs.hunger = 80;
    duck.stage = 'duckling';
    expect(canDrill(state, duck).ok).toBe(false);
  });
});
