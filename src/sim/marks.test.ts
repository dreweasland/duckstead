import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { createNewGame } from '../state';
import { createDuck, layEgg } from './duck';
import { tickLifecycle } from './lifecycle';
import { assignAdultMarks, assignJuvenileMarks, hasMark, happinessDecayScale, raceMarkScale, sicknessScale, treatCheerScale, upbringingOf } from './marks';
import { eatFood } from './food';
import { TICKS_PER_DAY } from './time';

describe('upbringing marks', () => {
  it('a warm egg hatches hardy; a cold one scrappy; a middling one neither', () => {
    const { state } = createNewGame(30);
    const [a, b, c] = state.ducks;
    for (const d of [a, b, c]) d.stage = 'duckling';
    upbringingOf(a).tended = 0.9;
    upbringingOf(b).tended = 0.2;
    upbringingOf(c).tended = 0.5;
    assignJuvenileMarks(state, a);
    assignJuvenileMarks(state, b);
    assignJuvenileMarks(state, c);
    expect(hasMark(a, 'hardy')).toBe(true);
    expect(hasMark(b, 'scrappy')).toBe(true);
    expect(c.marks ?? []).toEqual([]);
    expect(state.stats.marksEarned).toBe(2);
    expect(state.chronicle.some((e) => e.kind === 'mark')).toBe(true);
  });

  it('coming of age reads the youth: mentored → steady, raced → keen, treats → spoiled', () => {
    const { state } = createNewGame(31);
    const duck = state.ducks[0];
    duck.stage = 'juvenile';
    const u = upbringingOf(duck);
    u.youngTicks = 100;
    u.mentorTicks = 30;
    u.raced = true;
    u.treats = 3;
    assignAdultMarks(state, duck);
    expect(duck.marks).toEqual(expect.arrayContaining(['steady', 'keen', 'spoiled']));
    expect(duck.upbringing).toBeUndefined();
  });

  it('marks are granted at the real stage transitions', () => {
    const { state, rng } = createNewGame(32);
    const mother = state.ducks.find((d) => d.sex === 'F')!;
    const father = state.ducks.find((d) => d.sex === 'M')!;
    const egg = layEgg(rng, mother, father, { x: 100, y: 300 });
    egg.readyToHatch = true;
    egg.readyTicks = 10_000; // force the self-hatch
    egg.warmthSum = 95 * 10; // warm all along
    egg.ageTicks = 10;
    state.ducks.push(egg);
    tickLifecycle(state, rng);
    expect(egg.stage).toBe('duckling');
    expect(upbringingOf(egg).tended).toBeGreaterThan(0.8);
    egg.ageTicks = TICKS_PER_DAY * 2;
    tickLifecycle(state, rng);
    expect(egg.stage).toBe('juvenile');
    expect(hasMark(egg, 'hardy')).toBe(true);
  });

  it('treats eaten while young are tallied', () => {
    const { state } = createNewGame(33);
    const duck = state.ducks[0];
    duck.stage = 'juvenile';
    eatFood(state, duck, 'peas');
    eatFood(state, duck, 'feed');
    expect(upbringingOf(duck).treats).toBe(1);
  });

  it('effects read as documented', () => {
    const rng = createRng(1);
    const g = createDuck(rng, { genome: createNewGame(1).state.ducks[0].genome, stage: 'adult', pos: { x: 0, y: 0 } });
    expect(sicknessScale(g)).toBe(1);
    g.marks = ['hardy', 'scrappy', 'steady', 'keen', 'spoiled', 'proud'];
    expect(sicknessScale(g)).toBeCloseTo(0.72);
    expect(happinessDecayScale(g)).toBeCloseTo(0.99);
    expect(treatCheerScale(g)).toBe(1.5);
    expect(raceMarkScale(g)).toBeCloseTo(1.03 * 1.02 * 1.02);
  });
});
