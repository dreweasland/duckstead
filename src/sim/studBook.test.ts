import { describe, expect, it } from 'vitest';
import { createNewGame } from '../newGame';
import { createStarterDuck } from './duck';
import { sellPrice } from './economy';
import { BREEDING_COOLDOWN_TICKS } from './nest';
import { acceptStudRequest, describeStudRequest, studFee, tickStudBook } from './studBook';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from './time';
import { TUNING } from './tuning';

function pondWithChampion(seed = 1) {
  const { state, rng } = createNewGame(seed);
  const champion = createStarterDuck(rng, { x: 200, y: 300 }, 'M');
  champion.champion = 0;
  state.ducks.push(champion);
  // Start the clock at midnight so the posting hour is a clean step away.
  state.clock.totalTicks = 0;
  return { state, rng, champion };
}

const toHour = (state: { clock: { totalTicks: number } }, hour: number, rng: Parameters<typeof tickStudBook>[1]) => {
  const target = Math.floor(state.clock.totalTicks / TICKS_PER_DAY) * TICKS_PER_DAY + hour * TICKS_PER_HOUR;
  while (state.clock.totalTicks < target) {
    state.clock.totalTicks += 1;
    tickStudBook(state as never, rng);
  }
};

describe('stud book', () => {
  it('posts requests at the posting hour for champion adults only, and clears them at dusk', () => {
    const { state, rng, champion } = pondWithChampion();
    let posted = 0;
    for (let day = 0; day < 12; day += 1) {
      toHour(state, TUNING.studBook.postHour, rng);
      for (const r of state.studBook) {
        expect(r.duckId).toBe(champion.id);
        expect(r.fee).toBe(studFee(state, champion));
        expect(r.points).toBe(TUNING.studBook.points);
      }
      posted += state.studBook.length;
      toHour(state, TUNING.studBook.expireHour, rng);
      expect(state.studBook).toHaveLength(0);
      toHour(state, 23, rng);
      state.clock.totalTicks += TICKS_PER_HOUR; // into the next day
    }
    // A coin-flip a day over twelve days: some, not all.
    expect(posted).toBeGreaterThan(0);
    expect(posted).toBeLessThan(12);
  });

  it('the fee follows the duck\'s own worth', () => {
    const { state, champion } = pondWithChampion();
    expect(studFee(state, champion)).toBe(Math.round(sellPrice(state, champion) * TUNING.studBook.feeShare));
  });

  it('accepting pays, honours, and rests the champion; a resting champion cannot serve', () => {
    const { state, champion } = pondWithChampion();
    state.studBook.push({ id: 7, duckId: champion.id, client: 'Harbour Farm', fee: 90, points: 1, day: 0 });
    expect(describeStudRequest(state, state.studBook[0])).toBe(`Harbour Farm asks to put a hen to ${champion.name}`);
    const money = state.money;
    const points = state.society.points;
    expect(acceptStudRequest(state, 7)).toEqual({ ok: true });
    expect(state.money).toBe(money + 90);
    expect(state.society.points).toBe(points + 1);
    expect(champion.breedingCooldownTicks).toBe(BREEDING_COOLDOWN_TICKS);
    expect(state.stats.studFees).toBe(90);
    expect(state.stats.studServices).toBe(1);
    expect(state.studBook).toHaveLength(0);
    expect(state.chronicle.at(-1)?.text).toMatch(/stood at stud for Harbour Farm: 90 coins/);
    // Gone once taken; and a second request the same day finds him resting.
    expect(acceptStudRequest(state, 7).ok).toBe(false);
    state.studBook.push({ id: 8, duckId: champion.id, client: 'Dr. Quill', fee: 90, points: 1, day: 0 });
    const again = acceptStudRequest(state, 8);
    expect(again.ok).toBe(false);
    expect(again.reason).toMatch(/resting/);
    expect(state.money).toBe(money + 90);
  });

  it('a hen\'s request reads as a clutch, and a request for a duck that left is dropped', () => {
    const { state, rng } = pondWithChampion();
    const hen = createStarterDuck(rng, { x: 200, y: 300 }, 'F');
    hen.champion = 0;
    state.ducks.push(hen);
    state.studBook.push({ id: 1, duckId: hen.id, client: 'Lady Marrow', fee: 50, points: 1, day: 0 });
    expect(describeStudRequest(state, state.studBook[0])).toBe(`Lady Marrow asks for a clutch from ${hen.name}`);
    state.ducks = state.ducks.filter((d) => d !== hen);
    state.clock.totalTicks = TICKS_PER_HOUR * 9 - 1;
    tickStudBook(state, rng);
    expect(state.studBook).toHaveLength(1); // not an hour boundary yet
    state.clock.totalTicks += 1;
    tickStudBook(state, rng);
    expect(state.studBook).toHaveLength(0);
    expect(acceptStudRequest(state, 1).ok).toBe(false);
  });
});
