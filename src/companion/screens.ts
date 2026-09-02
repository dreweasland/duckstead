// The companion's tabs plus the duck care sheet. Every button calls an
// existing pure sim function — this file is UI only. Anything that changes
// the pond goes through `ctx.act`, which the shell uses to gate actions on
// holding the pond (peeking prompts for the reins) and to redraw at once.
import { clamp } from '../types';
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
import { canBreedPair, breedReadiness } from '../sim/needs';
import { clutchFather, nestPair, pairViability } from '../sim/breeding';
import { buyUpgrade, nestCapacity, UPGRADES, upgradeLevel, sellDuck, sellPrice } from '../sim/economy';
import { ALL_BREED_KEYS } from '../sim/breedBook';
import { representativeGenome } from '../sim/breedBook';
import { createDuck } from '../sim/duck';
import { createRng } from '../rng';
import { hourOf, TICKS_PER_MINUTE } from '../sim/time';
import { canDrill, drillsLeft, train, TRAIN_STATS, trainingOf } from '../sim/training';
import { MARKS } from '../sim/marks';
import { personalityLabels } from '../sim/behavior';
import { describeLifeEvent, lifeEventChoices, resolveLifeEvent } from '../sim/lifeEvents';
import { treatVisitor, TREATS_TO_RECRUIT, visitorInFlight } from '../sim/visitors';
import { festivalEnteredToday, festivalToday, FESTIVAL_NAMES, FESTIVAL_PACKUP_HOUR } from '../sim/festivals';

export interface Ctx {
  game: Game;
  // Wrap a pond-changing handler: runs it when this device holds the pond,
  // otherwise offers the reins. Either way the screen redraws right after.
  act: (fn: () => unknown) => () => void;
}

const bar = (value: number, cls = ''): HTMLElement =>
  el(
    'div',
    { class: `comp-bar ${cls}` },
    el('div', { class: 'comp-bar-fill', style: `width:${clamp(value, 0, 100)}%` }),
  );

const needRow = (label: string, value: number): HTMLElement =>
  el('div', { class: 'comp-need' }, el('span', { class: 'comp-need-label' }, label), bar(value, value < 35 ? 'low' : ''));

// "in 12m" for a cooldown measured in ticks.
const inMinutes = (ticks: number): string => `${Math.max(1, Math.ceil(ticks / TICKS_PER_MINUTE))}m`;

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

// Is there something on the pond that wants a decision right now? Drives
// the dot on the Day tab.
export function attentionCount(game: Game): number {
  const s = game.state;
  let n = 0;
  if (s.lifeEvent) n += 1;
  if (s.visitor && !visitorInFlight(s.visitor)) n += 1;
  const fest = festivalToday(s.clock);
  if (fest && !festivalEnteredToday(s, fest) && hourOf(s.clock) < FESTIVAL_PACKUP_HOUR) n += 1;
  return n;
}

// ---- Flock ----------------------------------------------------------------

