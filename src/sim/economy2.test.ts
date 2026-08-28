import { describe, expect, it } from 'vitest';
import { createNewGame } from '../state';
import { layEgg } from './duck';
import { sellPrice } from './economy';

describe('egg pricing without candling', () => {
  it('two eggs from the same parents price identically whatever their hidden genes', () => {
    const { state, rng } = createNewGame(50);
    const mother = state.ducks.find((d) => d.sex === 'F')!;
    const father = state.ducks.find((d) => d.sex === 'M')!;
    const prices = new Set<number>();
    for (let i = 0; i < 40; i += 1) {
      const egg = layEgg(rng, mother, father, { x: 0, y: 0 });
      // Force wildly different hidden genes on some eggs.
      if (i % 2 === 0) {
        egg.genome.baseColor = ['B', 'B'];
        egg.genome.crest = ['R', 'R'];
        egg.genome.billColor = ['P', 'P'];
      }
      prices.add(sellPrice(state, egg));
    }
    expect(prices.size).toBe(1);
  });

  it('parents\' rarity still lifts an egg\'s price', () => {
    const { state, rng } = createNewGame(51);
    const mother = state.ducks.find((d) => d.sex === 'F')!;
    const father = state.ducks.find((d) => d.sex === 'M')!;
    const plain = sellPrice(state, layEgg(rng, mother, father, { x: 0, y: 0 }));
    mother.phenotype.rarityScore = 6;
    const fancy = sellPrice(state, layEgg(rng, mother, father, { x: 0, y: 0 }));
    expect(fancy).toBeGreaterThan(plain);
  });
});
