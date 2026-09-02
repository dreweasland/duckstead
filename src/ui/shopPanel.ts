// The shop: four tabs of uniform cards. Every card is the same shape — icon,
// name, stat chips, a short blurb, and a price button pinned to the bottom —
// so the eye can scan prices and effects without reading paragraphs.
import type { PanelCtx } from './ui';
import { el, panelHeader } from './dom';
import { icon, type IconName } from './icons';
import { decorPortrait } from './portrait';
import {
  BALANCE,
  sponsorCost,
  sponsorFestival,
  buyUpgrade,
  consumableCost,
  DECOR_ITEMS,
  henEggPrice,
  pondHasRoom,
  sellEggBasket,
  SHOP_ITEMS,
  UPGRADES,
  upgradeLevel,
  type ShopItemDef,
  type UpgradeId,
} from '../sim/economy';
import { createStarterDuck, DUCK_NAMES, freshName } from '../sim/duck';
import { recordBreed } from '../sim/breedBook';
import { dayOf } from '../sim/time';
import { flock,  WORLD_W } from '../state';
import { events } from '../events';
import { FOODS, type FoodKind } from '../sim/food';
import type { GameState } from '../state';
import { duckPortrait } from './portrait';
import { bestPairFor, commissionGap, commissionSpecimen, commissionsUnlocked, duckFits, type Commission } from '../sim/commissions';
import { breedKey, breedLabel, recordBreed as recordBreedEntry } from '../sim/breedBook';
import { advanceRank, canAdvance, hasPerk, nextRank, RANKS, rewardLabel, STYLES, type StyleSlot } from '../sim/society';
import { createDuck } from '../sim/duck';
import { randomCommonGenome, type Genome } from '../sim/genetics';
import { FESTIVAL_NAMES, festivalTier, festivalToday, upcomingFestival } from '../sim/festivals';
import { buyRivalEgg, hireStud, rivalDef, rivalDuck, rivalEggsForSale, rivalStrength, studOffers } from '../sim/rivals';
import { eggsIncubating } from '../sim/breeding';
import { nestCapacity } from '../sim/economy';
import { canEnterCup, cupOpen, cupPrize, cupStandings, enterCup } from '../sim/cup';
import { TUNING } from '../sim/tuning';
import { canBreedPair } from '../sim/needs';
import { buildGeneStrip, carriedTraits } from './geneticsCard';
import type { Duck } from '../sim/duck';
import { yearOf } from '../sim/time';

type Tab = 'supplies' | 'upgrades' | 'decor' | 'sell' | 'board' | 'society';
const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: 'supplies', label: 'Supplies', icon: 'wheat' },
  { id: 'upgrades', label: 'Upgrades', icon: 'star' },
  { id: 'decor', label: 'Decor', icon: 'sparkle' },
  { id: 'sell', label: 'Sell', icon: 'coin' },
  { id: 'board', label: 'Board', icon: 'flag' },
  { id: 'society', label: 'Society', icon: 'star' },
];
// Persists across the panel's periodic rebuilds.
let activeTab: Tab = 'supplies';

// Per-item presentation: icon, terse blurb, and stat chips.
const SUPPLY_META: Record<ShopItemDef['id'], { icon: IconName; blurb: string; chips: string[]; food?: FoodKind }> = {
  feed: { icon: 'wheat', blurb: 'Everyday pellets.', chips: ['+40 hunger'], food: 'feed' },
  premiumFeed: { icon: 'sparkle', blurb: 'Rich feed; also wins over wild ducks.', chips: ['+60 hunger', '+5 happy'], food: 'premiumFeed' },
  peas: { icon: 'heart', blurb: 'A treat some ducks love.', chips: ['+40 hunger', '+2 happy'], food: 'peas' },
  worms: { icon: 'heart', blurb: 'A treat some ducks love.', chips: ['+45 hunger', '+2 happy'], food: 'worms' },
  berries: { icon: 'heart', blurb: 'A treat some ducks love.', chips: ['+40 hunger', '+3 happy'], food: 'berries' },
  medicine: { icon: 'pill', blurb: 'Cures sickness on the spot.', chips: ['cures', '+30 health'] },
  starterDuck: { icon: 'duck', blurb: 'A random adult with common genes.', chips: ['adult', 'common genes'] },
};

