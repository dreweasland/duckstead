import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { createNewGame } from '../state';
import { createDuck } from './duck';
import { randomCommonGenome, type Genome } from './genetics';
import { boostPower, enterRace, racedToday, raceEligible, raceSpeed, settleRace } from './race';
import { train } from './training';

function duckWith(edit: (g: Genome) => void, seed = 3): ReturnType<typeof createDuck> {
  const rng = createRng(seed);
  const genome: Genome = randomCommonGenome(rng);
  edit(genome);
  return createDuck(rng, { genome, stage: 'adult', pos: { x: 0, y: 0 }, name: 'x' });
}

describe('race speed', () => {
  it('vigorous ducks are faster than frail ones', () => {
    const fast = duckWith((g) => { g.vigor1 = ['+', '+']; g.vigor2 = ['+', '+']; });
    const slow = duckWith((g) => { g.vigor1 = ['-', '-']; g.vigor2 = ['-', '-']; });
    expect(raceSpeed(fast)).toBeGreaterThan(raceSpeed(slow));
  });

  it('bold ducks are faster than timid ones', () => {
    const bold = duckWith((g) => { g.temper1 = ['+', '+']; g.temper2 = ['+', '+']; });
    const timid = duckWith((g) => { g.temper1 = ['-', '-']; g.temper2 = ['-', '-']; });
    expect(raceSpeed(bold)).toBeGreaterThan(raceSpeed(timid));
  });

  it('training adds speed on top of the genes', () => {
    const { state } = createNewGame(4);
    const duck = state.ducks[0];
    const before = raceSpeed(duck);
    duck.training = { paddle: 100, stamina: 100, poise: 0 };
    expect(raceSpeed(duck)).toBeCloseTo(before * 1.2, 5);
  });

  it('speeds land in a sane range', () => {
    const rng = createRng(9);
    for (let i = 0; i < 50; i += 1) {
      const duck = createDuck(rng, { genome: randomCommonGenome(rng), stage: 'adult', pos: { x: 0, y: 0 } });
      const speed = raceSpeed(duck);
      expect(speed).toBeGreaterThan(25);
      expect(speed).toBeLessThan(110);
    }
  });
});

describe('race fairness', () => {
  it('paddle power rewards precision and punishes mashing', () => {
    expect(boostPower(0.5)).toBe(1);
    expect(boostPower(0.35)).toBeCloseTo(0.49);
    expect(boostPower(0.1)).toBeCloseTo(0.1); // floor
    expect(boostPower(0)).toBeCloseTo(0.1);
  });

  it('a duck races the derby once per day', () => {
    const duck = duckWith(() => {});
    expect(racedToday(duck, 3)).toBe(false);
    duck.lastRaceDay = 3;
    expect(racedToday(duck, 3)).toBe(true);
    expect(racedToday(duck, 4)).toBe(false);
  });

  it('penned ducks are not eligible', () => {
    const { state } = createNewGame(5);
    const n = raceEligible(state).length;
    state.ducks[0].penned = true;
    expect(raceEligible(state).length).toBe(n - 1);
  });
});

describe('race settlement', () => {
  it('entry takes the fee and marks the day; settlement pays and records', () => {
    const { state } = createNewGame(6);
    const duck = state.ducks[0];
    const money = state.money;
    expect(enterRace(state, duck.id, 5)).toBe(true);
    expect(state.money).toBe(money - 5);
    expect(racedToday(duck, 0)).toBe(true);
    const { prize } = settleRace(state, { duckId: duck.id, place: 0, prizes: [15, 6, 0, 0], league: true, title: 'Pond Derby' });
    expect(prize).toBe(15);
    expect(state.money).toBe(money - 5 + 15);
    expect(state.stats.racesWon).toBe(1);
    expect(state.league.wins).toBe(1);
  });

  it('refuses entry without the fee', () => {
    const { state } = createNewGame(6);
    state.money = 2;
    expect(enterRace(state, state.ducks[0].id, 5)).toBe(false);
  });

  it('a drill feeds straight into the speed a race reads', () => {
    const { state } = createNewGame(7);
    const duck = state.ducks[0];
    const before = raceSpeed(duck);
    expect(train(state, duck.id, 'paddle', 1)).toBeGreaterThan(0);
    expect(raceSpeed(duck)).toBeGreaterThan(before);
  });
});
