import { describe, expect, it } from 'vitest';
import { createNewGame } from '../state';
import { canDrill, drillsLeft, drillsPerDay, tickTraining, train, trainingAptitude, TRAINING } from './training';
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
