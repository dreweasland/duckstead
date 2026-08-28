// The dawn report: a "today at the pond" briefing shown at 06:00 so the day's
// opportunities (buyers, visitors, eggs, festivals) are legible in one place
// instead of scattered across toasts.
import type { GameState } from '../state';
import { flock } from '../state';
import type { Duck } from './duck';
import { breedReadiness, eggWarmth } from './needs';
import { duckCapacity, henEggPrice, overcrowding, pondHasRoom, pondOccupancy } from './economy';
import { describeRequest, matchesRequest, requestPrice, TREATS_TO_RECRUIT } from './visitors';
import { festivalToday, FESTIVAL_NAMES, upcomingFestival } from './festivals';
import { dayOf, dayOfSeason, seasonOf, yearOf } from './time';
import { bestPairFor, describeCommission, duckFits } from './commissions';
import { describeBalance, flockBalance, HENS_PER_DRAKE } from './flockBalance';
import { penCapacity, penDucks } from './pen';
import type { Season } from '../types';

export type DawnIcon =
  | 'coin' | 'duck' | 'egg' | 'flag' | 'heart' | 'wheat' | 'bubbles' | 'sparkle' | 'warning' | 'pill' | 'grave'
  | 'feather' | 'smile';

export interface DawnLine {
  icon: DawnIcon;
  text: string;
  detail?: string; // quieter second line
  urgent?: boolean;
  duck?: Duck; // drawn as a portrait in place of the icon badge
}

export interface DawnSection {
  title: string;
  lines: DawnLine[];
}

export interface DawnReport {
  season: Season;
  dayLabel: string; // "Day 2 of Spring · Year 1"
  greeting: string;
  festivalChip: string | null; // "Egg Show today!" / "Egg Show in 2 days"
  stats: { coins: number; occupancy: number; capacity: number; eggs: number; pond: number };
  sections: DawnSection[];
}

const GREETINGS: Record<Season, string> = {
  spring: 'A bright spring morning at the pond.',
  summer: 'A warm summer morning at the pond.',
  autumn: 'A crisp autumn morning at the pond.',
  winter: 'A frosty winter morning at the pond.',
};

function plural(n: number, word: string, suffix = 's'): string {
  return `${n} ${word}${n === 1 ? '' : suffix}`;
}

