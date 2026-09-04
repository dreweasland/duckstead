import { describe, expect, it } from 'vitest';
import { createNewGame } from '../newGame';
import { pushEgg } from '../testFixtures';
import { createDuck } from './duck';
import { currentTier, LEAGUE, recordLeagueResult } from './league';
import { festivalPurseScale, festivalTier, festivalTitle, runEggShow, winterCeremonyFinale } from './festivals';
import { visitorTier } from './visitors';
import { breedStandard, standardTargets } from './standards';
import { TICKS_PER_DAY } from './time';

describe('race league', () => {
  it('promotes on three net wins and relegates on three net losses', () => {
    const { state } = createNewGame(70);
    expect(currentTier(state).name).toBe('Pond Derby');
    expect(recordLeagueResult(state, 0)).toBeNull();
    recordLeagueResult(state, 0);
    const notice = recordLeagueResult(state, 0);
    expect(notice).toContain('Promoted');
    expect(state.league.tier).toBe(1);
    expect(state.society.points).toBe(4);
    for (let i = 0; i < 3; i += 1) recordLeagueResult(state, 3);
    expect(state.league.tier).toBe(0);
    // National tier rule: only near-standard ducks.
    const nat = LEAGUE[2];
    const { rng } = createNewGame(71);
    const std = createDuck(rng, { genome: breedStandard('M|D|solid|n'), stage: 'adult', pos: { x: 0, y: 0 } });
    // A duck of the same breed but the opposite build on every judged slot.
    const off = breedStandard('M|D|solid|n');
    const t = standardTargets('M|D|solid|n');
    const fill = (ids: Array<'size1' | 'size2' | 'size3' | 'bill1' | 'bill2'>, plus: number) => {
      let left = plus;
      for (const id of ids) { off[id] = [left > 0 ? '+' : '-', left > 1 ? '+' : '-']; left -= 2; }
    };
    fill(['size1', 'size2', 'size3'], t.size >= 3 ? 0 : 6);
    fill(['bill1', 'bill2'], t.bill >= 2 ? 0 : 4);
    off.vigor1 = ['-', '-']; off.vigor2 = ['-', '-'];
    off.billColor = t.billColor === 'O' ? ['y', 'y'] : ['O', 'O'];
    off.patternColor = t.markings === 'A' ? ['a', 'a'] : ['A', 'A'];
    const plain = createDuck(rng, { genome: off, stage: 'adult', pos: { x: 0, y: 0 } });
    expect(nat.eligible!(std)).toBe(true);
    expect(nat.eligible!(plain)).toBe(false);
  });
});

describe('festival tiers', () => {
  it('winning raises next year\'s tier, title, and purse', () => {
    const { state, rng } = createNewGame(72);
    expect(festivalTier(state, 'eggShow')).toBe(0);
    expect(festivalTitle(state, 'eggShow')).toBe('Spring Egg Show');
    // Day 4 (egg show) with a perfect-standard egg: wins.
    state.clock.totalTicks = 3 * TICKS_PER_DAY + 600 * 10;
    const egg = pushEgg(state, rng, { genome: breedStandard('M|D|solid|n') });
    const result = runEggShow(state, egg.id, rng)!;
    expect(result).not.toBeNull();
    if (result.playerPlace === 0) {
      expect(festivalTier(state, 'eggShow')).toBe(1);
      expect(festivalTitle(state, 'eggShow')).toBe('County Spring Egg Show');
      expect(festivalPurseScale(state, 'eggShow')).toBeCloseTo(1.75);
    }
    expect(state.chronicle.some((c) => c.kind === 'festival')).toBe(true);
  });

  it('the winter wish is the player\'s choice', () => {
    const { state } = createNewGame(73);
    state.clock.totalTicks = (18 + 3) * TICKS_PER_DAY + 600 * 12; // winter day 4
    const r = winterCeremonyFinale(state, 'lure')!;
    expect(r.wish).toBe('lure');
    expect(state.visitorLure).toBe(true);
  });
});

describe('visitor tiers', () => {
  it('rise with Society rank', () => {
    const { state } = createNewGame(74);
    expect(visitorTier(state)).toBe(1);
    state.society.rank = 5;
    expect(visitorTier(state)).toBe(2);
    state.society.rank = 10;
    expect(visitorTier(state)).toBe(3);
  });
});
