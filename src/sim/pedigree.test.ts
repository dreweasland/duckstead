import { describe, expect, it } from 'vitest';
import { newGameWithPair } from '../testFixtures';
import { createStarterDuck, layEgg } from './duck';
import { closeKin, generationOf, livingDescendants } from './lineage';
import { homozygousBookLoci, isPureBred, pedigree, pedigreeScore } from './pedigree';
import { sellPrice } from './economy';
import { tickLifecycle } from './lifecycle';
import { chronicle } from './chronicle';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from './time';

describe('lineage', () => {
  it('stamps two generations on the egg and survives the parents leaving', () => {
    const { state, rng, hen: m, drake: f } = newGameWithPair(40);
    const egg = layEgg(rng, m, f, { x: 0, y: 0 });
    expect(generationOf(egg)).toBe(1);
    expect(egg.lineage!.dam!.name).toBe(m.name);
    expect(egg.lineage!.sire!.id).toBe(f.id);
    expect(egg.lineage!.grand.every((g) => g === null)).toBe(true);
    state.ducks.push(egg);
    expect(livingDescendants(state, m.id)).toHaveLength(1);
    // Parent gone: the tree still knows.
    state.ducks.splice(state.ducks.indexOf(m), 1);
    expect(egg.lineage!.dam!.genome).toEqual(m.genome);
    // Grandchild carries the grandparents.
    egg.stage = 'adult';
    const other = createStarterDuck(rng, { x: 0, y: 0 }, egg.sex === 'F' ? 'M' : 'F');
    const grandchild = layEgg(rng, egg.sex === 'F' ? egg : other, egg.sex === 'F' ? other : egg, { x: 0, y: 0 });
    expect(generationOf(grandchild)).toBe(2);
    expect(grandchild.lineage!.grand.filter(Boolean).map((g) => g!.id)).toContain(f.id);
  });

  it('recognises close kin and depresses vigor for their clutches', () => {
    const { rng, hen: m, drake: f } = newGameWithPair(41);
    for (const d of [m, f]) { d.genome.vigor1 = ['+', '+']; d.genome.vigor2 = ['+', '+']; }
    const a = layEgg(rng, m, f, { x: 0, y: 0 });
    const b = layEgg(rng, m, f, { x: 0, y: 0 });
    a.sex = 'F'; b.sex = 'M'; a.stage = 'adult'; b.stage = 'adult';
    expect(closeKin(a, b)).toBe(true); // siblings
    expect(closeKin(a, f)).toBe(true); // parent
    expect(closeKin(m, f)).toBe(false);
    let minus = 0;
    for (let i = 0; i < 60; i += 1) {
      const kid = layEgg(rng, a, b, { x: 0, y: 0 });
      minus += [...kid.genome.vigor1, ...kid.genome.vigor2].filter((x) => x === '-').length;
    }
    expect(minus).toBeGreaterThan(20); // ~35% of 240 alleles (mutation alone would give ~5)
  });
});

describe('pedigree', () => {
  it('rises with generations, fixed genes, rare alleles, and pure breeding; prices follow', () => {
    const { state, rng, hen: m, drake: f } = newGameWithPair(42);
    const founder = state.ducks[0];
    const p0 = pedigree(founder);
    expect(p0.gen).toBe(0);
    expect(p0.pure).toBe(false);
    const kid = layEgg(rng, m, f, { x: 0, y: 0 });
    expect(pedigree(kid).gen).toBe(1);
    kid.genome.baseColor = ['B', 'B'];
    kid.genome.crest = ['R', 'R'];
    kid.genome.dilution = ['D', 'D'];
    kid.genome.pattern = ['S', 'S'];
    expect(homozygousBookLoci(kid)).toBe(4);
    expect(pedigree(kid).rare).toBe(4);
    expect(pedigreeScore(kid)).toBeGreaterThanOrEqual(9);
    // Pure: both parents share the kid's breed.
    kid.lineage!.dam!.genome = { ...kid.genome };
    kid.lineage!.sire!.genome = { ...kid.genome };
    expect(isPureBred(kid)).toBe(true);
    kid.stage = 'adult';
    const plain = createStarterDuck(rng, { x: 0, y: 0 });
    plain.genome = { ...kid.genome };
    plain.phenotype = kid.phenotype;
    expect(sellPrice(state, kid)).toBeGreaterThan(sellPrice(state, plain));
  });
});

describe('birthdays and chronicle', () => {
  it('ducks get a seasonal birthday that can actually arrive, and deaths are chronicled with lineage', () => {
    const { state, rng, hen: m, drake: f } = newGameWithPair(43);
    const duck = state.ducks[0];
    duck.bornDay = 0;
    state.clock.totalTicks = 6 * TICKS_PER_DAY + 9 * TICKS_PER_HOUR; // day 6, 09:00 — one season old
    duck.needs.happiness = 50;
    tickLifecycle(state, rng);
    expect(duck.needs.happiness).toBe(60);
    // Death with descendants.
    state.ducks.push(layEgg(rng, m, f, { x: 0, y: 0 }));
    m.needs.health = 0;
    tickLifecycle(state, rng);
    const gone = state.memorial.find((x) => x.name === m.name)!;
    expect(gone.descendants).toBe(1);
    expect(state.chronicle.some((c) => c.kind === 'death' && c.text.includes(m.name) && c.text.includes('line lives on'))).toBe(true);
    chronicle(state, 'milestone', 'x');
    expect(state.chronicle.length).toBeGreaterThan(1);
  });
});