const UPGRADE_META: Record<UpgradeId, { icon: IconName; blurb: string; chips: string[] }> = {
  feedingTrough: { icon: 'wheat', blurb: 'Ducks help themselves; pour feed in by clicking it.', chips: ['self-feeding'] },
  nestingBox: { icon: 'egg', blurb: 'More eggs at once, and they stay warmer.', chips: ['+2 egg slots', '−25% warmth loss'] },
  incubator: { icon: 'sparkle', blurb: 'Eggs hatch twice as fast at full warmth.', chips: ['2× hatch speed', '+15% viability'] },
  pondExpansion: { icon: 'bubbles', blurb: 'A bigger pond for a bigger flock.', chips: ['+4 ducks'] },
  pondFilter: { icon: 'broom', blurb: 'A planted gravel bed that keeps the water clean.', chips: ['½ dirt rate'] },
  waterfall: { icon: 'bubbles', blurb: 'Aerates the pond; swimmers love it.', chips: ['−30% dirt', '+happy swims'] },
  duckToy: { icon: 'smile', blurb: 'Something to chase around the water.', chips: ['−25% mood decay'] },
  pedigreeScope: { icon: 'book', blurb: 'Read every duck’s exact genotype.', chips: ['reveals alleles'] },
  reedBeds: { icon: 'sparkle', blurb: 'Richer ground: more bugs, feathers, weed, and eggs about.', chips: ['+1 each pickup', '+2 loose eggs'] },
  feedSilo: { icon: 'wheat', blurb: 'A bigger trough that refills itself at dawn.', chips: ['+20 capacity', 'auto-pour'] },
  eggCooler: { icon: 'egg', blurb: 'Basket eggs keep — and fetch more.', chips: ['+25% egg price'] },
  brooderLamp: { icon: 'sparkle', blurb: 'Warm light for the young.', chips: ['+20% growth', 'happier hatch'] },
  trainingPerch: { icon: 'flag', blurb: 'Room for more drills: every duck trains once more a day per level.', chips: ['+1 drill/day'] },
  vetClinic: { icon: 'pill', blurb: 'A resident vet keeps the flock on its feet.', chips: ['½ sickness', '2× medicine'] },
  bachelorPen: { icon: 'duck', blurb: 'Surplus drakes sit out of breeding — no pressure on the hens, no selling.', chips: ['+3 places', 'no drake pressure'] },
};

export function renderShopPanel(ctx: PanelCtx): HTMLElement {
  const { game } = ctx;
  const state = game.state;
  const panel = el('aside', { class: 'panel wide shop' });
  panel.append(
    panelHeader('cart', 'Shop', ctx.close, el('span', { class: 'shop-coins with-icon' }, icon('coin', 12), ` ${state.money}`)),
  );

  // Tabs.
  const tabs = el('div', { class: 'shop-tabs' });
  for (const t of TABS) {
    const badge = tabBadge(state, t.id);
    tabs.append(
      el(
        'button',
        {
          class: `shop-tab${activeTab === t.id ? ' active' : ''}`,
          onclick: () => {
            activeTab = t.id;
            ctx.ui.refreshPanel();
          },
        },
        icon(t.icon, 12),
        t.label,
        badge ? el('span', { class: 'shop-tab-badge' }, badge) : null,
      ),
    );
  }
  panel.append(tabs);

  switch (activeTab) {
    case 'supplies':
      panel.append(suppliesTab(ctx));
      break;
    case 'upgrades':
      panel.append(upgradesTab(ctx));
      break;
    case 'decor':
      panel.append(decorTab(ctx));
      break;
    case 'sell':
      panel.append(sellTab(ctx));
      break;
    case 'board':
      panel.append(boardTab(ctx));
      break;
    case 'society':
      panel.append(societyTab(ctx));
      break;
  }
  return panel;
}

function tabBadge(state: GameState, tab: Tab): string | null {
  if (tab === 'sell' && state.inventory.eggs > 0) return String(state.inventory.eggs);
  if (tab === 'board' && commissionsUnlocked(state)) {
    // Open commissions plus the rivals' eggs still in the basket today.
    const n = state.commissions.length + rivalEggsForSale(state).filter((s) => !s.soldToday).length;
    if (n > 0) return String(n);
  }
  if (tab === 'society' && canAdvance(state).ok) return '↑';
  if (tab === 'decor' && state.decorations.length > 0) return String(state.decorations.length);
  if (tab === 'upgrades') {
    const owned = Object.values(state.upgrades).reduce((a, b) => a + (b ?? 0), 0);
    return owned > 0 ? String(owned) : null;
  }
  return null;
}

// ---------------------------------------------------------------------------

interface CardOpts {
  badge: Element; // icon or portrait
  name: string;
  sub?: string; // small line under the name (stock, level, owned)
  chips: string[];
  blurb: string;
  button: HTMLElement;
  note?: string; // warning under the button
}

function card(o: CardOpts): HTMLElement {
  const chips = el('div', { class: 'shop-chips' });
  for (const c of o.chips) chips.append(el('span', { class: 'shop-chip' }, c));
  return el(
    'div',
    { class: 'shop-card' },
    el(
      'div',
      { class: 'shop-card-head' },
      el('span', { class: 'shop-badge' }, o.badge),
      el('div', { class: 'shop-card-title' }, el('strong', {}, o.name), o.sub ? el('span', { class: 'shop-sub' }, o.sub) : null),
    ),
    chips,
    el('div', { class: 'shop-blurb', title: o.blurb }, o.blurb),
    el('div', { class: 'shop-card-foot' }, o.button, o.note ? el('span', { class: 'shop-note' }, o.note) : null),
  );
}

function priceButton(label: string, cost: number, enabled: boolean, onclick: () => void, extra = ''): HTMLElement {
  return el(
    'button',
    { class: `action-btn shop-buy${extra}`, disabled: !enabled, onclick },
    label,
    ' ',
    icon('coin', 11),
    `${cost}`,
  );
}

