type Handler = (payload?: unknown) => void;

type GameEvent =
  | 'toast'
  | 'chapter-done' // a goal chapter's last goal landed; payload is the ChapterDef
  | 'dawn' // 06:00 — the day's briefing
  | 'favourite-found' // a duck ate its favourite treat for the first time
  | 'egg-hatched'
  | 'duck-grew' // a duck moved up a life stage; payload { duck, to: 'juvenile' | 'adult' | 'elder' }
  | 'duck-died' // payload { duck, descendants, honoured, ageDays } for the farewell banner
  | 'life-event' // a life event needs a decision; payload LifeEvent
  | 'purchase'
  | 'saved' // a local save just landed in localStorage (cloud sync pushes on it)
  | 'sync-status' // cloud sync state changed: 'synced' | 'syncing' | 'offline' | 'stale'
  | 'takeover' // another tab or device opened the game and owns the save now
  | 'resumed'; // the other device handed the pond back; state reloaded, play may continue

class EventBus {
  private handlers = new Map<GameEvent, Set<Handler>>();

  on(event: GameEvent, handler: Handler): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  emit(event: GameEvent, payload?: unknown): void {
    this.handlers.get(event)?.forEach((h) => h(payload));
  }
}

export const events = new EventBus();
