// The pond chronicle: a short prose log of the things worth remembering —
// new breeds, champions, deaths, milestones. Written at the event sites, read
// in the Book panel. Capped so saves stay small.
import type { GameState } from '../state';
import { dayOf, seasonOf, yearOf } from './time';

export type ChronicleKind =
  | 'breed' | 'hatch' | 'death' | 'festival' | 'race' | 'award' | 'visitor' | 'sale' | 'birthday' | 'society' | 'milestone'
  | 'ofAge' /* juvenile grew into an adult */ | 'elder' /* adult grew into an elder */;

export interface ChronicleEntry {
  day: number;
  kind: ChronicleKind;
  text: string;
}

export const CHRONICLE_CAP = 200;

export function chronicle(state: GameState, kind: ChronicleKind, text: string): void {
  state.chronicle.push({ day: dayOf(state.clock), kind, text });
  if (state.chronicle.length > CHRONICLE_CAP) state.chronicle.splice(0, state.chronicle.length - CHRONICLE_CAP);
}

// "Year 1, Spring 3" for a chronicle day.
export function chronicleDate(day: number): string {
  const clock = { totalTicks: day * 14400 };
  const season = seasonOf(clock);
  return `Year ${yearOf(clock)}, ${season.charAt(0).toUpperCase() + season.slice(1)} ${(day % 6) + 1}`;
}
