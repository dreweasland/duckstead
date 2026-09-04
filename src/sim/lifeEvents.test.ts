import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { createNewGame } from '../newGame';
import { newGameWithPair } from '../testFixtures';
import { layEgg } from './duck';
import { hasMark } from './marks';
import { broodyHenToday, describeLifeEvent, LIFE_EVENT_EXPIRE_HOUR, LIFE_EVENT_ROLL_HOUR, lifeEventChoices, resolveLifeEvent, rollLifeEvent, tickLifeEvents } from './lifeEvents';
import { canLayToday } from './laying';
import { TICKS_PER_HOUR } from './time';

describe('life events', () => {
  it('rolls only when there is someone to roll for', () => {
    const { state, rng } = createNewGame(40);
    state.ducks = state.ducks.filter((d) => d.sex === 'F'); // no drakes, no eggs
    expect(rollLifeEvent(state, rng)).toBeNull();
    const withDrakes = createNewGame(40);
    const ev = rollLifeEvent(withDrakes.state, withDrakes.rng);
    expect(ev?.kind).toBe('rivalry'); // two drakes, no eggs
  });

  it('a broody hen sits the nest: no egg from her, warmth held, then it clears', () => {
    const { state, rng, hen: mother, drake: father } = newGameWithPair(41);
    state.ducks.push(layEgg(rng, mother, father, { x: 100, y: 300 }));
    const ev = { id: 1, kind: 'broody' as const, duckId: mother.id, day: 0 };
    state.lifeEvent = ev;
    expect(describeLifeEvent(state, ev).title).toMatch(/broody/);
    expect(lifeEventChoices(state, ev).map((c) => c.id)).toEqual(['sit', 'shoo']);
    const hen = state.ducks.find((d) => d.id === ev.duckId)!;
    expect(resolveLifeEvent(state, rng, 'sit')).toMatch(/settles/);
    expect(state.lifeEvent).toBeNull();
    expect(broodyHenToday(state)).toBe(true);
    expect(canLayToday(hen, 0)).toBe(false);
    expect(state.stats.lifeEventsSettled).toBe(1);
    // The next day she's off the nest.
    expect(canLayToday({ ...hen, lastLayDay: undefined, needs: { ...hen.needs, hunger: 90, happiness: 90 } }, 1)).toBe(true);
  });

  it('a rivalry settled leaves one drake proud and the other bruised', () => {
    const { state, rng } = createNewGame(42);
    const [a, b] = state.ducks.filter((d) => d.sex === 'M');
    state.lifeEvent = { id: 1, kind: 'rivalry', duckId: a.id, otherId: b.id, day: 0 };
    const healthBefore = a.needs.health + b.needs.health;
    resolveLifeEvent(state, rng, 'settle');
    expect(hasMark(a, 'proud') !== hasMark(b, 'proud')).toBe(true);
    expect(a.needs.health + b.needs.health).toBe(healthBefore - 6);
  });

  it('treats need stock; the pen needs a pen', () => {
    const { state, rng } = createNewGame(43);
    const [a, b] = state.ducks.filter((d) => d.sex === 'M');
    state.lifeEvent = { id: 1, kind: 'rivalry', duckId: a.id, otherId: b.id, day: 0 };
    state.inventory.premiumFeed = 0;
    const choices = lifeEventChoices(state, state.lifeEvent);
    expect(choices.find((c) => c.id === 'treats')?.ok).toBe(false);
    expect(choices.find((c) => c.id === 'pen')?.ok).toBe(false);
    expect(resolveLifeEvent(state, rng, 'treats')).toBeNull();
    state.inventory.premiumFeed = 5;
    expect(resolveLifeEvent(state, rng, 'treats')).toMatch(/treats/);
    expect(state.inventory.premiumFeed).toBe(3);
  });

  it('the tick rolls at 11:00 and settles an unanswered event by evening', () => {
    const { state, rng } = createNewGame(44);
    const seeded = createRng(5);
    let rolled = 0;
    for (let day = 0; day < 40 && rolled === 0; day += 1) {
      state.clock.totalTicks = day * 24 * TICKS_PER_HOUR + LIFE_EVENT_ROLL_HOUR * TICKS_PER_HOUR;
      tickLifeEvents(state, seeded);
      if (state.lifeEvent) rolled += 1;
    }
    expect(rolled).toBe(1);
    const day = state.lifeEvent!.day;
    state.clock.totalTicks = day * 24 * TICKS_PER_HOUR + LIFE_EVENT_EXPIRE_HOUR * TICKS_PER_HOUR;
    tickLifeEvents(state, rng);
    expect(state.lifeEvent).toBeNull();
    expect(state.stats.lifeEventsSettled).toBe(0); // the flock decided, not the player
  });
});
