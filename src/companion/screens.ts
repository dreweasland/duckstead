// The companion's three tabs plus the duck care sheet. Every button calls an
// existing pure sim function — this file is UI only.
import type { Game } from '../game';
import { el } from '../ui/dom';
import { icon } from '../ui/icons';
import { duckPortrait } from '../ui/portrait';
import type { Duck } from '../sim/duck';
import { breedKey, breedLabel } from '../sim/breedBook';
import {
  cleanDuck,
  eggWarmth,
  feedDuckDirectly,
  feederCapacity,
  fillFeeder,
  medicateDuck,
  petDuck,
  tuckEgg,
} from '../sim/needs';
import { favouriteTreat, FOODS, stockOf } from '../sim/food';
import { catchBugAt, DUCKWEED_FEED } from '../sim/bugs';
import { henEggPrice, sellEggBasket, SHOP_ITEMS, consumableCost } from '../sim/economy';
import { claimHatch, eggIncubationTicks } from '../sim/lifecycle';
import { cleanPond, isPondDirty } from '../sim/pond';
import { dawnReport } from '../sim/daybook';
import { goalProgress, pendingGoals } from '../sim/goals';
import { describeCommission } from '../sim/commissions';
import { events } from '../events';

const bar = (value: number, cls = ''): HTMLElement =>
  el(
    'div',
    { class: `comp-bar ${cls}` },
    el('div', { class: 'comp-bar-fill', style: `width:${Math.max(0, Math.min(100, value))}%` }),
  );

const needRow = (label: string, value: number): HTMLElement =>
  el('div', { class: 'comp-need' }, el('span', { class: 'comp-need-label' }, label), bar(value, value < 35 ? 'low' : ''));

// What (if anything) this duck needs right now, as hand-drawn icon badges.
function careBadges(duck: Duck): HTMLElement[] {
  const badges: HTMLElement[] = [];
  const badge = (cls: string, iconName: Parameters<typeof icon>[0], title: string): void => {
    badges.push(el('span', { class: `comp-badge ${cls}`, title }, icon(iconName, 13)));
  };
  if (duck.stage === 'egg') {
    if (eggWarmth(duck) < 40) badge('b-cold', 'snow', 'Getting cold — tuck it in');
    return badges;
  }
  if (duck.sick) badge('b-sick', 'pill', 'Sick — needs medicine');
  if (duck.needs.hunger < 35) badge('b-hunger', 'wheat', 'Hungry');
  if (duck.needs.cleanliness < 35) badge('b-dirty', 'bubbles', 'Grubby — needs a clean');
  if (duck.needs.happiness < 35) badge('b-sad', 'heartOutline', 'Unhappy — pet it or offer a treat');
  return badges;
}

// ---- Flock ----------------------------------------------------------------

export function flockScreen(game: Game, openDuck: (id: string) => void): HTMLElement {
  const grid = el('div', { class: 'comp-grid' });
  const ducks = [...game.state.ducks].sort((a, b) => (a.stage === 'egg' ? 1 : 0) - (b.stage === 'egg' ? 1 : 0));
  for (const duck of ducks) {
    const badges = careBadges(duck);
    const card = el(
      'button',
      { class: `comp-card${badges.length ? ' needs-care' : ''}`, onclick: () => openDuck(duck.id) },
      duckPortrait(duck, 64),
      el('div', { class: 'comp-card-name' }, duck.stage === 'egg' ? 'Egg' : duck.name),
      el(
        'div',
        { class: 'comp-muted small' },
        duck.stage === 'egg'
          ? `${Math.min(100, Math.round((duck.incubationTicks / eggIncubationTicks(game.state)) * 100))}% · warmth ${Math.round(eggWarmth(duck))}%`
          : `${duck.sex === 'M' ? '♂' : '♀'} ${duck.stage}`,
      ),
      el('div', { class: 'comp-card-badges' }, ...badges),
    );
    grid.append(card);
  }
  return grid;
}

// ---- Duck care sheet ------------------------------------------------------