function suppliesTab(ctx: PanelCtx): HTMLElement {
  const state = ctx.game.state;
  const grid = el('div', { class: 'shop-grid' });
  for (const item of SHOP_ITEMS) {
    const meta = SUPPLY_META[item.id];
    const cost = consumableCost(state, item);
    const sale = cost < item.cost;
    const stock = meta.food ? state.inventory[meta.food] : item.id === 'medicine' ? state.inventory.medicine : null;
    const badge = meta.food && FOODS[meta.food].treat ? treatBadge(meta.food) : icon(meta.icon, 18);
    const full = item.id === 'starterDuck' && !pondHasRoom(state);
    grid.append(
      card({
        badge,
        name: item.name.replace(' ×10', ''),
        sub: stock !== null ? `have ${stock}` : item.id === 'starterDuck' ? `${flock(state).length} on the pond` : undefined,
        chips: [...meta.chips, ...(item.id !== 'medicine' && item.id !== 'starterDuck' ? ['×10'] : [])],
        blurb: meta.blurb,
        button: priceButton('Buy', cost, state.money >= cost && !full, () => {
          buyItem(ctx, item.id, cost);
          ctx.ui.refreshPanel();
        }, sale ? ' sale' : ''),
        note: full ? 'Pond is full' : sale ? 'Market Day price' : undefined,
      }),
    );
  }
  return grid;
}

function treatBadge(kind: FoodKind): HTMLElement {
  const dot = el('span', { class: 'shop-treat-dot' });
  dot.style.background = FOODS[kind].color;
  return dot;
}

function upgradesTab(ctx: PanelCtx): HTMLElement {
  const state = ctx.game.state;
  const grid = el('div', { class: 'shop-grid' });
  // Festival sponsorship: coins buy a tier on the next festival for one year.
  const next = upcomingFestival(state.clock);
  const today = festivalToday(state.clock);
  const kind = today ?? next.kind;
  const cost = sponsorCost(state, kind);
  const already = Boolean(state.sponsored[kind]);
  const maxed = festivalTier(state, kind) >= 3;
  grid.append(
    card({
      badge: icon('flag', 18),
      name: `Sponsor the ${FESTIVAL_NAMES[kind]}`,
      sub: today ? 'today' : `in ${next.inDays} day${next.inDays === 1 ? '' : 's'}`,
      chips: ['+1 tier this year', '+75% purse', 'tougher field'],
      blurb: already ? 'Sponsored — this year’s edition is raised a tier.' : 'Put your name on the next festival: a bigger event, bigger prizes, more Society points.',
      button: already
        ? el('button', { class: 'action-btn shop-buy owned', disabled: true }, 'Sponsored')
        : priceButton('Sponsor', cost, state.money >= cost && !maxed, () => { sponsorFestival(state, kind); ctx.ui.refreshPanel(); }),
      note: maxed ? 'Already at the top tier' : undefined,
    }),
  );
  for (const def of UPGRADES) {
    const meta = UPGRADE_META[def.id];
    const level = upgradeLevel(state, def.id);
    const maxed = level >= def.maxLevel;
    const cost = maxed ? 0 : def.costs[level];
    const pips =
      def.maxLevel > 1
        ? Array.from({ length: def.maxLevel }, (_, i) => (i < level ? '●' : '○')).join(' ')
        : level > 0 ? 'owned' : undefined;
    grid.append(
      card({
        badge: icon(meta.icon, 18),
        name: def.name,
        sub: pips,
        chips: meta.chips,
        blurb: meta.blurb,
        button: maxed
          ? el('button', { class: 'action-btn shop-buy owned', disabled: true }, def.maxLevel > 1 ? 'Maxed' : 'Owned')
          : priceButton(level > 0 ? `Level ${level + 1}` : 'Buy', cost, state.money >= cost, () => {
              buyUpgrade(state, def.id);
              ctx.ui.refreshPanel();
            }),
      }),
    );
  }
  return grid;
}

function decorTab(ctx: PanelCtx): HTMLElement {
  const state = ctx.game.state;
  const grid = el('div', { class: 'shop-grid' });
  for (const def of DECOR_ITEMS) {
    if (def.kind === 'statue' && !hasPerk(state, 'statue')) continue;
    const owned = state.decorations.filter((d) => d.kind === def.kind).length;
    grid.append(
      card({
        badge: decorPortrait(def.kind, 40),
        name: def.name,
        sub: owned > 0 ? `placed ×${owned}` : undefined,
        chips: ['+charm', 'cheers flock'],
        blurb: def.description,
        button: priceButton('Buy & place', def.cost, state.money >= def.cost, () => {
          ctx.ui.startPlacingDecor(def);
          ctx.close();
        }),
      }),
    );
  }
  return el(
    'div',
    {},
    el('div', { class: 'muted small shop-tab-hint' }, 'Up to 3 decorations cheer the flock; up to 5 help lure wild ducks. Click a placed one to move it.'),
    grid,
  );
}

