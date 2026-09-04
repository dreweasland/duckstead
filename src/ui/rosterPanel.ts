import type { PanelCtx } from './ui';
import { el, NEED_ROWS, needColor, statBar, panelHeader, tabBar } from './dom';
import { icon, sexBadge, starRow, type IconName } from './icons';
import { duckPortrait } from './portrait';
import { quickActions } from './quickActions';
import { byAge, byHunger, byName, byPedigree } from './duckSort';
import { duckCapacity, isOvercrowded, pondOccupancy } from '../sim/economy';
import { breedingValue, keepVerdict, verdictReason, type KeepVerdict } from '../sim/advisor';
import { incubationPct } from '../sim/lifecycle';
import type { Duck } from '../sim/duck';
import { breedReadiness } from '../sim/needs';
import { pedigreeScore } from '../sim/pedigree';
import { drillsLeft } from '../sim/training';
import { trainingChip } from './cardRail';
import type { GameState } from '../state';
import { generationOf } from '../sim/lineage';
import { describeBalance, flockBalance, HENS_PER_DRAKE } from '../sim/flockBalance';
import { buildGeneTable, clearPicks, isPicked, pickedCount } from './geneTable';
import { ageLabel } from '../sim/duck';

type View = 'cards' | 'genes';
let activeView: View = 'cards';
let pickedOnly = false;

type Filter = 'all' | 'drakes' | 'hens' | 'adults' | 'elders' | 'young' | 'eggs' | 'ready' | 'care' | 'train' | 'key' | 'penned';
type Sort = 'age' | 'name' | 'hunger' | 'happiness' | 'rarity' | 'pedigree' | 'value';

const FILTERS: Array<{ id: Filter; label: string; icon?: IconName }> = [
  { id: 'all', label: 'All' },
  { id: 'drakes', label: 'Drakes' },
  { id: 'hens', label: 'Hens' },
  { id: 'adults', label: 'Adults' },
  { id: 'elders', label: 'Elders' },
  { id: 'young', label: 'Young' },
  { id: 'eggs', label: 'Eggs', icon: 'egg' },
  { id: 'ready', label: 'Ready to breed', icon: 'heart' },
  { id: 'care', label: 'Needs care', icon: 'warning' },
  { id: 'train', label: 'To train', icon: 'flag' },
  { id: 'key', label: 'Key breeders', icon: 'star' },
  { id: 'penned', label: 'Penned', icon: 'cross' },
];

const SORTS: Array<{ id: Sort; label: string }> = [
  { id: 'age', label: 'Age' },
  { id: 'name', label: 'Name' },
  { id: 'hunger', label: 'Hungriest' },
  { id: 'happiness', label: 'Unhappiest' },
  { id: 'rarity', label: 'Rarest' },
  { id: 'pedigree', label: 'Pedigree' },
  { id: 'value', label: 'Breeding value' },
];

// Persist across the panel's periodic rebuilds.
let activeFilter: Filter = 'all';
let activeSort: Sort = 'age';

const VERDICT_RANK = { key: 0, useful: 1, covered: 2 } as const;

function needsCare(duck: Duck): boolean {
  return duck.sick || Math.min(duck.needs.hunger, duck.needs.cleanliness, duck.needs.happiness, duck.needs.health) < 25;
}

function matchesFilter(state: GameState, duck: Duck, filter: Filter, verdicts: ReadonlyMap<string, KeepVerdict>): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'drakes':
      return duck.stage !== 'egg' && duck.sex === 'M';
    case 'hens':
      return duck.stage !== 'egg' && duck.sex === 'F';
    case 'adults':
      return duck.stage === 'adult';
    case 'elders':
      return duck.stage === 'elder';
    case 'young':
      return duck.stage === 'duckling' || duck.stage === 'juvenile';
    case 'eggs':
      return duck.stage === 'egg';
    case 'ready':
      return duck.stage === 'adult' && breedReadiness(duck).ok;
    case 'care':
      return duck.stage !== 'egg' && needsCare(duck);
    case 'train':
      return duck.stage !== 'egg' && duck.stage !== 'duckling' && drillsLeft(state, duck) > 0;
    case 'key':
      return verdicts.get(duck.id) === 'key';
    case 'penned':
      return Boolean(duck.penned);
  }
}

function compare(sort: Sort, verdicts: ReadonlyMap<string, KeepVerdict>): (a: Duck, b: Duck) => number {
  switch (sort) {
    case 'name':
      return byName;
    case 'hunger':
      return byHunger;
    case 'happiness':
      return (a, b) => a.needs.happiness - b.needs.happiness;
    case 'rarity':
      return (a, b) => b.phenotype.rarityScore - a.phenotype.rarityScore;
    case 'pedigree':
      return byPedigree;
    case 'value':
      return (a, b) => {
        // Eggs are unknown quantities; elders have no breeding value at all
        // and sort to the bottom.
        const rank = (d: Duck): number =>
          d.stage === 'elder' ? 4 : d.stage === 'egg' ? 3 : VERDICT_RANK[verdicts.get(d.id) ?? 'covered'];
        return rank(a) - rank(b);
      };
    case 'age':
    default:
      return byAge;
  }
}

