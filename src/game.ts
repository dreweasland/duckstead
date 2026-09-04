import { createRng, type Rng } from './rng';
import { type GameState } from './state';
import { createNewGame } from './newGame';
import { tickBehavior } from './sim/behavior';
import { tickBreeding } from './sim/breeding';
import { tickBugs } from './sim/bugs';
import { tickGoals } from './sim/goals';
import { tickLaying } from './sim/laying';
import { tickAwards } from './sim/awards';
import { tickCommissions } from './sim/commissions';
import { retirePond } from './sim/retire';
import { tickVisitors } from './sim/visitors';
import { tickFestivals } from './sim/festivals';
import { tickLifecycle } from './sim/lifecycle';
import { tickNeeds } from './sim/needs';
import { tickPond } from './sim/pond';
import { tickTraining } from './sim/training';
import { tickLifeEvents } from './sim/lifeEvents';
import { tickRivals } from './sim/rivals';
import { tickCup } from './sim/cup';
import { tickWeather } from './sim/weather';
import { isNight, NIGHT_END, seasonOf, TICKS_PER_DAY, TICKS_PER_HOUR } from './sim/time';
import { loadFromStorage, OWNER_KEY, saveToStorage } from './save/save';
import { isSyncConfigured } from './sync/syncMeta';
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
    if (loaded.kind === 'loaded') {
      this.state = loaded.state;
      this.rng = createRng(loaded.state.rngState);
      events.emit('toast', 'Welcome back to the pond!');
    } else {
      const fresh = createNewGame((Math.random() * 0xffffffff) >>> 0);
      this.state = fresh.state;
      this.rng = fresh.rng;
      events.emit(
        'toast',
        loaded.kind === 'corrupt'
          ? 'Your old save could not be read — a copy is kept safe in the browser. Starting a fresh pond.'
          : 'Welcome to your new pond!',
      );
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
    // The unload save is silent: with cloud sync attached, the pagehide
    // handoff does its own save-and-release, and a 'saved' push fired here
    // would only be aborted by it.
    window.addEventListener('beforeunload', () => this.save({ silent: true }));
    events.on('purchase', () => this.save());
    // A hatch fires from inside tickLifecycle's loop; saving there would
    // serialise the whole state mid-tick (several times a frame during a
    // sleep). Note it and save once the tick is over.
    events.on('egg-hatched', () => {
      this.saveDue = true;
    });
  }

  private lastSaveFailureToast = 0;
  private saveDue = false;
  private batching = false;

  save(opts: { silent?: boolean } = {}): void {
    if (this.stale) return;
    this.saveDue = false;
    if (saveToStorage(this.snapshotState())) {
      if (!opts.silent) events.emit('saved');
      return;
    }
    // The write never landed: without this, cloud sync would push the
    // previous blob and the HUD would read "synced" while the last stretch
    // of play exists nowhere. Toast at most once a minute — autosave retries
    // every 30s and a wall of identical warnings helps nobody.
    if (isSyncConfigured()) events.emit('sync-status', 'offline');
    const now = Date.now();
    if (now - this.lastSaveFailureToast > 60_000) {
      this.lastSaveFailureToast = now;
      events.emit('toast', 'Saving failed — browser storage is full or blocked. Progress is not being kept!');
    }
  }

  tick = (): void => {
    if (this.stale) return;
    const s = this.state;
    s.clock.totalTicks += 1;
    s.seasonCache = seasonOf(s.clock);
    tickWeather(s, this.rng);
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
    tickTraining(s);
    tickLifeEvents(s, this.rng);
    tickRivals(s, this.rng);
    tickCup(s);
    s.rngState = this.rng.getState();
    if (s.clock.totalTicks % TICKS_PER_DAY === NIGHT_END * TICKS_PER_HOUR) events.emit('dawn');
    if (this.saveDue && !this.batching) this.save();
  };

  // Advance up to `budget` night ticks. Returns how many ran and whether the
  // night is over — the UI spreads the ~6000-tick night across animation
  // frames (one synchronous run froze the main thread for seconds), while
  // sleepUntilDawn below stays atomic for tests and non-UI callers.
  sleepChunk(budget: number): { slept: number; done: boolean } {
    if (!isNight(this.state.clock) || this.stale) return { slept: 0, done: true };
    let slept = 0;
    // The 06:00 tick itself is the one that emits 'dawn'. Saves owed by
    // hatches along the way are batched into one at the end of the chunk.
    this.batching = true;
    while (slept < budget && isNight(this.state.clock)) {
      this.tick();
      slept += 1;
    }
    this.batching = false;
    if (this.saveDue) this.save();
    return { slept, done: !isNight(this.state.clock) };
  }

  // Skip the night atomically. Returns ticks slept.
  sleepUntilDawn(): number {
    const limit = 10 * TICKS_PER_HOUR;
    let total = 0;
    while (total < limit) {
      const { slept, done } = this.sleepChunk(limit - total);
      total += slept;
      if (done || slept === 0) break;
    }
    if (total > 0) this.save();
    return total;
  }

  snapshotState(): GameState {
    this.state.rngState = this.rng.getState();
    return this.state;
  }

  // Heritage: retire this pond and found the next with a chosen pair.
  retire(drakeId: string, henId: string): void {
    const next = retirePond(this.state, drakeId, henId, (Math.random() * 0xffffffff) >>> 0);
    if (!next) {
      events.emit('toast', 'That founder is no longer on the pond — choose the pair again.');
      return;
    }
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