function sellTab(ctx: PanelCtx): HTMLElement {
  const state = ctx.game.state;
  const basket = state.inventory.eggs;
  const each = henEggPrice(state);
  const bonus = each > BALANCE.henEggPrice;
  const grid = el('div', { class: 'shop-grid' });
  grid.append(
    card({
      badge: icon('egg', 18),
      name: 'Egg basket',
      sub: `${basket} gathered`,
      chips: [`${each} each`, ...(bonus ? ['bonus price'] : [])],
      blurb: 'Hens lay one a day when fed and content; tap eggs on the grass to gather them.',
      button: el(
        'button',
        {
          class: 'action-btn shop-buy',
          disabled: basket <= 0,
          onclick: () => {
            sellEggBasket(state);
            ctx.ui.refreshPanel();
          },
        },
        'Sell all ',
        icon('coin', 11),
        `${basket * each}`,
      ),
    }),
  );
  return el(
    'div',
    {},
    el('div', { class: 'muted small shop-tab-hint' }, 'Ducks and nest eggs are sold from their own cards. Autumn and Market Day raise prices.'),
    grid,
  );
}

// When nobody fits, point at the pair most likely to hatch the breed.
function hintFor(state: GameState, c: Commission): string {
  // A duck of the right breed that just misses: say what it lacks.
  const nearMiss = state.ducks
    .map((d) => ({ d, gap: commissionGap(d, c) }))
    .filter((x) => x.gap && x.gap.length > 0)
    .sort((a, b) => a.gap!.length - b.gap!.length)[0];
  if (nearMiss) return `${nearMiss.d.name} is the breed but ${nearMiss.gap!.join('; ')}.`;
  const pair = bestPairFor(state, c.key);
  if (!pair) return `Nobody on the pond fits, and no pairing can hatch a ${breedLabel(c.key)} yet — look for the genes at the shop or among wild visitors.`;
  const extra = [c.minGen ? `gen ${c.minGen}+` : '', c.minStandard ? `${c.minStandard}% standard` : '', c.pinkBill ? 'a pink bill' : ''].filter(Boolean);
  return `Nobody fits yet. ${pair.dam.name} × ${pair.sire.name} could hatch one (${Math.round(pair.chance * 100)}% per egg)${extra.length ? `; it must also reach ${extra.join(', ')}` : ''}.`;
}

// The Board: three markets, one at a time. Commissions are what the tab was
// named for; the rivals' egg baskets and stud service arrived later and
// stacked underneath into one long scroll. A row of pills up top picks the
// market, and every rival card is the same shape — portraits, a line about
// the breeder, a handful of trait chips, the price button pinned to the
// bottom — with the full gene readout folded away behind "Read the genes".
type BoardSection = 'commissions' | 'eggs' | 'stud';
let boardSection: BoardSection = 'commissions';

function boardTab(ctx: PanelCtx): HTMLElement {
  const state = ctx.game.state;
  const box = el('div', {});
  if (!commissionsUnlocked(state)) {
    box.append(el('div', { class: 'muted small shop-tab-hint' }, 'Breeders post commissions here once your pond has hatched a few ducklings.'));
    return box;
  }
  const ready = state.commissions.filter((c) => state.ducks.some((d) => duckFits(d, c))).length;
  const eggsLeft = rivalEggsForSale(state).filter((s) => !s.soldToday).length;
  const sections: Array<{ id: BoardSection; label: string; icon: IconName; count: number; hot: boolean }> = [
    { id: 'commissions', label: 'Commissions', icon: 'flag', count: state.commissions.length, hot: ready > 0 },
    { id: 'eggs', label: 'Eggs for sale', icon: 'egg', count: eggsLeft, hot: false },
    { id: 'stud', label: 'Stud service', icon: 'duck', count: studOffers(state).length, hot: false },
  ];
  const pills = el('div', { class: 'board-pills' });
  for (const s of sections) {
    pills.append(
      el(
        'button',
        {
          class: `board-pill${boardSection === s.id ? ' active' : ''}`,
          onclick: () => {
            boardSection = s.id;
            ctx.ui.refreshPanel();
          },
        },
        icon(s.icon, 12),
        s.label,
        s.count > 0 ? el('span', { class: `shop-tab-badge${s.hot ? ' full' : ''}` }, String(s.count)) : null,
      ),
    );
  }
  box.append(pills);
  if (boardSection === 'commissions') box.append(commissionsSection(ctx));
  else if (boardSection === 'eggs') box.append(eggSaleSection(ctx));
  else box.append(studSection(ctx));
  return box;
}

function commissionsSection(ctx: PanelCtx): HTMLElement {
  const state = ctx.game.state;
  const today = dayOf(state.clock);
  const box = el('div', {});
  box.append(
    el(
      'div',
      { class: 'muted small shop-tab-hint' },
      `Breeders pay well for specific ducks. ${state.commissionsDone} filled · demands grow with your reputation. Deliver from a duck's card.`,
    ),
  );
  if (state.commissions.length === 0) {
    box.append(el('div', { class: 'muted small roster-empty' }, 'No open commissions — a new one is posted each morning.'));
  }
  const grid = el('div', { class: 'shop-grid' });
  for (const c of state.commissions) {
    const fits = state.ducks.filter((d) => duckFits(d, c)).length;
    const chips = [breedLabel(c.key)];
    if (c.sex) chips.push(c.sex === 'F' ? 'hen' : 'drake');
    if (c.minGen) chips.push(`gen ${c.minGen}+`);
    if (c.minStandard) chips.push(`${c.minStandard}% standard`);
    if (c.pinkBill) chips.push('pink bill');
    const left = c.expiresDay - today;
    grid.append(
      card({
        badge: duckPortrait(commissionSpecimen(c), 40),
        name: c.client,
        sub: `${left} day${left === 1 ? '' : 's'} left · +${c.points} Society`,
        chips,
        blurb: fits > 0 ? `${fits} duck${fits === 1 ? '' : 's'} on the pond would do — open its card to deliver.` : hintFor(state, c),
        button: el('button', { class: `action-btn shop-buy${fits > 0 ? ' primary' : ''}`, disabled: true }, 'Pays ', icon('coin', 11), `${c.reward}`),
        note: fits > 0 ? 'Ready to deliver' : undefined,
      }),
    );
  }
  box.append(grid);
  return box;
}