export function duckScreen(game: Game, duckId: string, back: () => void): HTMLElement {
  const state = game.state;
  const duck = state.ducks.find((d) => d.id === duckId);
  if (!duck) {
    back();
    return el('div');
  }
  const box = el('div', { class: 'comp-duck' });
  box.append(
    el(
      'div',
      { class: 'comp-duck-head' },
      el('button', { class: 'comp-btn ghost', onclick: back }, '‹ Flock'),
      el('strong', {}, duck.stage === 'egg' ? 'Egg' : duck.name),
      el('span', { class: 'comp-muted small' }, duck.stage === 'egg' ? '' : breedLabel(breedKey(duck.genome))),
    ),
    el('div', { class: 'comp-duck-portrait' }, duckPortrait(duck, 120)),
  );

  const act = (label: string, ok: boolean, fn: () => boolean | unknown, note = ''): HTMLElement =>
    el(
      'button',
      {
        class: 'comp-btn',
        disabled: !ok,
        onclick: () => {
          fn();
        },
      },
      label + (note ? ` ${note}` : ''),
    );

  if (duck.stage === 'egg') {
    const pct = Math.min(100, Math.round((duck.incubationTicks / eggIncubationTicks(state)) * 100));
    const warmth = Math.round(eggWarmth(duck));
    box.append(
      needRow(`Incubation ${pct}%`, pct),
      needRow(`Warmth ${warmth}%`, warmth),
      el(
        'div',
        { class: 'comp-actions' },
        act('Tuck into the straw', warmth < 95, () => tuckEgg(state, duck.id)),
        pct >= 100
          ? act('Hatch!', true, () => claimHatch(state, game.rng, duck.id))
          : el('span', { class: 'comp-muted small' }, 'Keep it warm — cold eggs incubate slowly.'),
      ),
    );
    return box;
  }

  box.append(
    needRow('Hunger', duck.needs.hunger),
    needRow('Clean', duck.needs.cleanliness),
    needRow('Happy', duck.needs.happiness),
    needRow('Health', duck.needs.health),
  );

  const inv = state.inventory;
  const iconAct = (
    iconName: Parameters<typeof icon>[0],
    label: string,
    ok: boolean,
    fn: () => unknown,
    note = '',
  ): HTMLElement =>
    el(
      'button',
      { class: 'comp-btn', disabled: !ok, onclick: () => { fn(); } },
      icon(iconName, 14),
      `${label}${note ? ` ${note}` : ''}`,
    );
  const treatBtn = (kind: 'peas' | 'worms' | 'berries'): HTMLElement => {
    const fav = favouriteTreat(duck) === kind && duck.favouriteKnown;
    const dot = el('span', { class: 'treat-dot' });
    dot.style.background = FOODS[kind].color;
    return el(
      'button',
      { class: 'comp-btn', disabled: stockOf(state, kind) === 0, onclick: () => { feedDuckDirectly(state, duck.id, kind); } },
      dot,
      `${FOODS[kind].name}${fav ? ' ★' : ''} (${stockOf(state, kind)})`,
    );
  };
  box.append(
    el(
      'div',
      { class: 'comp-actions' },
      iconAct('wheat', 'Feed', inv.feed > 0, () => feedDuckDirectly(state, duck.id, false), `(${inv.feed})`),
      iconAct('sparkle', 'Premium', inv.premiumFeed > 0, () => feedDuckDirectly(state, duck.id, true), `(${inv.premiumFeed})`),
      iconAct('hand', 'Pet', true, () => petDuck(state, duck.id)),
      iconAct('bubbles', 'Clean', duck.needs.cleanliness < 100, () => cleanDuck(state, duck.id)),
      treatBtn('peas'),
      treatBtn('worms'),
      treatBtn('berries'),
      duck.sick ? iconAct('pill', 'Medicine', inv.medicine > 0, () => medicateDuck(state, duck.id), `(${inv.medicine})`) : el('span'),
    ),
  );
  return box;
}

// ---- Pond (homestead chores) ----------------------------------------------

const PICKUPS: Record<string, { icon: Parameters<typeof icon>[0]; label: string }> = {
  beetle: { icon: 'bug', label: 'Beetle' },
  snail: { icon: 'snail', label: 'Snail' },
  firefly: { icon: 'sparkle', label: 'Firefly' },
  feather: { icon: 'feather', label: 'Feather' },
  duckweed: { icon: 'leaf', label: 'Duckweed' },
  henEgg: { icon: 'egg', label: 'Hen egg' },
};

