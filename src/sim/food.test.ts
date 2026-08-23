import { describe, expect, it } from 'vitest';
import { createNewGame } from '../state';
import { eatFood, favouriteTreat, FOODS, TREATS } from './food';
import { dropFood, feedDuckDirectly } from './needs';
import { tickBehavior } from './behavior';
import { isUnlocked } from './unlocks';

describe('favourite treats', () => {
  it('every duck favours one treat, fixed for life', () => {
    const { state, rng } = createNewGame(31);
    const duck = state.ducks[0];
    const fav = favouriteTreat(duck);
    expect(TREATS).toContain(fav);
    expect(favouriteTreat(duck)).toBe(fav);
    // Same seed, same ids, same favourite.
    expect(favouriteTreat(createNewGame(31).state.ducks[0])).toBe(fav);
    void rng;
  });

  it('the favourite restores more, cheers the duck, and is discovered once', () => {
    const { state } = createNewGame(32);
    const duck = state.ducks[0];
    const fav = favouriteTreat(duck);
    const other = TREATS.find((t) => t !== fav)!;
    duck.needs.hunger = 20;
    duck.needs.happiness = 50;
    const plain = eatFood(state, duck, other);
    expect(plain.favourite).toBe(false);
    const afterOther = duck.needs.hunger;
    duck.needs.hunger = 20;
    const loved = eatFood(state, duck, fav);
    expect(loved.favourite).toBe(true);
    expect(loved.discovered).toBe(true);
    expect(duck.needs.hunger).toBeGreaterThan(afterOther);
    expect(duck.favouriteKnown).toBe(true);
    expect(state.stats.favouritesFound).toBe(1);
    expect(eatFood(state, duck, fav).discovered).toBe(false);
  });

  it('hand-feeding and dropped treats both draw from the inventory', () => {
    const { state, rng } = createNewGame(33);
    const duck = state.ducks[0];
    state.inventory.worms = 2;
    expect(feedDuckDirectly(state, duck.id, 'worms')).not.toBeNull();
    expect(state.inventory.worms).toBe(1);
    expect(dropFood(state, { x: duck.pos.x, y: duck.pos.y }, 'worms')).toBe(true);
    expect(state.inventory.worms).toBe(0);
    expect(state.foodPellets[0].kind).toBe('worms');
    expect(FOODS[state.foodPellets[0].kind!].treat).toBe(true);
    expect(dropFood(state, { x: 0, y: 0 }, 'worms')).toBe(false);
    // A hungry duck eats the pellet and gets its effect.
    duck.needs.hunger = 30;
    for (let i = 0; i < 200 && state.foodPellets.length > 0; i += 1) tickBehavior(state, rng);
    expect(state.foodPellets.length).toBe(0);
    expect(state.stats.feeds).toBe(2);
  });
});

describe('unlocks', () => {
  it('panels open as the goal chain is played, and stay open for seasoned saves', () => {
    const { state } = createNewGame(34);
    expect(isUnlocked(state, 'breeding')).toBe(false);
    expect(isUnlocked(state, 'shop')).toBe(false);
    expect(isUnlocked(state, 'race')).toBe(false);
    state.stats.pets = 4;
    expect(isUnlocked(state, 'breeding')).toBe(true);
    state.stats.ducksBred = 1;
    expect(isUnlocked(state, 'shop')).toBe(true);
    state.stats.ducksHatched = 1;
    expect(isUnlocked(state, 'book')).toBe(true);
    expect(isUnlocked(state, 'race')).toBe(true);
  });
});