// What stands out about a rival's bird, in a few chips: its breed, anything
// rare or extreme, and — with the Scope — what it carries unseen.
function traitChips(state: GameState, duck: Duck): HTMLElement[] {
  const p = duck.phenotype;
  const chips: Array<{ text: string; cls?: string }> = [{ text: breedLabel(breedKey(duck.genome)) }];
  if (p.rarityScore >= 4) chips.push({ text: 'rare', cls: 'chip-rare' });
  if (p.sizeScale >= 1.15) chips.push({ text: 'grand' });
  else if (p.sizeScale <= 0.9) chips.push({ text: 'petite' });
  if (p.vigor >= 0.75) chips.push({ text: 'hardy' });
  if (p.boldness >= 0.7) chips.push({ text: 'bold' });
  else if (p.boldness <= 0.3) chips.push({ text: 'timid' });
  if (upgradeLevel(state, 'pedigreeScope') > 0) {
    for (const name of carriedTraits(duck)) chips.push({ text: `carries ${name}`, cls: 'chip-carrier' });
  }
  return chips.map((c) => el('span', { class: `shop-chip${c.cls ? ` ${c.cls}` : ''}` }, c.text));
}

// Which cards have their gene readout open; survives rebuilds.
const openGenes = new Set<string>();

// The shared shape for a rival's offer: head, traits, a folded gene readout,
// the price pinned to the bottom.
function marketCard(key: string, head: HTMLElement, traits: HTMLElement, genes: HTMLElement, foot: HTMLElement[], wide = false): HTMLElement {
  const open = openGenes.has(key);
  genes.classList.add('market-genes');
  genes.hidden = !open;
  const toggle = el('button', { class: 'genes-toggle' }, open ? 'Hide the genes' : 'Read the genes');
  const card = el('div', { class: `market-card${wide ? ' wide' : ''}${open ? ' open' : ''}` }, head, traits, toggle, genes, el('div', { class: 'shop-card-foot' }, ...foot));
  toggle.onclick = () => {
    const now = genes.hidden;
    genes.hidden = !now;
    card.classList.toggle('open', now);
    toggle.textContent = now ? 'Hide the genes' : 'Read the genes';
    if (now) openGenes.add(key);
    else openGenes.delete(key);
  };
  return card;
}

function marketHead(portraits: Element[], title: string, rivalId: string, rivalName: string): HTMLElement {
  return el(
    'div',
    { class: 'market-head' },
    el('span', { class: 'market-portraits' }, ...portraits),
    el('div', { class: 'market-title' }, el('strong', {}, title), el('div', { class: 'muted small' }, `${rivalName} · ${rivalDef(rivalId).blurb}`)),
  );
}

// The rivals' egg baskets: one egg a day per rival, from a pairing of their
// own birds — the parents on show, the shell a surprise, the line gen 0.
function eggSaleSection(ctx: PanelCtx): HTMLElement {
  const state = ctx.game.state;
  const box = el('div', {});
  const nestFull = eggsIncubating(state) + state.pendingClutches.length >= nestCapacity(state);
  box.append(
    el(
      'div',
      { class: 'muted small shop-tab-hint' },
      `Each rival pond parts with one egg a day from its own pairing. The parents are on show; the shell is the same gamble their buyers take from you. A bought egg starts a gen-0 line.${nestFull ? ' Your nest is full.' : ''}`,
    ),
  );
  const grid = el('div', { class: 'shop-grid market-grid' });
  for (const sale of rivalEggsForSale(state)) {
    const traits = el(
      'div',
      { class: 'market-traits' },
      el('div', { class: 'market-row' }, el('span', { class: 'market-row-label' }, 'dam'), ...traitChips(state, sale.dam)),
      el('div', { class: 'market-row' }, el('span', { class: 'market-row-label' }, 'sire'), ...traitChips(state, sale.sire)),
    );
    const genes = el(
      'div',
      { class: 'market-parents' },
      el('div', {}, el('div', { class: 'muted small' }, `${sale.dam.name} (dam)`), buildGeneStrip(state, sale.dam)),
      el('div', {}, el('div', { class: 'muted small' }, `${sale.sire.name} (sire)`), buildGeneStrip(state, sale.sire)),
    );
    const button = sale.soldToday
      ? el('button', { class: 'action-btn shop-buy owned', disabled: true }, 'Sold for today')
      : el(
          'button',
          {
            class: 'action-btn primary shop-buy',
            disabled: nestFull || state.money < sale.price,
            title: nestFull ? 'The nest is full' : state.money < sale.price ? `Need ${sale.price} coins` : 'One egg from this pairing, laid straight into your nest',
            onclick: () => {
              const res = buyRivalEgg(state, ctx.game.rng, sale.rivalId);
              if (!res.ok && res.reason) ctx.ui.toast(res.reason);
              ctx.ui.refreshPanel();
            },
          },
          'Buy the egg for ',
          icon('coin', 11),
          ` ${sale.price}`,
        );
    grid.append(
      marketCard(
        `egg:${sale.rivalId}`,
        marketHead([duckPortrait(sale.dam, 44), duckPortrait(sale.sire, 44)], `${sale.dam.name} × ${sale.sire.name}`, sale.rivalId, sale.rivalName),
        traits,
        genes,
        [button],
        true,
      ),
    );
  }
  box.append(grid);
  return box;
}