export function flockScreen(ctx: Ctx, openDuck: (id: string) => void): HTMLElement {
  const game = ctx.game;
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

// The shell only calls this for a duck that exists (see Shell.renderScreen).
export function duckScreen(ctx: Ctx, duck: Duck, back: () => void): HTMLElement {
  const { game, act } = ctx;
  const state = game.state;
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

  const btn = (label: string, ok: boolean, fn: () => unknown): HTMLElement =>
    el('button', { class: 'comp-btn', disabled: !ok, onclick: act(fn) }, label);

  if (duck.stage === 'egg') {
    const pct = Math.min(100, Math.round((duck.incubationTicks / eggIncubationTicks(state)) * 100));
    const warmth = Math.round(eggWarmth(duck));
    const tuckWait = duck.petCooldownTicks;
    box.append(
      needRow(`Incubation ${pct}%`, pct),
      needRow(`Warmth ${warmth}%`, warmth),
      el(
        'div',
        { class: 'comp-actions' },
        duck.readyToHatch
          ? btn('Hatch!', true, () => claimHatch(state, game.rng, duck.id))
          : btn(tuckWait > 0 ? `Tucked in · again in ${inMinutes(tuckWait)}` : 'Tuck into the straw', tuckWait === 0 && warmth < 95, () => tuckEgg(state, duck.id)),
        duck.readyToHatch
          ? el('span')
          : el('span', { class: 'comp-muted small' }, 'Keep it warm — cold eggs incubate slowly.'),
      ),
    );
    return box;
  }

  const tags = el('div', { class: 'comp-tags' });
  for (const label of personalityLabels(duck)) tags.append(el('span', { class: 'comp-tag' }, label));
  for (const m of duck.marks ?? []) tags.append(el('span', { class: 'comp-tag mark', title: MARKS[m].blurb }, MARKS[m].label));
  box.append(
    tags,
    needRow('Hunger', duck.needs.hunger),
    needRow('Clean', duck.needs.cleanliness),
    needRow('Happy', duck.needs.happiness),
    needRow('Health', duck.needs.health),
  );
  if (duck.stage !== 'duckling') {
    const t = trainingOf(duck);
    const gate = canDrill(state, duck);
    const drills = el('div', { class: 'comp-actions' });
    for (const stat of TRAIN_STATS) {
      drills.append(btn(`Drill ${stat} (${Math.round(t[stat])})`, gate.ok, () => train(state, duck.id, stat, 0.4)));
    }
    const left = drillsLeft(state, duck);
    box.append(
      el(
        'section',
        { class: 'comp-section' },
        el('h2', {}, `Training · ${left} drill${left === 1 ? '' : 's'} left today`),
        // Tooltips never show on touch: the reason a drill is off goes in the text.
        el('div', { class: 'comp-muted small' }, gate.ok ? 'Pocket drills go through the motions at modest form; the desktop drills earn far more.' : gate.reason ?? 'No drills right now.'),
        drills,
      ),
    );
  }

  const inv = state.inventory;
  const iconBtn = (iconName: Parameters<typeof icon>[0], label: string, ok: boolean, fn: () => unknown): HTMLElement =>
    el('button', { class: 'comp-btn', disabled: !ok, onclick: act(fn) }, icon(iconName, 14), label);
  const treatBtn = (kind: 'peas' | 'worms' | 'berries'): HTMLElement => {
    const fav = favouriteTreat(duck) === kind && duck.favouriteKnown;
    const dot = el('span', { class: 'treat-dot' });
    dot.style.background = FOODS[kind].color;
    return el(
      'button',
      { class: 'comp-btn', disabled: stockOf(state, kind) === 0, onclick: act(() => feedDuckDirectly(state, duck.id, kind)) },
      dot,
      `${FOODS[kind].name}${fav ? ' ★' : ''} (${stockOf(state, kind)})`,
    );
  };
  const petWait = duck.petCooldownTicks;
  box.append(
    el(
      'div',
      { class: 'comp-actions' },
      iconBtn('wheat', `Feed (${inv.feed})`, inv.feed > 0, () => feedDuckDirectly(state, duck.id, false)),
      iconBtn('sparkle', `Premium (${inv.premiumFeed})`, inv.premiumFeed > 0, () => feedDuckDirectly(state, duck.id, true)),
      // petDuck refuses inside its cooldown; say so instead of a dead button.
      iconBtn('hand', petWait > 0 ? `Petted · ${inMinutes(petWait)}` : 'Pet', petWait === 0, () => petDuck(state, duck.id)),
      iconBtn('bubbles', 'Clean', duck.needs.cleanliness < 100, () => cleanDuck(state, duck.id)),
      treatBtn('peas'),
      treatBtn('worms'),
      treatBtn('berries'),
      duck.sick ? iconBtn('pill', `Medicine (${inv.medicine})`, inv.medicine > 0, () => medicateDuck(state, duck.id)) : el('span'),
    ),
  );
  return box;
}

// ---- Nest (breeding) -------------------------------------------------------

export function nestScreen(ctx: Ctx, pick: string | null, setPick: (id: string | null) => void): HTMLElement {
  const { game, act } = ctx;
  const state = game.state;
  const box = el('div', { class: 'comp-pond' });
  const adults = state.ducks.filter((d) => d.stage === 'adult' && !d.penned);
  const first = pick ? adults.find((d) => d.id === pick) : undefined;
  const eggs = state.ducks.filter((d) => d.stage === 'egg');
  const clutches = state.pendingClutches;

  const pairing = el('section', { class: 'comp-section' }, el('h2', {}, first ? `Pair ${first.name} with…` : 'Pair two adults'));
  pairing.append(el('div', { class: 'comp-muted small' }, `Nest: ${eggs.length + clutches.length}/${nestCapacity(state)}. ${first ? 'Tap a mate.' : 'Tap the first of the pair.'}`));
  const grid = el('div', { class: 'comp-grid' });
  for (const duck of adults) {
    const ready = breedReadiness(duck);
    const pairOk = first && first.id !== duck.id ? canBreedPair(first, duck) : null;
    const odds = first && pairOk?.ok ? Math.round(pairViability(state, first, duck) * 100) : null;
    const note = odds !== null ? `${odds}% odds` : first && pairOk && !pairOk.ok ? pairOk.reason ?? '' : ready.ok ? `${duck.sex === 'M' ? '♂' : '♀'} ready` : ready.reason ?? '';
    grid.append(
      el(
        'button',
        {
          class: `comp-card${first?.id === duck.id ? ' needs-care' : ''}`,
          disabled: first ? first.id === duck.id ? false : !pairOk?.ok : !ready.ok,
          onclick: act(() => {
            if (!first) return setPick(duck.id);
            if (first.id === duck.id) return setPick(null);
            const res = nestPair(state, first.id, duck.id);
            if (!res.ok && res.reason) events.emit('toast', res.reason);
            setPick(null);
          }),
        },
        duckPortrait(duck, 56),
        el('div', { class: 'comp-card-name' }, duck.name),
        el('div', { class: 'comp-muted small' }, note),
      ),
    );
  }
  pairing.append(grid);
  box.append(pairing);

  if (clutches.length > 0) {
    const sec = el('section', { class: 'comp-section' }, el('h2', {}, 'Courting'));
    for (const c of clutches) {
      const m = state.ducks.find((d) => d.id === c.motherId);
      const f = clutchFather(state, c);
      sec.append(el('div', { class: 'comp-line' }, `${m?.name ?? '?'} & ${f?.name ?? '?'} — egg in ${Math.ceil(c.ticksRemaining / TICKS_PER_MINUTE)}m`));
    }
    box.append(sec);
  }
  if (eggs.length > 0) {
    const sec = el('section', { class: 'comp-section' }, el('h2', {}, `Incubating · ${eggs.length}`));
    const list = el('div', { class: 'comp-actions' });
    for (const egg of eggs) {
      const pct = Math.min(100, Math.round((egg.incubationTicks / eggIncubationTicks(state)) * 100));
      list.append(
        egg.readyToHatch
          ? el('button', { class: 'comp-btn', onclick: act(() => claimHatch(state, game.rng, egg.id)) }, `Hatch! (${egg.name === 'Egg' ? 'egg' : egg.name})`)
          : el(
              'button',
              { class: 'comp-btn', disabled: egg.petCooldownTicks > 0, onclick: act(() => tuckEgg(state, egg.id)) },
              egg.petCooldownTicks > 0 ? `Tucked · ${pct}% · again in ${inMinutes(egg.petCooldownTicks)}` : `Tuck in · ${pct}% · warmth ${Math.round(eggWarmth(egg))}%`,
            ),
        el('button', { class: 'comp-btn ghost', onclick: act(() => { sellDuck(state, egg.id); events.emit('purchase'); }) }, `Sell egg · ${sellPrice(state, egg)}`),
      );
    }
    sec.append(list);
    box.append(sec);
  }
  return box;
}

// ---- Shop (upgrades) --------------------------------------------------------

export function shopScreen(ctx: Ctx): HTMLElement {
  const { game, act } = ctx;
  const state = game.state;
  const box = el('div', { class: 'comp-pond' });
  const sec = el('section', { class: 'comp-section' }, el('h2', {}, `Upgrades · ${state.money} coins`));
  const list = el('div', { class: 'comp-actions comp-upgrades' });
  for (const def of UPGRADES) {
    const level = upgradeLevel(state, def.id);
    const maxed = level >= def.maxLevel;
    const cost = maxed ? 0 : def.costs[level];
    list.append(
      el(
        'button',
        { class: 'comp-btn comp-upgrade', disabled: maxed || state.money < cost, onclick: act(() => { buyUpgrade(state, def.id); events.emit('purchase'); }) },
        el('strong', {}, def.name + (def.maxLevel > 1 ? ` ${level}/${def.maxLevel}` : '')),
        el('span', { class: 'comp-muted small' }, maxed ? 'owned' : `${cost} coins`),
        el('span', { class: 'comp-muted small' }, def.description),
      ),
    );
  }
  sec.append(list);
  box.append(sec);
  return box;
}

// ---- Book ------------------------------------------------------------------

export function bookScreen(ctx: Ctx): HTMLElement {
  const state = ctx.game.state;
  const box = el('div', { class: 'comp-pond' });
  const found = Object.keys(state.breedBook).length;
  const sec = el('section', { class: 'comp-section' }, el('h2', {}, `Breed Book · ${found}/${ALL_BREED_KEYS.length}`));
  const grid = el('div', { class: 'comp-grid' });
  for (const key of ALL_BREED_KEYS) {
    const entry = state.breedBook[key];
    const sample = createDuck(createRng(7), { genome: representativeGenome(key), stage: 'adult', pos: { x: 0, y: 0 }, sex: 'F', name: key });
    sample.id = `book:${key}`;
    grid.append(
      el(
        'div',
        { class: `comp-card${entry ? '' : ' comp-locked'}` },
        duckPortrait(sample, 56),
        el('div', { class: 'comp-card-name' }, entry ? breedLabel(key) : '?'),
        el('div', { class: 'comp-muted small' }, entry ? `first: ${entry.firstName} · ${entry.count} hatched` : 'undiscovered'),
      ),
    );
  }
  sec.append(grid);
  box.append(sec);
  if (state.chronicle.length > 0) {
    const chron = el('section', { class: 'comp-section' }, el('h2', {}, 'Chronicle'));
    for (const e of [...state.chronicle].reverse().slice(0, 20)) chron.append(el('div', { class: 'comp-line' }, e.text));
    box.append(chron);
  }
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
  frog: { icon: 'leaf', label: 'Frog' },
  dragonfly: { icon: 'sparkle', label: 'Dragonfly' },
};

export function pondScreen(ctx: Ctx): HTMLElement {
  const { game, act } = ctx;
  const state = game.state;
  const box = el('div', { class: 'comp-pond' });

  // Trough — fillFeeder is a no-op without the upgrade, so say so rather
  // than show a button that does nothing.
  const cap = feederCapacity(state);
  const level = state.feeder.food;
  const hasTrough = upgradeLevel(state, 'feedingTrough') > 0;
  box.append(
    el(
      'section',
      { class: 'comp-section' },
      el('h2', {}, 'Feed trough'),
      hasTrough
        ? needRow(`${level}/${cap} pellets`, (level / cap) * 100)
        : el('div', { class: 'comp-muted small' }, 'No trough yet — the Feeding Trough upgrade in the Shop tab lets the flock feed itself.'),
      hasTrough
        ? el(
            'div',
            { class: 'comp-actions' },
            el(
              'button',
              { class: 'comp-btn', disabled: state.inventory.feed === 0 || level >= cap, onclick: act(() => fillFeeder(state)) },
              `Fill trough (feed: ${state.inventory.feed})`,
            ),
          )
        : el('span'),
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
        el('button', { class: 'comp-btn', disabled: !isPondDirty(state), onclick: act(() => cleanPond(state)) }, 'Skim the pond'),
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
          { class: 'comp-btn', disabled: state.inventory.eggs === 0, onclick: act(() => { sellEggBasket(state); events.emit('purchase'); }) },
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
            onclick: act(() => {
              const got = catchBugAt(state, bug.pos.x, bug.pos.y);
              if (got?.kind === 'duckweed') events.emit('toast', `Duckweed! +${DUCKWEED_FEED} feed`);
            }),
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
          onclick: act(() => {
            if (state.money < cost) return;
            state.money -= cost;
            if (item.id === 'medicine') state.inventory.medicine += 1;
            else state.inventory[item.id as 'feed' | 'premiumFeed' | 'peas' | 'worms' | 'berries'] += 10;
            events.emit('purchase');
          }),
        },
        `${item.name} · ${cost}`,
      ),
    );
  }
  shop.append(row);
  box.append(shop);
  return box;
}

