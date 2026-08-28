import type { PanelCtx } from './ui';
import { el } from './dom';
import { elderDaysLeft, passingPoints } from '../sim/elders';
import { MASTER_COUNT } from '../sim/awards';
import { icon, sexBadge, starRow, type IconName } from './icons';
import { duckPortrait } from './portrait';
import { buildGeneticsCard } from './geneticsCard';
import { buildPedigreeCard, buildStandardCard } from './pedigreeCard';
import { commissionGap, describeCommission, duckFits, fulfilCommission } from '../sim/commissions';
import { championTitle } from '../sim/society';
import { canPen, penCapacity, penDuck, penDucks, releaseDuck } from '../sim/pen';
import { sellDuck, sellPrice } from '../sim/economy';
import { matchesRequest, requestPrice, sellToBuyer } from '../sim/visitors';
import { personalityLabels } from '../sim/behavior';
import { MARKS } from '../sim/marks';
import { canDrill, drillCoinsLeft, drillsLeft, drillsPerDay, TRAIN_STAT_META, TRAIN_STATS, trainingOf } from '../sim/training';
import { DRILL_META, openDrill } from './trainingPanel';
import { openPhoto } from './photo';
import { breedingValue, keepVerdict, verdictReason } from '../sim/advisor';
import { breedKey, breedLabel } from '../sim/breedBook';
import {
  breedReadiness,
  cleanDuck,
  eggSpeedFor,
  eggWarmth,
  feedDuckDirectly,
  medicateDuck,
  petDuck,
  tuckEgg,
} from '../sim/needs';
import { claimHatch, eggIncubationTicks } from '../sim/lifecycle';
import { TICKS_PER_DAY } from '../sim/time';
import { favouriteTreat, FOODS, TREATS, type FoodKind } from '../sim/food';

const NEED_LABELS: Array<[keyof import('../sim/duck').Needs, IconName, string]> = [
  ['hunger', 'wheat', 'Hunger'],
  ['cleanliness', 'bubbles', 'Clean'],
  ['happiness', 'smile', 'Happy'],
  ['health', 'heart', 'Health'],
];