// Which hen the stud service courts; one choice for every offer.
let studHenId: string | null = null;

// Stud service: hire a rival pond's best drake for one clutch with a hen of
// yours. His genes are on show (the Scope reads them), the courtship runs
// like any other, and the egg's lineage remembers him.
function studSection(ctx: PanelCtx): HTMLElement {
  const state = ctx.game.state;
  const box = el('div', {});
  box.append(el('div', { class: 'muted small shop-tab-hint' }, 'The rival ponds will lend a drake for one clutch — a way in to genes your flock lacks. The hen courts as usual; the egg is yours.'));
  const hens = state.ducks.filter((d) => d.sex === 'F' && d.stage === 'adult' && !d.penned);
  const hen = hens.find((h) => h.id === studHenId) ?? hens[0];
  const picker = el('select', {
    class: 'stud-hen-pick',
    onchange: (e) => {
      studHenId = (e.target as HTMLSelectElement).value;
      ctx.ui.refreshPanel();
    },
  });
  for (const h of hens) {
    const opt = el('option', { value: h.id }, h.name) as HTMLOptionElement;
    if (h.id === hen?.id) opt.selected = true;
    picker.append(opt);
  }
  box.append(
    el(
      'label',
      { class: 'stud-hen-bar' },
      icon('heart', 12),
      el('span', {}, 'Hen to court:'),
      hens.length > 0 ? picker : el('span', { class: 'muted small' }, 'no adult hen is free to court'),
    ),
  );
  const grid = el('div', { class: 'shop-grid market-grid' });
  for (const offer of studOffers(state)) {
    const rival = state.rivals.find((r) => r.id === offer.rivalId)!;
    const gate = hen ? canBreedPair(hen, offer.drake) : { ok: false, reason: 'No adult hen free to court' };
    const button = el(
      'button',
      {
        class: 'action-btn primary shop-buy',
        disabled: !gate.ok || state.money < offer.cost || !hen,
        title: !hen ? 'No adult hen free to court' : gate.ok ? `${hen.name} courts ${offer.drake.name}; the egg is yours` : gate.reason ?? '',
        onclick: () => {
          if (!hen) return;
          const res = hireStud(state, offer.rivalId, hen.id);
          if (!res.ok && res.reason) ctx.ui.toast(res.reason);
          ctx.ui.refreshPanel();
        },
      },
      hen ? `Hire for ${hen.name} · ` : 'Hire for ',
      icon('coin', 11),
      ` ${offer.cost}`,
    );
    grid.append(
      marketCard(
        `stud:${offer.rivalId}`,
        marketHead([duckPortrait(offer.drake, 56)], offer.drake.name, rival.id, rival.name),
        el('div', { class: 'market-traits' }, el('div', { class: 'market-row' }, ...traitChips(state, offer.drake))),
        buildGeneStrip(state, offer.drake),
        [button, !gate.ok && hen ? el('span', { class: 'shop-note warn-text' }, gate.reason ?? '') : el('span')],
      ),
    );
  }
  box.append(grid);
  return box;
}

