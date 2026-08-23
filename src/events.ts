type Handler = (payload?: unknown) => void;

export type GameEvent =
  | 'toast'
  | 'dawn' // 06:00 — the day's briefing
  | 'favourite-found' // a duck ate its favourite treat for the first time
  | 'unlock' // a panel became available
  | 'egg-laid'
  | 'egg-hatched'
  | 'duck-died'
  | 'purchase'
  | 'duck-selected'
  | 'takeover'; // another tab opened the game and owns the save now

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