// ---- Day (right now + report + goals) ---------------------------------------

export function dayScreen(ctx: Ctx, openDuck: (id: string) => void): HTMLElement {
  const { game, act } = ctx;
  const state = game.state;
  const report = dawnReport(state, 'companion');
  const box = el('div', { class: 'comp-day' });
  box.append(
    el('h2', {}, report.dayLabel),
    el('div', { class: 'comp-muted' }, report.greeting),
    report.festivalChip ? el('div', { class: 'comp-festival' }, report.festivalChip) : el('span'),
  );

  // Things waiting on a decision — the reason to open the phone at all.
  const now = el('section', { class: 'comp-section comp-now' }, el('h2', {}, 'Right now'));
  let anything = false;
  const ev = state.lifeEvent;
  if (ev) {
    anything = true;
    const { title, text } = describeLifeEvent(state, ev);
    const duck = state.ducks.find((d) => d.id === ev.duckId);
    const other = state.ducks.find((d) => d.id === ev.otherId);
    const card = el(
      'div',
      { class: 'comp-card-wide' },
      el('div', { class: 'comp-now-head' }, duck ? duckPortrait(duck, 44) : el('span'), other ? duckPortrait(other, 44) : el('span'), el('strong', {}, title)),
      el('div', { class: 'comp-muted small' }, text),
    );
    const choices = el('div', { class: 'comp-actions comp-choices' });
    for (const c of lifeEventChoices(state, ev)) {
      choices.append(
        el(
          'button',
          { class: 'comp-btn', disabled: !c.ok, onclick: act(() => resolveLifeEvent(state, game.rng, c.id)) },
          el('strong', {}, c.label),
          el('span', { class: 'comp-muted small' }, c.ok ? c.blurb : c.reason ?? c.blurb),
        ),
      );
    }
    card.append(choices, el('div', { class: 'comp-muted small' }, 'Left alone, the flock settles it by evening.'));
    now.append(card);
  }
  const v = state.visitor;
  if (v && !visitorInFlight(v)) {
    anything = true;
    now.append(
      el(
        'div',
        { class: 'comp-card-wide' },
        el('div', { class: 'comp-now-head' }, duckPortrait(v.duck, 44), el('strong', {}, `${v.duck.name}, a wild duck, is on the bank`)),
        el('div', { class: 'comp-muted small' }, `${v.treatsGiven}/${TREATS_TO_RECRUIT} treats so far — premium feed wins it over before it flies on.`),
        el(
          'div',
          { class: 'comp-actions' },
          el(
            'button',
            { class: 'comp-btn', disabled: state.inventory.premiumFeed === 0, onclick: act(() => treatVisitor(state)) },
            icon('sparkle', 14),
            `Offer a treat (${state.inventory.premiumFeed})`,
          ),
        ),
      ),
    );
  }
  const fest = festivalToday(state.clock);
  if (fest && !festivalEnteredToday(state, fest) && hourOf(state.clock) < FESTIVAL_PACKUP_HOUR) {
    anything = true;
    now.append(
      el(
        'div',
        { class: 'comp-card-wide' },
        el('div', { class: 'comp-now-head' }, icon('flag', 18), el('strong', {}, `${FESTIVAL_NAMES[fest]} today`)),
        el('div', { class: 'comp-muted small' }, `Festivals are played at the desktop. It packs up at ${FESTIVAL_PACKUP_HOUR}:00 pond time${state.sponsored[fest] ? ' — and your sponsorship is spent then' : ''}.`),
      ),
    );
  }
  if (!anything) now.append(el('div', { class: 'comp-muted small' }, 'Nothing needs deciding. The flock is getting on with it.'));
  box.append(now);

  for (const section of report.sections) {
    const sec = el('section', { class: 'comp-section' }, el('h2', {}, section.title));
    for (const line of section.lines) {
      const text = line.detail ? `${line.text} ${line.detail}` : line.text;
      // Lines about a particular duck open that duck.
      const duck = line.duck && state.ducks.some((d) => d.id === line.duck!.id) ? line.duck : undefined;
      sec.append(
        duck
          ? el('button', { class: `comp-line comp-line-btn${line.urgent ? ' urgent' : ''}`, onclick: () => openDuck(duck.id) }, duckPortrait(duck, 28), el('span', {}, text))
          : el('div', { class: `comp-line${line.urgent ? ' urgent' : ''}` }, text),
      );
    }
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