// The rival ponds and the Society Cup.
function rivalsSection(ctx: PanelCtx): HTMLElement {
  const state = ctx.game.state;
  const box = el('div', {}, el('div', { class: 'br-section-title' }, 'The rival ponds'));
  box.append(el('div', { class: 'muted small shop-tab-hint' }, 'Three ponds breed alongside yours, a generation a season, and turn up at every show, race, and the Board. They get better every year.'));
  const grid = el('div', { class: 'shop-grid rivals-grid' });
  for (const rival of state.rivals) {
    const def = rivalDef(rival.id);
    const strength = rivalStrength(state, rival);
    const portraits = el('div', { class: 'rival-flock' });
    rival.flock.slice(0, 6).forEach((g, i) => portraits.append(duckPortrait(rivalDuck(rival, i, g), 34)));
    grid.append(
      el(
        'div',
        { class: 'rival-card' },
        el('div', {}, el('strong', {}, rival.name), el('div', { class: 'muted small' }, def.blurb)),
        portraits,
        el(
          'div',
          { class: 'gene-badges' },
          el('span', { class: 'chip chip-trait', title: 'How formidable they are this year' }, `strength ${Math.round(strength * 100)}%`),
          el('span', { class: 'chip chip-trait', title: 'Their drilled stats' }, `training ${Math.round(rival.training)}`),
          el('span', { class: 'chip chip-trait' }, `${rival.wins} win${rival.wins === 1 ? '' : 's'}`),
          el('span', { class: 'chip chip-trait', title: 'Their Society Cup tally this year' }, `${rival.yearPoints} pts this year`),
        ),
      ),
    );
  }
  box.append(grid);

  // The Cup.
  box.append(el('div', { class: 'br-section-title' }, `Society Cup — year ${yearOf(state.clock)}`));
  const gate = canEnterCup(state);
  if (cupOpen(state)) {
    const rows = el('div', { class: 'race-results' });
    cupStandings(state).forEach((s, i) => {
      rows.append(
        el(
          'div',
          { class: `race-result-row${s.isPlayer ? ' mine' : ''}` },
          el('span', { class: `race-place p${i + 1}` }, String(i + 1)),
          el('span', { class: 'race-result-name' }, s.name),
          el('span', { class: 'muted small' }, `${s.score} pts`),
        ),
      );
    });
    box.append(
      el('div', { class: 'muted small shop-tab-hint' }, `Entered. Every Society point you earn until the last night of winter counts; the winner takes ${cupPrize(state)} coins.`),
      rows,
    );
  } else {
    box.append(
      el('div', { class: 'muted small shop-tab-hint' }, `Stake ${TUNING.cup.entryPoints} Society points to enter the year's Cup against the rival ponds — the points you earn from then to the last night of winter decide it. The winner takes ${cupPrize(state)} coins; open from Society rank ${TUNING.cup.minRank}.`),
      el(
        'button',
        { class: 'action-btn primary shop-buy', disabled: !gate.ok, title: gate.reason ?? '', onclick: () => { enterCup(state); ctx.ui.refreshPanel(); } },
        gate.ok ? `Enter the Cup (${TUNING.cup.entryPoints} points)` : gate.reason ?? '',
      ),
    );
  }
  return box;
}

function societyTab(ctx: PanelCtx): HTMLElement {
  const state = ctx.game.state;
  const soc = state.society;
  const next = nextRank(state);
  const box = el('div', {});
  const current = RANKS[soc.rank - 1];
  box.append(
    el(
      'div',
      { class: 'society-head' },
      el('div', { class: 'society-rank' }, icon('star', 16), ` ${current ? current.name : 'Not yet a member'}`, el('span', { class: 'muted small' }, current ? ` · rank ${soc.rank}/${RANKS.length}` : '')),
      el('div', { class: 'muted small' }, `${soc.points} Society points (${soc.lifetimePoints} earned all time). Points come from breed awards, commissions, and festival placings — never from coins.`),
    ),
  );
  if (next) {
    const gate = canAdvance(state);
    const coinPct = Math.min(100, (state.money / next.cost) * 100);
    const ptPct = Math.min(100, (soc.points / next.points) * 100);
    const bar = (pct: number, ok: boolean) => { const f = el('div', { class: `br-gauge-fill ${ok ? 'ok' : 'mid'}` }); f.style.width = `${pct}%`; return el('div', { class: 'br-gauge' }, f); };
    box.append(
      el(
        'div',
        { class: 'society-next' },
        el('div', { class: 'br-section-title' }, `Next: ${next.name} (rank ${next.rank})`),
        el('div', { class: 'society-reward with-icon' }, icon('sparkle', 12), ` ${rewardLabel(next)}`),
        el('div', { class: 'br-gauge-row' }, el('span', { class: 'br-gauge-label' }, 'Coins'), bar(coinPct, state.money >= next.cost), el('span', { class: 'small' }, `${Math.min(state.money, next.cost)}/${next.cost}`)),
        el('div', { class: 'br-gauge-row' }, el('span', { class: 'br-gauge-label' }, 'Points'), bar(ptPct, soc.points >= next.points), el('span', { class: 'small' }, `${Math.min(soc.points, next.points)}/${next.points}`)),
        el(
          'button',
          { class: 'action-btn primary shop-buy', disabled: !gate.ok, title: gate.reason ?? '', onclick: () => { advanceRank(state); ctx.ui.refreshPanel(); } },
          gate.ok ? `Advance to ${next.name}` : gate.reason ?? '',
        ),
      ),
    );
  } else {
    box.append(el('div', { class: 'ok-text' }, 'Golden Egg — the Society has no higher honour.'));
  }

  // Styles: pick which unlocked look is active per slot.
  if (soc.unlockedStyles.length > 0) {
    box.append(el('div', { class: 'br-section-title' }, 'Pond styles'));
    const row = el('div', { class: 'society-styles' });
    const slots: StyleSlot[] = ['water', 'lily', 'grass', 'hutch'];
    for (const slot of slots) {
      const options = soc.unlockedStyles.map((id) => STYLES[id]).filter((s) => s.slot === slot);
      if (options.length === 0) continue;
      const group = el('div', { class: 'society-style-group' }, el('span', { class: 'muted small' }, slot));
      const offBtn = el('button', { class: `roster-chip${!soc.style[slot] ? ' active' : ''}`, onclick: () => { delete soc.style[slot]; ctx.ui.refreshPanel(); } }, 'natural');
      group.append(offBtn);
      for (const o of options) {
        const dot = el('span', { class: 'treat-dot' });
        dot.style.background = o.colors[o.colors.length - 1];
        group.append(el('button', { class: `roster-chip${soc.style[slot] === o.id ? ' active' : ''}`, onclick: () => { soc.style[slot] = o.id; ctx.ui.refreshPanel(); } }, dot, o.name));
      }
      row.append(group);
    }
    box.append(row);
  }

  // Commissioned stock: order a duck carrying a rare gene you lack.
  if (hasPerk(state, 'commissionedStock')) {
    box.append(el('div', { class: 'br-section-title' }, 'Commissioned stock'));
    const grid = el('div', { class: 'shop-grid' });
    for (const order of STOCK_ORDERS) {
      const cost = stockCost(state);
      grid.append(
        card({
          badge: icon('duck', 18),
          name: order.name,
          sub: 'adult, common otherwise',
          chips: [order.chip, 'gen 0'],
          blurb: order.blurb,
          button: priceButton('Order', cost, state.money >= cost && pondHasRoom(state), () => { orderStock(ctx, order); ctx.ui.refreshPanel(); }),
          note: !pondHasRoom(state) ? 'Pond is full' : undefined,
        }),
      );
    }
    box.append(grid);
  }

  box.append(rivalsSection(ctx));

  // The ladder, for the curious.
  const ladder = el('div', { class: 'society-ladder' });
  for (const r of RANKS) {
    ladder.append(
      el('div', { class: `society-step${r.rank <= soc.rank ? ' done' : r.rank === soc.rank + 1 ? ' next' : ''}` }, el('span', { class: 'society-step-rank' }, String(r.rank)), el('span', { class: 'society-step-name' }, r.name), el('span', { class: 'muted small' }, rewardLabel(r)), el('span', { class: 'muted small society-step-cost' }, `${r.cost}c · ${r.points}p`)),
    );
  }
  box.append(el('div', { class: 'br-section-title' }, 'The ladder'), ladder);
  return box;
}