export function dawnReport(state: GameState): DawnReport {
  const season = seasonOf(state.clock);
  const seasonName = season.charAt(0).toUpperCase() + season.slice(1);
  const active = flock(state);
  const eggs = state.ducks.filter((d) => d.stage === 'egg');

  // Festival chip.
  const today = festivalToday(state.clock);
  let festivalChip: string | null = null;
  if (today) festivalChip = `${FESTIVAL_NAMES[today]} today!`;
  else {
    const next = upcomingFestival(state.clock);
    if (next.inDays <= 2) festivalChip = `${FESTIVAL_NAMES[next.kind]} ${next.inDays === 1 ? 'tomorrow' : `in ${next.inDays} days`}`;
  }

  const opportunities: DawnLine[] = [];
  const milestones: DawnLine[] = [];
  const nest: DawnLine[] = [];
  const chores: DawnLine[] = [];

  // Yesterday's passages — growth, elderhood, farewells, and year birthdays
  // the player may have missed live. Pulled from the chronicle, so the dawn
  // card doubles as the catch-up surface for the flock's life events.
  {
    const dayNow = dayOf(state.clock);
    const LIFE_ICON: Partial<Record<string, DawnIcon>> = { death: 'grave', elder: 'feather', ofAge: 'duck', birthday: 'smile' };
    // Scope to this pond's era: a retired pond's chronicle carries over, and
    // its old day numbers would otherwise replay in the new pond's recap.
    const news = state.chronicle.filter((c) => (c.era ?? 0) === state.heritage && c.day >= dayNow - 1 && LIFE_ICON[c.kind] !== undefined);
    const shown = news.slice(-6);
    for (const n of shown) milestones.push({ icon: LIFE_ICON[n.kind]!, text: n.text });
    if (news.length > shown.length) milestones.push({ icon: 'sparkle', text: `…and ${news.length - shown.length} more in the Book.` });
  }

  if (today) {
    opportunities.push({ icon: 'flag', text: `It's the ${FESTIVAL_NAMES[today]}!`, detail: 'Open the festival chip in the top bar to take part.' });
  }
  if (state.request) {
    const want = describeRequest(state.request);
    const match = active
      .filter((d) => matchesRequest(d, state.request!))
      .sort((a, b) => requestPrice(state, b) - requestPrice(state, a))[0];
    opportunities.push({
      icon: 'coin',
      duck: match,
      text: `A buyer wants ${want.endsWith('duck') ? want : `a ${want} duck`} — ${state.request.multiplier.toFixed(1)}× price.`,
      detail: match
        ? `${match.name} fits the bill — ${requestPrice(state, match)} coins if you sell.`
        : 'Nobody on the pond matches yet; breed toward it or let it pass.',
    });
  }
  for (const c of state.commissions) {
    const fits = active.filter((d) => duckFits(d, c));
    const left = c.expiresDay - dayOf(state.clock);
    opportunities.push({
      icon: 'flag',
      duck: fits[0],
      text: `${c.client} wants ${describeCommission(c)} — ${c.reward} coins.`,
      detail: fits.length > 0
        ? `${fits[0].name} fits — deliver from the card. ${left} day${left === 1 ? '' : 's'} left.`
        : (() => {
            const pair = bestPairFor(state, c.key);
            return pair
              ? `Nobody fits yet — ${pair.dam.name} × ${pair.sire.name} could hatch one (${Math.round(pair.chance * 100)}% per egg). ${left} day${left === 1 ? '' : 's'} left.`
              : `Nobody fits yet; ${left} day${left === 1 ? '' : 's'} left.`;
          })(),
      urgent: fits.length > 0 && left <= 1,
    });
  }
  if (state.visitor) {
    const v = state.visitor;
    opportunities.push({
      icon: 'sparkle',
      duck: v.duck,
      text: `${v.duck.name}, a wild duck, is on the bank.`,
      detail: `${v.treatsGiven}/${TREATS_TO_RECRUIT} treats so far — premium feed wins it over before it flies on.`,
    });
  }

  const ready = eggs.filter((e) => e.readyToHatch).length;
  const cold = eggs.filter((e) => !e.readyToHatch && eggWarmth(e) < 40).length;
  if (ready > 0) nest.push({ icon: 'egg', text: `${plural(ready, 'egg')} cracking — tap to hatch.` });
  if (cold > 0) nest.push({ icon: 'egg', text: `${plural(cold, 'egg')} went cold overnight.`, detail: 'Tap each to tuck it into the straw.', urgent: true });
  if (state.pendingClutches.length > 0) {
    nest.push({ icon: 'heart', text: `${plural(state.pendingClutches.length, 'pair')} courting.`, detail: 'Keep them fed and happy — the egg is rolled when it is laid.' });
  }
  const breedable = active.filter((d) => breedReadiness(d).ok);
  const pairs = Math.min(breedable.filter((d) => d.sex === 'M').length, breedable.filter((d) => d.sex === 'F').length);
  if (pairs > 0) nest.push({ icon: 'heart', text: `${plural(pairs, 'pair')} ready to nest.` });
  const crowd = overcrowding(state);
  // Elders no longer count against capacity, so the report never suggests
  // retiring them for space — they've earned their spot on the bank.
  if (crowd > 0) {
    chores.unshift({
      icon: 'warning',
      text: `The pond is overcrowded by ${plural(crowd, 'duck')} — the flock is stressed and the water fouls faster.`,
      detail: 'Sell or buy a Pond Expansion. Wild ducks won\'t visit until it\'s sorted.',
      urgent: true,
    });
  } else if (!pondHasRoom(state) && eggs.length + state.pendingClutches.length > 0) {
    nest.push({
      icon: 'warning',
      text: 'The pond is at capacity — hatching eggs will overcrowd it.',
      detail: 'Sell before they hatch, or expand the pond.',
    });
  }

  const bal = flockBalance(state);
  if (bal.excess > 0) {
    const room = penCapacity(state) - penDucks(state).length;
    const penHint = penCapacity(state) === 0
      ? 'or buy the Bachelor Pen to sit a drake out without selling'
      : room > 0
        ? `or send a drake to the pen (${penDucks(state).length}/${penCapacity(state)})`
        : 'the pen is full — a second level adds three places';
    chores.push({
      icon: 'warning',
      text: `${describeBalance(bal)}.`,
      detail: `Sell or commission a drake, ${penHint} — one drake per ${HENS_PER_DRAKE} hens keeps the flock laying well.`,
      urgent: bal.status === 'rowdy',
    });
  }
  const hungry = active.filter((d) => d.needs.hunger < 40).length;
  if (hungry > 0) chores.push({ icon: 'wheat', text: `${plural(hungry, 'duck')} hungry after the night.`, urgent: true });
  const sick = active.filter((d) => d.sick).length;
  if (sick > 0) chores.push({ icon: 'pill', text: `${plural(sick, 'duck')} sick.`, detail: 'Medicine is in the shop.', urgent: true });
  if (state.inventory.feed < 5 && state.feeder.food === 0) {
    chores.push({ icon: 'wheat', text: `Feed is low (${state.inventory.feed} left).`, detail: 'Gather duckweed from the rim or visit the shop.' });
  }
  if (state.pond.cleanliness < 70) {
    chores.push({ icon: 'bubbles', text: `Pond is ${Math.round(state.pond.cleanliness)}% clean.`, detail: "Wild ducks won't visit until it's scrubbed above 70%." });
  }
  const pickups = state.bugs.filter((b) => b.kind === 'feather' || b.kind === 'duckweed').length;
  if (pickups > 0) chores.push({ icon: 'sparkle', text: `${plural(pickups, 'pickup')} on the grass.`, detail: 'Feathers for the album, duckweed for feed.' });
  const loose = state.bugs.filter((b) => b.kind === 'henEgg').length;
  if (loose > 0 || state.inventory.eggs >= 5) {
    chores.push({
      icon: 'egg',
      text: loose > 0 ? `${plural(loose, 'hen egg')} lying on the grass.` : `${state.inventory.eggs} eggs in the basket.`,
      detail: `Gather them up — the shop pays ${henEggPrice(state)} coins each today.`,
    });
  }

  const sections: DawnSection[] = [];
  if (opportunities.length) sections.push({ title: 'Opportunities', lines: opportunities });
  if (milestones.length) sections.push({ title: 'Milestones', lines: milestones });
  if (nest.length) sections.push({ title: 'The nest', lines: nest });
  if (chores.length) sections.push({ title: 'Chores', lines: chores });
  if (sections.length === 0) sections.push({ title: 'All quiet', lines: [{ icon: 'duck', text: 'The flock is content. Enjoy the morning.' }] });

  return {
    season,
    dayLabel: `Day ${dayOfSeason(state.clock)} of ${seasonName} · Year ${yearOf(state.clock)}`,
    greeting: GREETINGS[season],
    festivalChip,
    stats: {
      coins: state.money,
      occupancy: pondOccupancy(state),
      capacity: duckCapacity(state),
      eggs: eggs.length,
      pond: Math.round(state.pond.cleanliness),
    },
    sections,
  };
}

// Flat text view, for tests and logs.
export function dawnLines(report: DawnReport): string[] {
  return report.sections.flatMap((s) => s.lines.map((l) => l.text + (l.detail ? ` ${l.detail}` : '')));
}
