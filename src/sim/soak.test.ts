import { describe, expect, it } from 'vitest';
import { createNewGame } from '../newGame';
import { tickBehavior } from './behavior';
import { nestPair, tickBreeding } from './breeding';
import { canBreedPair } from './needs';
import { tickLifecycle } from './lifecycle';
import { tickNeeds } from './needs';
import { tickPond } from './pond';
import { dropFood } from './needs';
import { tickVisitors } from './visitors';
import { tickBugs } from './bugs';
import { tickLaying } from './laying';
import { tickGoals } from './goals';
import { tickAwards } from './awards';
import { tickCommissions } from './commissions';
import { tickFestivals } from './festivals';
import { tickTraining, train } from './training';
import { resolveLifeEvent, tickLifeEvents } from './lifeEvents';
import { tickWeather } from './weather';
import { tickRivals } from './rivals';
import { tickCup } from './cup';
import { seasonOf, TICKS_PER_YEAR } from './time';
import { isOvercrowded, sellDuck } from './economy';
import { LOCI } from './genetics';
import { CHRONICLE_CAP } from './chronicle';
import { MEMORIAL_CAP } from '../state';
import { deserialize, serialize } from '../save/save';

// Long-run stability: simulate ~1.5 game-years with a simple caretaker bot.
// Guards against NaNs, runaway values, and death-spiral balance bugs. It is
// the only integration-level guard, so it stays in `npm test` and CI; the
// watch loop skips it (12s per rerun) — run `npm test` before pushing.
const watchMode = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VITEST_MODE === 'WATCH';
describe.skipIf(watchMode)('soak', () => {
  it('survives 1.5 game-years of simulation without corruption', () => {
    const { state, rng } = createNewGame(2024);
    state.inventory.feed = 100000;

    const totalTicks = TICKS_PER_YEAR * 1.5;
    for (let i = 0; i < totalTicks; i += 1) {
      state.clock.totalTicks += 1;
      state.seasonCache = seasonOf(state.clock);
      tickWeather(state, rng);
      tickNeeds(state, rng);
      tickLifecycle(state, rng);
      tickBreeding(state, rng);
      tickBehavior(state, rng);
      tickPond(state);
      tickBugs(state, rng);
      tickLaying(state, rng);
      tickVisitors(state, rng);
      tickFestivals(state);
      tickGoals(state);
      tickAwards(state);
      tickCommissions(state, rng);
      tickTraining(state);
      tickLifeEvents(state, rng);
      tickRivals(state, rng);
      tickCup(state);

      // Caretaker bot: every game-hour, feed hungry ducks and clean the pond.
      if (i % 600 === 0) {
        for (const duck of state.ducks) {
          if (duck.stage !== 'egg' && duck.needs.hunger < 50) {
            dropFood(state, { x: duck.pos.x, y: duck.pos.y }, false);
          }
          if (duck.stage !== 'egg') {
            duck.needs.cleanliness = Math.max(duck.needs.cleanliness, 60);
            duck.needs.happiness = Math.max(duck.needs.happiness, 60);
          }
        }
        state.pond.cleanliness = 100;
        // Drill the first adult that can, and answer any life event.
        const trainee = state.ducks.find((d) => d.stage === 'adult');
        if (trainee) train(state, trainee.id, 'paddle', 0.7);
        if (state.lifeEvent) resolveLifeEvent(state, rng, state.lifeEvent.kind === 'broody' ? 'sit' : 'settle');
        // The pond has a capacity: like a sensible keeper, sell the youngest
        // duck of whichever sex is in surplus to make room, and let elders
        // retire naturally so the memorial fills.
        if (isOvercrowded(state)) {
          const living = state.ducks.filter((d) => d.stage !== 'egg');
          const males = living.filter((d) => d.sex === 'M').length;
          const surplus = males >= living.length - males ? 'M' : 'F';
          // Never sell down the breeding core: keep two non-elders of each sex.
          const keepers = living.filter((d) => d.sex === surplus && d.stage !== 'elder');
          const victim = [...keepers]
            .sort((a, b) => (a.stage === 'adult' ? 1 : 0) - (b.stage === 'adult' ? 1 : 0) || a.ageTicks - b.ageTicks)[0];
          if (victim && keepers.length > 2) sellDuck(state, victim.id);
        }
        // Keep the flock breeding: nest the first pair that can.
        const adults = state.ducks.filter((d) => d.stage === 'adult');
        pairs: for (const m of adults.filter((d) => d.sex === 'M')) {
          for (const f of adults.filter((d) => d.sex === 'F')) {
            if (canBreedPair(m, f).ok && nestPair(state, m.id, f.id).ok) break pairs;
          }
        }
      }
    }

    // Invariants after the long run.
    for (const duck of state.ducks) {
      expect(Number.isFinite(duck.pos.x)).toBe(true);
      expect(Number.isFinite(duck.pos.y)).toBe(true);
      for (const value of Object.values(duck.needs)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
    expect(Number.isFinite(state.pond.cleanliness)).toBe(true);
    expect(Number.isFinite(state.money)).toBe(true);
    expect(state.money).toBeGreaterThanOrEqual(0);
    for (const v of Object.values(state.inventory)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    for (const duck of state.ducks) {
      for (const v of Object.values(duck.training ?? {})) expect(Number.isFinite(v)).toBe(true);
      expect(Number.isFinite(duck.phenotype.boldness)).toBe(true);
    }
    expect(state.stats.drills).toBeGreaterThan(0);
    expect(state.stats.marksEarned).toBeGreaterThan(0);
    expect(state.lifeEvent).toBeNull();
    // Generations turned over: ducks hatched and elders died.
    expect(state.stats.ducksHatched).toBeGreaterThan(0);
    expect(state.memorial.length).toBeGreaterThan(0);
    // The flock survived.
    expect(state.ducks.length).toBeGreaterThan(0);
    // Bounded collections stayed bounded.
    expect(state.memorial.length).toBeLessThanOrEqual(MEMORIAL_CAP);
    expect(state.chronicle.length).toBeLessThanOrEqual(CHRONICLE_CAP);
    // Every clutch on the nest still points at a living parent (or a stud).
    for (const clutch of state.pendingClutches) {
      expect(state.ducks.some((d) => d.id === clutch.motherId)).toBe(true);
      expect(clutch.stud !== undefined || state.ducks.some((d) => d.id === clutch.fatherId)).toBe(true);
    }
    // Rival flocks kept complete genomes.
    for (const rival of state.rivals) {
      for (const genome of rival.flock) {
        for (const locus of LOCI) expect(genome[locus.id]).toHaveLength(2);
      }
    }
    // A year and a half of play still round-trips through the save format
    // (prevPos is interpolation scratch that deserialize resets by design).
    state.rngState = rng.getState();
    for (const duck of state.ducks) duck.prevPos = { ...duck.pos };
    expect(deserialize(serialize(state))).toEqual(state);
  }, 60_000);
});
