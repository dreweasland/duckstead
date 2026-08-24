import { createRng, type Rng } from './rng';
import { createNewGame, type GameState } from './state';
import { tickBehavior } from './sim/behavior';
import { tickBreeding } from './sim/breeding';
import { tickBugs } from './sim/bugs';
import { tickGoals } from './sim/goals';
import { tickLaying } from './sim/laying';
import { tickAwards } from './sim/awards';
import { tickCommissions } from './sim/commissions';
import { retirePond } from './sim/heritage';
import { tickVisitors } from './sim/visitors';
import { tickFestivals } from './sim/festivals';
import { tickLifecycle } from './sim/lifecycle';
import { tickNeeds } from './sim/needs';
import { tickPond } from './sim/pond';
import { isNight, NIGHT_END, seasonOf, TICKS_PER_DAY, TICKS_PER_HOUR } from './sim/time';
import { loadFromStorage, OWNER_KEY, saveToStorage } from './save/save';
import { events } from './events';

const AUTOSAVE_MS = 30_000;

export class Game {
  state: GameState;
  rng: Rng;
  speed = 1; // 0 | 1 | 4 | 16
  selectedDuckId: string | null = null;
  // True once another tab has opened the game: this tab must stop writing the
  // save (and stops simulating), or the two tabs would clobber each other.
  stale = false;
  private readonly sessionId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;

  constructor() {
    const loaded = loadFromStorage();
    if (loaded) {
      this.state = loaded;
      this.rng = createRng(loaded.rngState);
      events.emit('toast', 'Welcome back to the pond!');
    } else {
      const fresh = createNewGame((Math.random() * 0xffffffff) >>> 0);
      this.state = fresh.state;
      this.rng = fresh.rng;
      events.emit('toast', 'Welcome to your new pond!');
    }

    // Claim save ownership; the storage event fires only in *other* tabs, so
    // any previously open tab sees the claim and goes dormant.
    localStorage.setItem(OWNER_KEY, this.sessionId);
    window.addEventListener('storage', (e) => {
      if (e.key === OWNER_KEY && e.newValue !== this.sessionId && !this.stale) {
        this.stale = true;
        this.speed = 0;
        events.emit('takeover');
      }
    });

    setInterval(() => this.save(), AUTOSAVE_MS);
    window.addEventListener('beforeunload', () => this.save());
    events.on('purchase', () => this.save());
    events.on('egg-hatched', () => this.save());
  }

  save(): void {
    if (this.stale) return;
    saveToStorage(this.snapshotState());
    events.emit('saved');
  }

  tick = (): void => {
    if (this.stale) return;
    const s = this.state;
    s.clock.totalTicks += 1;
    s.seasonCache = seasonOf(s.clock);
    tickNeeds(s, this.rng);
    tickLifecycle(s, this.rng);
    tickBreeding(s, this.rng);
    tickBehavior(s, this.rng);
    tickPond(s);
    tickBugs(s, this.rng);
    tickLaying(s, this.rng);
    tickVisitors(s, this.rng);
    tickFestivals(s);
    tickGoals(s);
    tickAwards(s);
    tickCommissions(s, this.rng);
    s.rngState = this.rng.getState();
    if (s.clock.totalTicks % TICKS_PER_DAY === NIGHT_END * TICKS_PER_HOUR) events.emit('dawn');
  };

  // Skip the night: the flock is asleep and nothing but the race is possible,
  // so let the player jump to 06:00 and the dawn briefing. Returns ticks slept.
  sleepUntilDawn(): number {
    if (!isNight(this.state.clock) || this.stale) return 0;
    let slept = 0;
    const limit = 10 * TICKS_PER_HOUR;
    // The 06:00 tick itself is the one that emits 'dawn'.
    while (slept < limit && isNight(this.state.clock)) {
      this.tick();
      slept += 1;
    }
    this.save();
    return slept;
  }

  snapshotState(): GameState {
    this.state.rngState = this.rng.getState();
    return this.state;
  }

  // Heritage: retire this pond and found the next with a chosen pair.
  retire(drakeId: string, henId: string): void {
    const next = retirePond(this.state, drakeId, henId, (Math.random() * 0xffffffff) >>> 0);
    this.state = next.state;
    this.rng = next.rng;
    this.selectedDuckId = null;
    this.save();
  }

  newGame(): void {
    const fresh = createNewGame((Math.random() * 0xffffffff) >>> 0);
    this.state = fresh.state;
    this.rng = fresh.rng;
    this.selectedDuckId = null;
    this.save();
  }

  loadState(state: GameState): void {
    this.state = state;
    this.rng = createRng(state.rngState);
    this.selectedDuckId = null;
  }
}
