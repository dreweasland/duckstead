// Compact per-card action row: feed / clean / pet (+ medicine when sick).
// Used by both the on-screen card rail and the Flock panel cards.
import type { Game } from '../game';
import type { Duck } from '../sim/duck';
import { cleanDuck, feedDuckDirectly, medicateDuck, petDuck } from '../sim/needs';
import { el } from './dom';
import { icon, type IconName } from './icons';
import { drillsLeft, isTrainingDay } from '../sim/training';
import { plural } from '../text';

export interface QuickHandlers {
  refresh(): void;
  toast(msg: string): void;
}

export function quickActions(game: Game, duck: Duck, h: QuickHandlers): HTMLElement {
  const inv = game.state.inventory;
  const btn = (
    name: IconName,
    title: string,
    enabled: boolean,
    act: () => boolean,
    fail = '',
  ) =>
    el(
      'button',
      {
        class: 'quick-btn',
        disabled: !enabled,
        title,
        onclick: (e) => {
          e.stopPropagation(); // don't also select the card
          const ok = act();
          h.refresh();
          if (!ok && fail) h.toast(fail);
        },
      },
      icon(name, 12),
    );

  const row = el(
    'div',
    { class: 'quick-actions' },
    btn('wheat', 'Feed', inv.feed > 0, () => feedDuckDirectly(game.state, duck.id, 'feed') !== null,
      'No feed — visit the shop'),
    btn('bubbles', 'Clean', true, () => cleanDuck(game.state, duck.id)),
    btn('hand', duck.petCooldownTicks > 0 ? 'Petted recently' : 'Pet', duck.petCooldownTicks <= 0,
      () => petDuck(game.state, duck.id)),
  );
  if (duck.sick) {
    row.append(
      btn('pill', 'Medicine', inv.medicine > 0, () => medicateDuck(game.state, duck.id),
        'No medicine in stock'),
    );
  }
  return row;
}

// A duck's training for the day, as a chip: drills still to run, or done.
// Ducklings can't train and get nothing.
export function trainingChip(game: Game, duck: Duck, size = 10, compact = false): HTMLElement | null {
  if (duck.stage === 'egg' || duck.stage === 'duckling' || !isTrainingDay(game.state)) return null;
  const left = drillsLeft(game.state, duck);
  if (left > 0) {
    const label = compact ? (left > 1 ? String(left) : '') : left > 1 ? `${left} drills` : 'drill';
    return el('span', { class: 'chip chip-drill', title: `${plural(left, 'drill')} left today — open the card to train` }, icon('flag', size), label);
  }
  return el('span', { class: 'chip chip-trained', title: 'Trained today' }, icon('check', size), compact ? '' : 'trained');
}