interface StockOrder { id: string; name: string; chip: string; blurb: string; apply(g: Genome): void }
const STOCK_ORDERS: StockOrder[] = [
  { id: 'blue', name: 'Blue carrier', chip: 'B B', blurb: 'A homozygous blue — breeds blue every time.', apply: (g) => { g.baseColor = ['B', 'B']; } },
  { id: 'pink', name: 'Pink-billed', chip: 'P P', blurb: 'Two copies of the pink bill gene.', apply: (g) => { g.billColor = ['P', 'P']; } },
  { id: 'crest', name: 'Crested', chip: 'R R', blurb: 'A true-breeding crest.', apply: (g) => { g.crest = ['R', 'R']; } },
  { id: 'hardy', name: 'Hardy stock', chip: '+ + + +', blurb: 'Maximum vigor — for racers and long lives.', apply: (g) => { g.vigor1 = ['+', '+']; g.vigor2 = ['+', '+']; } },
];

function stockCost(state: GameState): number {
  return 250 + state.society.rank * 25;
}

function orderStock(ctx: PanelCtx, order: StockOrder): void {
  const state = ctx.game.state;
  const cost = stockCost(state);
  if (state.money < cost || !pondHasRoom(state)) return;
  state.money -= cost;
  const genome = randomCommonGenome(ctx.game.rng);
  order.apply(genome);
  const duck = createDuck(ctx.game.rng, { genome, stage: 'adult', pos: { x: WORLD_W / 2, y: 270 } });
  duck.name = freshName(ctx.game.rng, state.ducks.map((d) => d.name), DUCK_NAMES);
  duck.bornDay = dayOf(state.clock);
  state.ducks.push(duck);
  recordBreedEntry(state, duck);
  ctx.ui.toast(`${duck.name} arrived from the Society's breeders.`);
  events.emit('purchase');
}

// ---------------------------------------------------------------------------

function buyItem(ctx: PanelCtx, id: string, cost: number): void {
  const state = ctx.game.state;
  if (state.money < cost) return;
  switch (id) {
    case 'feed':
      state.money -= cost;
      state.inventory.feed += 10;
      break;
    case 'premiumFeed':
      state.money -= cost;
      state.inventory.premiumFeed += 10;
      break;
    case 'peas':
    case 'worms':
    case 'berries':
      state.money -= cost;
      state.inventory[id] += 10;
      break;
    case 'medicine':
      state.money -= cost;
      state.inventory.medicine += 1;
      break;
    case 'starterDuck': {
      if (!pondHasRoom(state)) {
        ctx.ui.toast('The pond is at capacity — expand it first!');
        return;
      }
      state.money -= cost;
      const duck = createStarterDuck(ctx.game.rng, { x: WORLD_W / 2, y: 270 });
      duck.name = freshName(ctx.game.rng, state.ducks.map((d) => d.name), DUCK_NAMES);
      duck.bornDay = dayOf(state.clock);
      state.ducks.push(duck);
      recordBreed(state, duck);
      ctx.ui.toast(`${duck.name} joined the flock!`);
      break;
    }
  }
  events.emit('purchase');
}
