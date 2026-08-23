import { describe, expect, it } from 'vitest';
import { createNewGame } from '../state';
import { canLayToday, tickLaying } from './laying';
import { catchBugAt } from './bugs';
import { henEggPrice, sellEggBasket } from './economy';
import { isInPond, pondDistance } from './pond';
import { TICKS_PER_HOUR } from './time';

describe('hen laying', () => {
  it('content hens each lay one egg a day; it lands on dry ground and fills the basket', () => {
    const { state, rng } = createNewGame(15);
    state.clock.totalTicks = 7 * TICKS_PER_HOUR; // 07:00 day 0
    for (const d of state.ducks) {
      d.needs.happiness = 90;
      d.needs.hunger = 90;
    }
    const hens = state.ducks.filter((d) => d.sex === 'F');
    expect(hens.length).toBe(2);
    for (let i = 0; i < 10 * TICKS_PER_HOUR; i += 1) {
      state.clock.totalTicks += 1;
      tickLaying(state, rng);
    }
    const eggs = state.bugs.filter((b) => b.kind === 'henEgg');
    expect(eggs.length).toBe(2);
    for (const egg of eggs) {
      expect(isInPond(state, egg.pos)).toBe(false);
      expect(pondDistance(state, egg.pos)).toBeGreaterThanOrEqual(1.2); // clear of the painted shoreline
    }
    for (const hen of hens) expect(canLayToday(hen, 0)).toBe(false);

    const money = state.money;
    for (const egg of eggs) expect(catchBugAt(state, egg.pos.x, egg.pos.y)?.kind).toBe('henEgg');
    expect(state.inventory.eggs).toBe(2);
    expect(state.stats.henEggsGathered).toBe(2);
    expect(sellEggBasket(state)).toBe(2 * henEggPrice(state));
    expect(state.money).toBe(money + 2 * henEggPrice(state));
    expect(state.inventory.eggs).toBe(0);
  });

  it('hungry, sad, sick, or courting hens do not lay', () => {
    const { state } = createNewGame(16);
    const hen = state.ducks.find((d) => d.sex === 'F')!;
    hen.needs.happiness = 90;
    hen.needs.hunger = 90;
    expect(canLayToday(hen, 3)).toBe(true);
    hen.needs.hunger = 30;
    expect(canLayToday(hen, 3)).toBe(false);
    hen.needs.hunger = 90;
    hen.sick = true;
    expect(canLayToday(hen, 3)).toBe(false);
    hen.sick = false;
    hen.lastLayDay = 3;
    expect(canLayToday(hen, 3)).toBe(false);
    expect(canLayToday(hen, 4)).toBe(true);
  });
});