export function renderDuckPanel(ctx: PanelCtx): HTMLElement | null {
  const { game } = ctx;
  const duck = game.state.ducks.find((d) => d.id === (ctx.duckId ?? game.selectedDuckId));
  if (!duck) return null;

  const panel = el('aside', { class: 'panel' });
  panel.append(
    el(
      'div',
      { class: 'panel-header' },
      duckPortrait(duck, 84),
      el(
        'div',
        { class: 'panel-title' },
        buildNameEditor(ctx, duck.id, duck.name),
        duck.stage === 'egg'
          ? el('div', { class: 'muted' }, 'Egg')
          : el(
              'div',
              { class: 'muted' },
              sexBadge(duck.sex),
              ` ${duck.stage} · ${(duck.ageTicks / TICKS_PER_DAY).toFixed(1)}d${duck.sick ? ' · sick' : ''}`,
            ),
        starRow(duck.phenotype.rarityScore),
      ),
      el(
        'div',
        { class: 'card-window-btns' },
        el(
          'button',
          { class: 'close-btn photo-btn', title: 'Take a portrait photo to save or share', onclick: () => openPhoto(game, { toast: (m) => ctx.ui.toast(m) }, duck) },
          icon('sparkle', 13),
        ),
        ctx.pinned
          ? el('span', { class: 'chip chip-trait pin-chip', title: 'Pinned for comparison' }, 'pinned')
          : el(
              'button',
              {
                class: 'close-btn pin-btn',
                title: ctx.ui.isPinned(duck.id) ? 'Already pinned' : 'Pin this card open to compare with another duck (Ctrl/Cmd-click a duck or card does the same)',
                disabled: ctx.ui.isPinned(duck.id),
                onclick: () => {
                  ctx.ui.pinDuck(duck.id);
                  ctx.ui.refreshPanel();
                },
              },
              icon('cards', 13),
            ),
        el('button', { class: 'close-btn', onclick: ctx.close }, icon('close', 13)),
      ),
    ),
  );

  // Temperament + friendship + breeding readiness.
  if (duck.stage !== 'egg') {
    const traits = el('div', { class: 'gene-badges' });
    for (const label of personalityLabels(duck)) {
      traits.append(el('span', { class: 'chip chip-trait', title: label === 'bold' || label === 'timid' || label === 'steady' ? 'Temperament — inherited through the temper loci' : 'A quirk of this duck' }, label));
    }
    for (const mark of duck.marks ?? []) {
      traits.append(el('span', { class: 'chip chip-mark', title: `${MARKS[mark].blurb} (earned: ${MARKS[mark].how})` }, MARKS[mark].label));
    }
    if (duck.stage === 'adult') {
      const readiness = breedReadiness(duck);
      traits.append(
        readiness.ok
          ? el('span', { class: 'chip chip-ready with-icon' }, icon('egg', 9), 'ready to breed')
          : el('span', { class: 'chip chip-trait' }, readiness.reason ?? ''),
      );
    }
    if (duck.penned) traits.append(el('span', { class: 'chip chip-trait with-icon', title: 'In the bachelor pen — out of the breeding population' }, icon('cross', 9), 'penned'));
    if (duck.stage !== 'elder') {
      const v = keepVerdict(breedingValue(game.state, duck));
      traits.append(
        v === 'key'
          ? el('span', { class: 'chip chip-rare', title: 'Sole carrier of a rare gene — see the Line tab' }, 'key breeder')
          : v === 'useful'
            ? el('span', { class: 'chip chip-ready', title: 'Reaches breeds nobody else can — see the Line tab' }, 'worth keeping')
            : el('span', { class: 'chip chip-trait', title: 'Its genes are covered by the rest of the flock — see the Line tab' }, 'safe to sell'),
      );
    }
    const title = championTitle(game.state, duck);
    if (title) traits.append(el('span', { class: 'chip chip-rare with-icon', title: 'A Society title held by the pond\'s top-pedigree duck' }, icon('star', 9), title));
    const friend = duck.friendId
      ? game.state.ducks.find((d) => d.id === duck.friendId)
      : undefined;
    if (friend) {
      traits.append(
        el('span', { class: 'chip chip-friend with-icon' }, icon('heartOutline', 9), friend.name),
      );
    }
    if (traits.childElementCount > 0) panel.append(el('div', { class: 'section' }, traits));
  }

  // Eggs are short: everything fits without tabs.
  if (duck.stage === 'egg') {
    const target = eggIncubationTicks(game.state);
    const pct = Math.min(100, (duck.incubationTicks / target) * 100);
    const warmth = eggWarmth(duck);
    const speed = eggSpeedFor(warmth);
    const incubator = (game.state.upgrades.incubator ?? 0) > 0;
    const warmthWord = warmth > 70 ? 'toasty' : warmth > 40 ? 'warm' : warmth > 15 ? 'cool' : 'cold';
    panel.append(
      el(
        'div',
        { class: 'section' },
        el(
          'div',
          { class: 'muted' },
          duck.readyToHatch ? 'Cracking — ready to hatch!' : `Incubating… ${pct.toFixed(0)}%`,
        ),
        bar(pct, '#e8b83a'),
        el(
          'div',
          { class: 'need-row' },
          el('span', { class: 'need-label' }, icon('sparkle', 13), ' Warmth'),
          bar(warmth, warmth > 40 ? '#e0893a' : '#6aa0d8'),
        ),
        el(
          'div',
          { class: 'small muted' },
          incubator
            ? 'The incubator keeps it at a steady warmth.'
            : `${warmthWord} — incubating at ${speed.toFixed(1)}× speed. Warm eggs hatch sooner and happier.`,
        ),
      ),
      el(
        'div',
        { class: 'section care-actions' },
        duck.readyToHatch
          ? actionBtn(ctx, 'egg', 'Hatch!', true, () => claimHatch(game.state, game.rng, duck.id))
          : actionBtn(
              ctx,
              'hand',
              duck.petCooldownTicks > 0 ? 'Tucked in' : 'Tuck in',
              duck.petCooldownTicks <= 0 && !incubator,
              () => tuckEgg(game.state, duck.id),
              incubator ? 'The incubator has it covered' : duck.petCooldownTicks > 0 ? 'Tucked in recently' : '',
            ),
      ),
    );
  }
  if (duck.stage === 'egg') {
    panel.append(buildGeneticsCard(game.state, duck), buildPedigreeCard(game.state, duck));
    return panel;
  }

  // At a glance: needs and the four quick care actions stay above the tabs.
  const careTab = el('div', { class: 'card-tab-body' });
  const genesTab = el('div', { class: 'card-tab-body' });
  const lineTab = el('div', { class: 'card-tab-body' });
  const sellTab = el('div', { class: 'card-tab-body' });
  {
    const needsBox = el('div', { class: 'section' });
    for (const [key, iconName, label] of NEED_LABELS) {
      const value = duck.needs[key];
      needsBox.append(
        el(
          'div',
          { class: 'need-row' },
          el('span', { class: 'need-label' }, icon(iconName, 13), ` ${label}`),
          bar(value, value > 60 ? '#69b356' : value > 30 ? '#e0a93a' : '#d4544a'),
        ),
      );
    }
    panel.append(needsBox);

    const inv = game.state.inventory;
    // Favourite treat: a question mark until found by feeding.
    const fav = favouriteTreat(duck);
    const feedWith = (kind: FoodKind) => () => {
      const result = feedDuckDirectly(game.state, duck.id, kind);
      if (result?.discovered) {
        ctx.ui.toast(`${duck.name} loves ${FOODS[kind].name.toLowerCase()}!`);
      }
      return result !== null;
    };
    const treatRow = el('div', { class: 'section care-actions treats' });
    for (const kind of TREATS) {
      const stock = inv[kind];
      const isFav = duck.favouriteKnown && fav === kind;
      treatRow.append(
        actionBtn(ctx, isFav ? 'heart' : 'sparkle', FOODS[kind].name, stock > 0, feedWith(kind),
          stock > 0 ? '' : `No ${FOODS[kind].name.toLowerCase()} — buy some at the shop`),
      );
    }
    panel.append(
      el(
        'div',
        { class: 'section care-actions' },
        actionBtn(ctx, 'wheat', 'Feed', inv.feed > 0, feedWith('feed'),
          inv.feed > 0 ? '' : 'No feed — buy some at the shop'),
        actionBtn(ctx, 'bubbles', 'Clean', true, () => cleanDuck(game.state, duck.id)),
        actionBtn(ctx, 'hand', duck.petCooldownTicks > 0 ? 'Petted' : 'Pet', duck.petCooldownTicks <= 0,
          () => petDuck(game.state, duck.id),
          duck.petCooldownTicks > 0 ? `${duck.name} was petted recently` : ''),
        actionBtn(ctx, 'pill', 'Medicine', duck.sick && inv.medicine > 0, () => medicateDuck(game.state, duck.id),
          !duck.sick ? `${duck.name} is not sick` : inv.medicine <= 0 ? 'No medicine in stock' : ''),
      ),
    );
    careTab.append(
      el(
        'div',
        { class: 'fav-line' },
        el('span', { class: 'muted small' }, 'Favourite treat: '),
        duck.favouriteKnown
          ? el('span', { class: 'chip chip-friend with-icon' }, icon('heart', 9), FOODS[fav].name.toLowerCase())
          : el('span', { class: 'chip chip-trait', title: 'Try peas, worms, and berries to find out' }, '?'),
      ),
      treatRow,
    );
  }

  // Training: drilled stats and today's drills.
  if (duck.stage === 'juvenile' || duck.stage === 'adult' || duck.stage === 'elder') {
    const t = trainingOf(duck);
    const left = drillsLeft(game.state, duck);
    const gate = canDrill(game.state, duck);
    const box = el(
      'div',
      { class: 'section training' },
      el(
        'div',
        { class: 'pedigree-head' },
        el('strong', {}, 'Training'),
        el('span', { class: 'muted small' }, `${left}/${drillsPerDay(game.state)} drills today`),
      ),
    );
    for (const stat of TRAIN_STATS) {
      box.append(
        el(
          'div',
          { class: 'need-row', title: TRAIN_STAT_META[stat].blurb },
          el('span', { class: 'need-label' }, TRAIN_STAT_META[stat].label),
          bar(t[stat], '#6aa0d8'),
          el('span', { class: 'muted small train-num' }, String(Math.round(t[stat]))),
        ),
      );
    }
    const drills = el('div', { class: 'care-actions' });
    for (const stat of TRAIN_STATS) {
      drills.append(
        el(
          'button',
          {
            class: 'action-btn',
            disabled: !gate.ok,
            title: gate.ok ? DRILL_META[stat].hint : gate.reason ?? '',
            onclick: () => openDrill(game, { toast: (m) => ctx.ui.toast(m), refresh: () => ctx.ui.refreshPanel() }, duck, stat),
          },
          icon(DRILL_META[stat].icon, 13),
          DRILL_META[stat].label,
        ),
      );
    }
    box.append(
      drills,
      el('div', { class: 'muted small' }, `Stats fade a point a day. Bold ducks take to sprints; timid ones to poise. Drills pay up to ${drillCoinsLeft(game.state)} more coins today.`),
    );
    careTab.append(box);
  }

  // Bachelor pen: park a duck out of breeding without selling it.
  if (duck.stage !== 'duckling') {
    const gate = canPen(game.state, duck);
    const used = penDucks(game.state).length;
    careTab.append(
      el(
        'div',
        { class: 'section actions' },
        duck.penned
          ? el('button', { class: 'action-btn', onclick: () => { releaseDuck(game.state, duck.id); ctx.ui.refreshPanel(); } }, 'Release from the pen')
          : el(
              'button',
              { class: 'action-btn', disabled: !gate.ok, title: gate.reason ?? `${used}/${penCapacity(game.state)} in the pen`, onclick: () => { penDuck(game.state, duck.id); ctx.ui.refreshPanel(); } },
              gate.ok ? `Send to the pen (${used}/${penCapacity(game.state)})` : gate.reason ?? 'Send to the pen',
            ),
        el('div', { class: 'muted small' }, duck.penned ? 'Sitting out: no breeding, no drake pressure, no laying. Still needs feeding and brushing.' : 'Sits out of breeding without being sold — handy for a surplus drake.'),
      ),
    );
  }

  // Breeding advisor: is this duck worth keeping?
  if (duck.stage === 'elder') {
    const advisor = el('div', { class: 'section advisor' }, el('strong', {}, 'Breeding value'));
    const line = el('div', { class: 'gene-badges' });
    line.append(el('span', { class: 'chip chip-trait' }, 'wise elder'));
    advisor.append(
      line,
      el(
        'div',
        { class: 'muted small' },
        'Past breeding age. Elder hens keep nest eggs warm, elders steady the young, and a life lived out here ends in an honoured passing.',
      ),
    );
    lineTab.append(advisor);
  } else {
    const value = breedingValue(game.state, duck);
    const verdict = keepVerdict(value);
    const advisor = el('div', { class: 'section advisor' }, el('strong', {}, 'Breeding value'));
    const line = el('div', { class: 'gene-badges' });
    if (verdict === 'key') {
      line.append(el('span', { class: 'chip chip-rare' }, 'key breeder'));
    } else if (verdict === 'useful') {
      line.append(el('span', { class: 'chip chip-ready' }, value.marginalBreeds.length > 0 ? 'worth keeping' : 'best of breed'));
    } else {
      line.append(el('span', { class: 'chip chip-trait' }, value.duplicates.length > 0 ? 'genes duplicated — safe to sell' : 'covered — safe to sell'));
    }
    advisor.append(line, el('div', { class: 'muted small' }, verdictReason(value)));
    if (value.newBreeds.length > 0) {
      advisor.append(
        el(
          'div',
          {
            class: 'muted small',
            title: value.newBreeds.slice(0, 6).map(breedLabel).join(' · '),
          },
          `Could help unlock ${value.newBreeds.length} undiscovered breed${value.newBreeds.length === 1 ? '' : 's'}`,
        ),
      );
    }
    if (value.uniqueAlleles.length > 0) {
      advisor.append(
        el(
          'div',
          { class: 'muted small' },
          `Only flock carrier of: ${value.uniqueAlleles.join(', ')} — selling loses these genes`,
        ),
      );
    }
    lineTab.append(advisor);
  }

  // Genetics card.
  genesTab.append(buildGeneticsCard(game.state, duck));
  genesTab.append(buildStandardCard(game.state, duck));
  lineTab.append(buildPedigreeCard(game.state, duck));

  // Commissions this duck could fill — and ones it's the right breed for but
  // falls short on, with the gap spelled out.
  const fits = game.state.commissions.filter((c) => duckFits(duck, c));
  const near = game.state.commissions.filter((c) => !duckFits(duck, c) && (commissionGap(duck, c)?.length ?? 0) > 0);
  if (fits.length > 0 || near.length > 0) {
    const box = el('div', { class: 'section actions' }, el('strong', {}, 'Commissions'));
    for (const c of near) {
      box.append(
        el(
          'div',
          { class: 'muted small commission-gap' },
          el('span', {}, `${c.client} wants ${describeCommission(c)} — `),
          el('span', { class: 'warn-text' }, commissionGap(duck, c)!.join('; ')),
        ),
      );
    }
    for (const c of fits) {
      box.append(
        el(
          'button',
          {
            class: 'action-btn primary',
            title: describeCommission(c),
            onclick: () => {
              if (pendingCommissionFor === `${duck.id}:${c.id}`) {
                pendingCommissionFor = null;
                fulfilCommission(game.state, c.id, duck.id);
                ctx.close();
              } else {
                pendingCommissionFor = `${duck.id}:${c.id}`;
                ctx.ui.refreshPanel();
              }
            },
          },
          pendingCommissionFor === `${duck.id}:${c.id}` ? `Really deliver ${duck.name} to ${c.client}?` : `Deliver to ${c.client} `,
          pendingCommissionFor === `${duck.id}:${c.id}` ? null : icon('coin', 12),
          pendingCommissionFor === `${duck.id}:${c.id}` ? '' : ` ${c.reward}`,
        ),
      );
    }
    sellTab.append(box);
  }

  // Premium sale to the visiting buyer, when this duck matches the request.
  if (game.state.request && matchesRequest(duck, game.state.request)) {
    const buyerPrice = requestPrice(game.state, duck);
    const buyerSection = el('div', { class: 'section actions' });
    if (pendingBuyerSellFor === duck.id) {
      buyerSection.append(
        el(
          'button',
          {
            class: 'action-btn primary',
            onclick: () => {
              pendingBuyerSellFor = null;
              sellToBuyer(game.state, duck.id);
              ctx.close();
            },
          },
          `Really sell ${duck.name} to the buyer?`,
        ),
        el(
          'button',
          {
            class: 'action-btn',
            onclick: () => {
              pendingBuyerSellFor = null;
              ctx.ui.refreshPanel();
            },
          },
          'Cancel',
        ),
      );
    } else {
      buyerSection.append(
        el(
          'button',
          {
            class: 'action-btn primary',
            title: 'Matches the buyer request',
            onclick: () => {
              pendingBuyerSellFor = duck.id;
              ctx.ui.refreshPanel();
            },
          },
          'Sell to buyer ',
          icon('coin', 12),
          ` ${buyerPrice}`,
        ),
      );
    }
    sellTab.append(buyerSection);
  }

  // Inline two-step confirm — native confirm() would block the game loop.
  const price = sellPrice(game.state, duck);
  const sellSection = el('div', { class: 'section actions' });
  // The sell-button conscience: an elder is close to an honoured passing —
  // say plainly what selling would forfeit before the coins change hands.
  if (duck.stage === 'elder') {
    const days = elderDaysLeft(duck);
    const points = passingPoints(duck);
    const lines: string[] = [
      `${duck.name} is ${days <= 1 ? 'less than a day' : `about ${days} days`} from a peaceful passing — worth +${points} Society point${points === 1 ? '' : 's'} and a feather for the album.`,
    ];
    const key = breedKey(duck.genome);
    const aliveOfBreed = game.state.ducks.filter((d) => d.stage !== 'egg' && breedKey(d.genome) === key).length;
    if (aliveOfBreed === MASTER_COUNT && !game.state.awards[key]?.master) {
      lines.push(`Selling drops your living ${breedLabel(key)} count below ${MASTER_COUNT} — the Master award needs them alive at once.`);
    }
    sellSection.append(el('div', { class: 'muted small elder-note' }, lines.join(' ')));
  }
  if (pendingSellFor === duck.id) {
    sellSection.append(
      el(
        'button',
        {
          class: 'danger-btn',
          onclick: () => {
            pendingSellFor = null;
            sellDuck(game.state, duck.id);
            ctx.close();
          },
        },
        `Really sell ${duck.name}?`,
      ),
      el(
        'button',
        {
          class: 'action-btn',
          onclick: () => {
            pendingSellFor = null;
            ctx.ui.refreshPanel();
          },
        },
        'Cancel',
      ),
    );
  } else {
    sellSection.append(
      el(
        'button',
        {
          class: 'danger-btn',
          onclick: () => {
            pendingSellFor = duck.id;
            ctx.ui.refreshPanel();
          },
        },
        'Sell for ',
        icon('coin', 12),
        ` ${price}`,
      ),
    );
  }
  sellTab.append(sellSection);

  // The tabs. Sell lights up when a commission or a buyer wants this duck.
  const tab = cardTabs.get(duck.id) ?? 'care';
  const fitsAny = game.state.commissions.some((c) => duckFits(duck, c)) || (game.state.request !== null && matchesRequest(duck, game.state.request));
  const drillBadge = duck.stage !== 'duckling' ? drillsLeft(game.state, duck) : 0;
  const tabs: Array<[CardTab, IconName, string, string | null]> = [
    ['care', 'hand', 'Care', drillBadge > 0 ? String(drillBadge) : null],
    ['genes', 'book', 'Genes', null],
    ['line', 'star', 'Line', null],
    ['sell', 'coin', 'Sell', fitsAny ? '!' : null],
  ];
  const bar_ = el('div', { class: 'shop-tabs card-tabs' });
  for (const [id, ic, label, badge] of tabs) {
    bar_.append(
      el(
        'button',
        {
          class: `shop-tab${tab === id ? ' active' : ''}`,
          'aria-pressed': String(tab === id),
          onclick: () => {
            cardTabs.set(duck.id, id);
            ctx.ui.refreshPanel();
          },
        },
        icon(ic, 12),
        label,
        badge ? el('span', { class: 'shop-tab-badge' }, badge) : null,
      ),
    );
  }
  panel.append(bar_, tab === 'care' ? careTab : tab === 'genes' ? genesTab : tab === 'line' ? lineTab : sellTab);
  return panel;
}