export function renderRosterPanel(ctx: PanelCtx): HTMLElement {
  const { game } = ctx;
  const state = game.state;
  const panel = el('aside', { class: `panel roster${activeView === 'genes' ? ' genes' : ''}` });
  panel.append(
    panelHeader(
      'list',
      'Flock',
      ctx.close,
      el(
        'span',
        { class: `br-nest-pill${isOvercrowded(state) ? ' full' : ''}`, title: 'Hatched ducks on the pond; eggs live in the nest and elders don\'t count against capacity' },
        icon('duck', 11),
        ` ${pondOccupancy(state)}/${duckCapacity(state)}${isOvercrowded(state) ? ' overcrowded' : ''}`,
      ),
    ),
  );
  const bal = flockBalance(state);
  panel.append(
    el(
      'div',
      { class: `flock-balance ${bal.status}` },
      icon(bal.status === 'balanced' ? 'heart' : 'warning', 11),
      ` ${describeBalance(bal)}`,
      el('span', { class: 'muted small' }, ` · ideal: 1 drake per ${HENS_PER_DRAKE} hens`),
    ),
  );

  // One advisor verdict per duck per refresh — the 'key' filter previously
  // recomputed it per duck per filter pass, every 500ms.
  const verdicts = new Map<string, KeepVerdict>();
  for (const d of state.ducks) {
    if (d.stage !== 'egg') verdicts.set(d.id, keepVerdict(breedingValue(state, d)));
  }
  // Filter chips (with live counts, tallied in one pass) and a sort picker.
  const counts = new Map<Filter, number>(FILTERS.map((f) => [f.id, 0]));
  for (const d of state.ducks) {
    for (const f of FILTERS) {
      if (matchesFilter(state, d, f.id, verdicts)) counts.set(f.id, counts.get(f.id)! + 1);
    }
  }
  const filters = el('div', { class: 'roster-filters' });
  for (const f of FILTERS) {
    const count = counts.get(f.id)!;
    if (f.id !== 'all' && count === 0 && activeFilter !== f.id) continue;
    filters.append(
      el(
        'button',
        {
          class: `roster-chip${activeFilter === f.id ? ' active' : ''}`,
          onclick: () => {
            activeFilter = f.id;
            ctx.ui.refreshPanel();
          },
        },
        f.icon ? icon(f.icon, 10) : null,
        f.label,
        el('span', { class: 'roster-chip-count' }, String(count)),
      ),
    );
  }
  const sortSelect = el('select', { class: 'roster-sort' }) as HTMLSelectElement;
  for (const s of SORTS) {
    const opt = el('option', { value: s.id }, s.label) as HTMLOptionElement;
    if (s.id === activeSort) opt.selected = true;
    sortSelect.append(opt);
  }
  sortSelect.addEventListener('change', () => {
    activeSort = sortSelect.value as Sort;
    sortSelect.blur(); // release the refresh guard now the choice is made
    ctx.ui.refreshPanel();
  });
  // Cards or the genes table; and a "picked only" chip once any are ticked.
  const nPicked = pickedCount(state);
  const viewToggle = tabBar<View>(
    [
      { id: 'cards', label: 'Cards', icon: 'cards' },
      { id: 'genes', label: 'Genes', icon: 'book', title: 'Every duck\'s genes side by side' },
    ],
    activeView,
    (id) => { activeView = id; ctx.ui.refreshPanel(); },
    'shop-tabs roster-view',
  );
  if (nPicked > 0) {
    filters.append(
      el(
        'button',
        { class: `roster-chip picked-chip${pickedOnly ? ' active' : ''}`, title: 'Only the ducks you ticked in the Genes view', onclick: () => { pickedOnly = !pickedOnly; ctx.ui.refreshPanel(); } },
        icon('cards', 10),
        'Picked only',
        el('span', { class: 'roster-chip-count' }, String(nPicked)),
      ),
      el('button', { class: 'roster-chip', title: 'Clear the picks', onclick: () => { clearPicks(); pickedOnly = false; ctx.ui.refreshPanel(); } }, 'Clear'),
    );
  }
  panel.append(
    el(
      'div',
      { class: 'roster-controls' },
      viewToggle,
      filters,
      activeView === 'cards' ? el('label', { class: 'roster-sort-wrap muted small' }, 'Sort ', sortSelect) : null,
    ),
  );

  const shown = state.ducks
    .filter((d) => matchesFilter(state, d, activeFilter, verdicts) && (!pickedOnly || isPicked(d.id)))
    .sort(compare(activeSort, verdicts));
  if (activeView === 'genes') {
    panel.append(buildGeneTable(ctx, shown));
    return panel;
  }
  const grid = el('div', { class: 'card-grid' });
  if (shown.length === 0) {
    grid.append(el('div', { class: 'muted small roster-empty' }, 'No ducks match this filter.'));
  }
  for (const duck of shown) {
    grid.append(duck.stage === 'egg' ? eggCard(ctx, duck) : duckCard(ctx, duck));
  }
  panel.append(grid);

  return panel;
}

