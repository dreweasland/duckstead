// Life events: the things that happen to a flock between eggs. Once in a
// while a duck's day takes a turn — a hen goes broody, two drakes fall out —
// and the player gets a choice with a real trade-off. One at a time; an
// unanswered event resolves itself by evening the way the flock would.
import type { GameState } from '../state';
import type { Rng } from '../rng';
import type { Duck } from './duck';
import { chronicle } from './chronicle';
import { events } from '../events';
import { grantMark } from './marks';
import { canPen, penDuck } from './pen';
import { clamp } from '../types';
import { dayOf, TICKS_PER_DAY, TICKS_PER_HOUR } from './time';
import { TUNING } from './tuning';
import { duckById } from '../state';

type LifeEventKind = 'broody' | 'rivalry';

export interface LifeEvent {
  id: number;
  kind: LifeEventKind;
  duckId: string;
  otherId?: string; // rivalry: the challenger
  day: number;
}

interface LifeChoice {
  id: string;
  label: string;
  blurb: string;
  ok: boolean;
  reason?: string;
}

export const LIFE_EVENT_ROLL_HOUR = TUNING.lifeEvents.rollHour;
export const LIFE_EVENT_EXPIRE_HOUR = TUNING.lifeEvents.expireHour;
const LIFE_EVENT_CHANCE = TUNING.lifeEvents.chance;
export const BROODY_WARMTH_SCALE = TUNING.lifeEvents.broodyWarmthScale; // egg warmth decays half as fast while a hen sits
const RIVALRY_TREATS = TUNING.lifeEvents.rivalryTreats;

function duckOf(state: GameState, id: string | undefined): Duck | undefined {
  return id ? duckById(state, id) : undefined;
}

function broodyCandidates(state: GameState): Duck[] {
  if (!state.ducks.some((d) => d.stage === 'egg')) return [];
  return state.ducks.filter(
    (d) => d.sex === 'F' && (d.stage === 'adult' || d.stage === 'elder') && !d.penned && !d.sick && d.needs.happiness > 50,
  );
}

function rivalryCandidates(state: GameState): Duck[] {
  return state.ducks.filter((d) => d.sex === 'M' && d.stage === 'adult' && !d.penned && !d.sick);
}

export function tickLifeEvents(state: GameState, rng: Rng): void {
  const tickOfDay = state.clock.totalTicks % TICKS_PER_DAY;
  if (tickOfDay === LIFE_EVENT_ROLL_HOUR * TICKS_PER_HOUR && !state.lifeEvent) {
    if (!rng.chance(LIFE_EVENT_CHANCE)) return;
    const rolled = rollLifeEvent(state, rng);
    if (rolled) {
      state.lifeEvent = rolled;
      events.emit('life-event', rolled);
    }
    return;
  }
  if (tickOfDay === LIFE_EVENT_EXPIRE_HOUR * TICKS_PER_HOUR && state.lifeEvent) {
    // Unanswered: the flock decides. Broody hens sit; drakes settle it.
    resolveLifeEvent(state, rng, state.lifeEvent.kind === 'broody' ? 'sit' : 'settle', true);
  }
}

export function rollLifeEvent(state: GameState, rng: Rng): LifeEvent | null {
  const day = dayOf(state.clock);
  const drakes = rivalryCandidates(state);
  const hens = broodyCandidates(state);
  const options: LifeEventKind[] = [];
  if (hens.length > 0) options.push('broody');
  if (drakes.length >= 2) options.push('rivalry');
  if (options.length === 0) return null;
  const kind = rng.pick(options);
  const id = state.nextLifeEventId;
  state.nextLifeEventId += 1;
  if (kind === 'broody') return { id, kind, duckId: rng.pick(hens).id, day };
  const a = drakes[rng.int(drakes.length)];
  const rest = drakes.filter((d) => d !== a);
  const b = rest[rng.int(rest.length)];
  return { id, kind, duckId: a.id, otherId: b.id, day };
}

export function describeLifeEvent(state: GameState, ev: LifeEvent): { title: string; text: string } {
  const duck = duckOf(state, ev.duckId);
  const other = duckOf(state, ev.otherId);
  const name = duck?.name ?? 'A hen';
  if (ev.kind === 'broody') {
    return {
      title: `${name} has gone broody`,
      text: `${name} is fluffed up over the nest and won't be moved. Let her sit and the eggs stay warm all day — but she won't lay. Shoo her off and she lays as usual, and sulks.`,
    };
  }
  return {
    title: `${name} and ${other?.name ?? 'another drake'} have fallen out`,
    text: `The two drakes are squaring up on the bank. Let them settle it and one comes out proud, the other bruised. Treats might distract them — or the pen could cool things off.`,
  };
}