// Which tab each card is showing; keyed by duck so pinned cards keep theirs.
type CardTab = 'care' | 'genes' | 'line' | 'sell';
const cardTabs = new Map<string, CardTab>();

let pendingSellFor: string | null = null;
let pendingCommissionFor: string | null = null;
let pendingBuyerSellFor: string | null = null;

function buildNameEditor(ctx: PanelCtx, duckId: string, name: string): HTMLElement {
  const input = el('input', {
    class: 'name-input',
    value: name,
    onchange: (e) => {
      const duck = ctx.game.state.ducks.find((d) => d.id === duckId);
      const value = (e.target as HTMLInputElement).value.trim();
      if (duck && value) duck.name = value.slice(0, 24);
    },
    onkeydown: (e) => {
      if ((e as KeyboardEvent).key === 'Enter') (e.target as HTMLInputElement).blur();
    },
  });
  return input;
}

function bar(pct: number, color: string): HTMLElement {
  const fill = el('div', { class: 'bar-fill' });
  fill.style.width = `${pct}%`;
  fill.style.background = color;
  return el('div', { class: 'bar' }, fill);
}

function actionBtn(
  ctx: PanelCtx,
  iconName: IconName,
  label: string,
  enabled: boolean,
  action: () => boolean,
  reason = '',
): HTMLElement {
  return el(
    'button',
    {
      class: 'action-btn',
      disabled: !enabled,
      title: reason,
      onclick: () => {
        const ok = action();
        // Rebuild right away so bars and button states reflect the action
        // instantly rather than on the next 500ms refresh tick.
        ctx.ui.refreshPanel();
        if (!ok && reason) ctx.ui.toast(reason);
      },
    },
    icon(iconName, 13),
    label,
  );
}