export function pondScreen(game: Game): HTMLElement {
  const state = game.state;
  const box = el('div', { class: 'comp-pond' });

  // Trough
  const cap = feederCapacity(state);
  const level = state.feeder.food;
  box.append(
    el(
      'section',
      { class: 'comp-section' },
      el('h2', {}, 'Feed trough'),
      needRow(`${level}/${cap} pellets`, (level / cap) * 100),
      el(
        'div',
        { class: 'comp-actions' },
        el(
          'button',
          {
            class: 'comp-btn',
            disabled: state.inventory.feed === 0 || level >= cap,
            onclick: () => fillFeeder(state),
          },
          `Fill trough (feed: ${state.inventory.feed})`,
        ),
      ),
    ),
  );

  // Pond cleanliness
  box.append(
    el(
      'section',
      { class: 'comp-section' },
      el('h2', {}, 'Pond'),
      el('div', { class: 'comp-muted small' }, isPondDirty(state) ? 'The water is looking murky.' : 'The water is clear.'),
      el(
        'div',
        { class: 'comp-actions' },
        el('button', { class: 'comp-btn', disabled: !isPondDirty(state), onclick: () => cleanPond(state) }, 'Skim the pond'),
      ),
    ),
  );

  // Egg basket
  box.append(
    el(
      'section',
      { class: 'comp-section' },
      el('h2', {}, 'Egg basket'),
      el('div', { class: 'comp-muted small' }, `${state.inventory.eggs} egg${state.inventory.eggs === 1 ? '' : 's'} · worth ${henEggPrice(state)} each`),
      el(
        'div',
        { class: 'comp-actions' },
        el(
          'button',
          { class: 'comp-btn', disabled: state.inventory.eggs === 0, onclick: () => { sellEggBasket(state); events.emit('purchase'); } },
          'Sell the basket',
        ),
      ),
    ),
  );

  // Gather pickups
  const gather = el('section', { class: 'comp-section' }, el('h2', {}, 'On the grass'));
  if (state.bugs.length === 0) {
    gather.append(el('div', { class: 'comp-muted small' }, 'Nothing to gather right now — check back soon.'));
  } else {
    const list = el('div', { class: 'comp-actions' });
    for (const bug of [...state.bugs]) {
      list.append(
        el(
          'button',
          {
            class: 'comp-btn',
            onclick: () => {
              const got = catchBugAt(state, bug.pos.x, bug.pos.y);
              if (got?.kind === 'duckweed') events.emit('toast', `Duckweed! +${DUCKWEED_FEED} feed`);
            },
          },
          icon(PICKUPS[bug.kind]?.icon ?? 'bug', 14),
          PICKUPS[bug.kind]?.label ?? bug.kind,
        ),
      );
    }
    gather.append(list);
  }
  box.append(gather);

  // Restock
  const shop = el('section', { class: 'comp-section' }, el('h2', {}, `Restock · ${state.money} coins`));
  const row = el('div', { class: 'comp-actions' });
  for (const item of SHOP_ITEMS) {
    if (item.id === 'starterDuck') continue;
    const cost = consumableCost(state, item);
    row.append(
      el(
        'button',
        {
          class: 'comp-btn',
          disabled: state.money < cost,
          onclick: () => {
            if (state.money < cost) return;
            state.money -= cost;
            if (item.id === 'medicine') state.inventory.medicine += 1;
            else state.inventory[item.id as 'feed' | 'premiumFeed' | 'peas' | 'worms' | 'berries'] += 10;
            events.emit('purchase');
          },
        },
        `${item.name} · ${cost}`,
      ),
    );
  }
  shop.append(row);
  box.append(shop);
  return box;
}

// ---- Day (report + goals) --------------------------------------------------

export function dayScreen(game: Game): HTMLElement {
  const state = game.state;
  const report = dawnReport(state);
  const box = el('div', { class: 'comp-day' });
  box.append(
    el('h2', {}, report.dayLabel),
    el('div', { class: 'comp-muted' }, report.greeting),
    report.festivalChip ? el('div', { class: 'comp-festival' }, report.festivalChip) : el('span'),
  );
  for (const section of report.sections) {
    const sec = el('section', { class: 'comp-section' }, el('h2', {}, section.title));
    for (const line of section.lines) sec.append(el('div', { class: 'comp-line' }, line.text));
    box.append(sec);
  }
  const goals = pendingGoals(state).slice(0, 6);
  if (goals.length) {
    const sec = el('section', { class: 'comp-section' }, el('h2', {}, 'Goals'));
    for (const goal of goals) {
      const progress = goalProgress(state, goal);
      sec.append(
        el(
          'div',
          { class: 'comp-line' },
          `${goal.label} — ${Math.min(goal.target, progress)}/${goal.target} · ${goal.reward} coins`,
        ),
      );
    }
    box.append(sec);
  }
  if (state.commissions.length) {
    const sec = el('section', { class: 'comp-section' }, el('h2', {}, 'Commissions'));
    for (const c of state.commissions) sec.append(el('div', { class: 'comp-line' }, `${c.client}: ${describeCommission(c)} · ${c.reward} coins`));
    box.append(sec);
  }
  return box;
}