function duckCard(ctx: PanelCtx, duck: Duck): HTMLElement {
  const badges = el('div', { class: 'card-badges' });
  const value = breedingValue(ctx.game.state, duck);
  const verdict = keepVerdict(value);
  if (duck.stage === 'elder') {
    badges.append(
      el(
        'span',
        { class: 'chip chip-trait', title: 'Past breeding — keeps eggs warm, steadies the young, and earns an honoured passing' },
        'wise elder',
      ),
    );
  } else if (verdict === 'key') {
    badges.append(
      el(
        'span',
        { class: 'chip chip-rare', title: `Only carrier of: ${value.uniqueAlleles.join(', ')}` },
        'key breeder',
      ),
    );
  } else if (verdict === 'covered') {
    badges.append(
      el(
        'span',
        { class: 'chip chip-trait', title: verdictReason(value) },
        'safe to sell',
      ),
    );
  } else if (value.marginalBreeds.length === 0 && value.bestOfBreed) {
    badges.append(el('span', { class: 'chip chip-ready', title: verdictReason(value) }, 'best of breed'));
  }
  if (duck.penned) badges.append(el('span', { class: 'chip chip-trait' }, 'penned'));
  const train = trainingChip(ctx.game, duck);
  if (train) badges.append(train);
  if (duck.sick) {
    badges.append(el('span', { class: 'chip chip-sick' }, icon('cross', 10), 'sick'));
  } else if (duck.needs.hunger < 25) {
    badges.append(el('span', { class: 'chip chip-warn' }, icon('warning', 10), 'hungry'));
  } else if (Math.min(...NEED_ROWS.map(([k]) => duck.needs[k])) < 25) {
    badges.append(el('span', { class: 'chip chip-warn' }, icon('warning', 10), 'needs care'));
  }

  const needs = el('div', { class: 'card-needs' });
  for (const [key, iconName] of NEED_ROWS) {
    const value = duck.needs[key];
    needs.append(
      el('div', { class: 'card-need-row' }, icon(iconName, 11), statBar(value, needColor(value), true)),
    );
  }

  // A div, not a button — the quick-action buttons nest inside it.
  return el(
    'div',
    { class: 'duck-card', title: 'Click to open · Ctrl/Cmd-click to pin for comparison', onclick: (e) => ctx.ui.selectDuck(duck.id, (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey) },
    el(
      'div',
      { class: 'card-top' },
      duckPortrait(duck, 52),
      el(
        'div',
        { class: 'card-id' },
        el('div', { class: 'card-name' }, sexBadge(duck.sex), ` ${duck.name}`),
        el(
          'div',
          { class: 'muted small' },
          ageLabel(duck),
          generationOf(duck) > 0 ? ` · gen ${generationOf(duck)}` : '',
        ),
        el('div', { class: 'muted small with-icon card-pedigree', title: 'Pedigree' }, icon('star', 9), ` ${pedigreeScore(duck)}`),
        duck.phenotype.rarityScore > 0 ? starRow(duck.phenotype.rarityScore, 9) : null,
      ),
    ),
    needs,
    quickActions(ctx.game, duck, {
      refresh: () => ctx.ui.refreshPanel(),
      toast: (msg) => ctx.ui.toast(msg),
    }),
    badges.childElementCount > 0 ? badges : null,
  );
}

function eggCard(ctx: PanelCtx, egg: Duck): HTMLElement {
  const pct = incubationPct(ctx.game.state, egg);
  return el(
    'button',
    { class: 'duck-card egg-card', onclick: (e) => ctx.ui.selectDuck(egg.id, (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey) },
    el(
      'div',
      { class: 'card-top' },
      duckPortrait(egg, 52),
      el(
        'div',
        { class: 'card-id' },
        el('div', { class: 'card-name with-icon' }, icon('egg', 12), 'Egg'),
        el('div', { class: 'muted small' }, `incubating · ${pct.toFixed(0)}%`),
      ),
    ),
    statBar(pct, '#e8b83a', true),
  );
}