export function lifeEventChoices(state: GameState, ev: LifeEvent): LifeChoice[] {
  if (ev.kind === 'broody') {
    return [
      { id: 'sit', label: 'Let her sit', blurb: 'Eggs lose warmth half as fast today; no egg from her today; she\'s content.', ok: true },
      { id: 'shoo', label: 'Shoo her off', blurb: 'She lays as normal, −6 happiness.', ok: true },
    ];
  }
  const other = duckOf(state, ev.otherId);
  const penGate = other ? canPen(state, other) : { ok: false, reason: 'No pen' };
  const treats = state.inventory.premiumFeed >= RIVALRY_TREATS;
  return [
    { id: 'settle', label: 'Let them settle it', blurb: 'One wins and turns proud (+2% race speed); the loser takes a bruising.', ok: true },
    {
      id: 'treats',
      label: `Distract with treats (${RIVALRY_TREATS} premium feed)`,
      blurb: 'Both cheer up; nobody gets hurt.',
      ok: treats,
      reason: treats ? undefined : 'Not enough premium feed',
    },
    {
      id: 'pen',
      label: `Send ${other?.name ?? 'the challenger'} to the pen`,
      blurb: 'Cools things off; he sits out of breeding until released.',
      ok: penGate.ok,
      reason: penGate.reason,
    },
  ];
}

// Apply a choice. `auto` marks the evening default so it doesn't count as a
// settled event for the goals. Returns the outcome line, or null if there
// was no event or the choice isn't available.
export function resolveLifeEvent(state: GameState, rng: Rng, choiceId: string, auto = false): string | null {
  const ev = state.lifeEvent;
  if (!ev) return null;
  const choice = lifeEventChoices(state, ev).find((c) => c.id === choiceId);
  if (!choice || !choice.ok) return null;
  const duck = duckOf(state, ev.duckId);
  const other = duckOf(state, ev.otherId);
  const day = dayOf(state.clock);
  let text = '';
  if (ev.kind === 'broody') {
    if (!duck) text = 'The hen has already left the pond.';
    else if (choiceId === 'sit') {
      duck.broodyDay = day;
      duck.lastLayDay = day;
      duck.needs.happiness = clamp(duck.needs.happiness + 8, 0, 100);
      duck.activity = 'sit';
      duck.activityTimer = 60;
      text = `${duck.name} settles over the nest for the day.`;
      chronicle(state, 'life', `${duck.name} went broody and sat the nest.`);
    } else {
      duck.needs.happiness = clamp(duck.needs.happiness - 6, 0, 100);
      text = `${duck.name} stalks off, muttering.`;
    }
  } else if (!duck || !other) {
    text = 'The quarrel fizzled — one of them has left the pond.';
  } else if (choiceId === 'settle') {
    const winner = rng.chance(0.5 + (duck.phenotype.boldness - other.phenotype.boldness) * 0.3) ? duck : other;
    const loser = winner === duck ? other : duck;
    winner.needs.happiness = clamp(winner.needs.happiness + 8, 0, 100);
    loser.needs.happiness = clamp(loser.needs.happiness - 10, 0, 100);
    loser.needs.health = clamp(loser.needs.health - 6, 0, 100);
    grantMark(state, winner, 'proud', `saw off ${loser.name}`);
    text = `${winner.name} stands tall; ${loser.name} slinks off with ruffled feathers.`;
    chronicle(state, 'life', `${winner.name} and ${loser.name} fell out; ${winner.name} came out on top.`);
  } else if (choiceId === 'treats') {
    state.inventory.premiumFeed -= RIVALRY_TREATS;
    for (const d of [duck, other]) d.needs.happiness = clamp(d.needs.happiness + 6, 0, 100);
    text = `Two treats later, ${duck.name} and ${other.name} have forgotten what the fuss was about.`;
  } else {
    penDuck(state, other.id);
    text = `${other.name} is led off to the pen; ${duck.name} has the bank to himself.`;
    chronicle(state, 'life', `${other.name} was penned after falling out with ${duck.name}.`);
  }
  state.lifeEvent = null;
  if (!auto) state.stats.lifeEventsSettled += 1;
  events.emit('toast', text);
  events.emit('purchase');
  return text;
}

// Is any hen sitting the nest today? (Egg warmth reads this.)
export function broodyHenToday(state: GameState): boolean {
  const day = dayOf(state.clock);
  return state.ducks.some((d) => d.broodyDay === day && !d.penned && d.stage !== 'egg');
}
