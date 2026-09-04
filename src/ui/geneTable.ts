// The Flock panel's Genes view: one row per duck, one column per trait, so
// a handful of ducks can be read side by side without opening cards. With
// the Pedigree Scope the Mendelian columns show allele tiles (expressed
// bright, masked dashed); without it they show what the duck looks like.
// Additive traits are pip counts either way. Any column header sorts.
import type { PanelCtx } from './ui';
import { el } from './dom';
import { icon, sexBadge } from './icons';
import { duckPortrait } from './portrait';
import type { Duck } from '../sim/duck';
import { expressedAlleles, type LocusId } from '../sim/genetics';
import { breedKey, breedLabel } from '../sim/breedBook';
import { standardMatch } from '../sim/standards';
import { pedigreeScore } from '../sim/pedigree';
import { generationOf } from '../sim/lineage';
import { breedingValue, keepVerdict, type KeepVerdict } from '../sim/advisor';
import { upgradeLevel } from '../sim/economy';
import { personalityLabels } from '../sim/behavior';
import { duckById } from '../state';

type Col =
  | 'name' | 'breed'
  | 'baseColor' | 'dilution' | 'pattern' | 'patternColor' | 'billColor' | 'crest'
  | 'size' | 'bill' | 'vigor' | 'temper'
  | 'std' | 'ped' | 'value';

const MENDELIAN: Array<{ id: LocusId; col: Col; label: string }> = [
  { id: 'baseColor', col: 'baseColor', label: 'colour' },
  { id: 'dilution', col: 'dilution', label: 'shade' },
  { id: 'pattern', col: 'pattern', label: 'pattern' },
  { id: 'patternColor', col: 'patternColor', label: 'marks' },
  { id: 'billColor', col: 'billColor', label: 'bill' },
  { id: 'crest', col: 'crest', label: 'crest' },
];

const ADDITIVE: Array<{ col: Col; label: string; loci: LocusId[]; max: number }> = [
  { col: 'size', label: 'size', loci: ['size1', 'size2', 'size3'], max: 6 },
  { col: 'bill', label: 'bill len', loci: ['bill1', 'bill2'], max: 4 },
  { col: 'vigor', label: 'vigor', loci: ['vigor1', 'vigor2'], max: 4 },
  { col: 'temper', label: 'temper', loci: ['temper1', 'temper2'], max: 4 },
];

// Sort and pick state persist across the panel's periodic rebuilds.
let sortCol: Col = 'name';
let sortDir: 1 | -1 = 1;
const picked = new Set<string>();

export function pickedCount(state: { ducks: Duck[] }): number {
  let n = 0;
  for (const d of state.ducks) if (picked.has(d.id)) n += 1;
  return n;
}

export function isPicked(id: string): boolean {
  return picked.has(id);
}

export function clearPicks(): void {
  picked.clear();
}

function plus(duck: Duck, loci: LocusId[]): number {
  let n = 0;
  for (const id of loci) for (const a of duck.genome[id]) if (a === '+') n += 1;
  return n;
}

const VERDICT_RANK: Record<KeepVerdict, number> = { key: 0, useful: 1, covered: 2 };

function sortValue(duck: Duck, col: Col, verdict: KeepVerdict | undefined): string | number {
  switch (col) {
    case 'name': return duck.name.toLowerCase();
    case 'breed': return breedLabel(breedKey(duck.genome));
    case 'baseColor': case 'dilution': case 'pattern': case 'patternColor': case 'billColor': case 'crest':
      return [...expressedAlleles(duck.genome, col)].sort().join('') + [...duck.genome[col]].sort().join('');
    case 'size': case 'bill': case 'vigor': case 'temper':
      return plus(duck, ADDITIVE.find((a) => a.col === col)!.loci);
    case 'std': return standardMatch(duck).pct;
    case 'ped': return pedigreeScore(duck);
    case 'value': return duck.stage === 'elder' ? 9 : VERDICT_RANK[verdict ?? 'covered'];
  }
}

export function buildGeneTable(ctx: PanelCtx, ducks: Duck[]): HTMLElement {
  const { game } = ctx;
  const state = game.state;
  const scope = upgradeLevel(state, 'pedigreeScope') > 0;
  const verdicts = new Map<string, KeepVerdict>();
  for (const d of ducks) if (d.stage !== 'egg') verdicts.set(d.id, keepVerdict(breedingValue(state, d)));
  // Eggs keep their genes secret without the Scope.
  const rows = ducks.filter((d) => scope || d.stage !== 'egg');

  const sorted = [...rows].sort((a, b) => {
    const va = sortValue(a, sortCol, verdicts.get(a.id));
    const vb = sortValue(b, sortCol, verdicts.get(b.id));
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return c * sortDir || a.name.localeCompare(b.name);
  });

  const th = (col: Col, label: string, title = '') =>
    el(
      'th',
      {
        class: `sortable${sortCol === col ? ' sorted' : ''}`,
        title: title || `Sort by ${label}`,
        onclick: () => {
          if (sortCol === col) sortDir = sortDir === 1 ? -1 : 1;
          else {
            sortCol = col;
            // Numbers read best high-first; names A→Z.
            sortDir = col === 'name' || col === 'breed' || col === 'value' ? 1 : -1;
          }
          ctx.ui.refreshPanel();
        },
      },
      label,
      sortCol === col ? el('span', { class: 'sort-arrow' }, sortDir === 1 ? '▲' : '▼') : null,
    );

  const head = el(
    'tr',
    {},
    el('th', { class: 'pick-col', title: 'Tick a few ducks, then "Picked only" to compare just those' }, icon('cards', 11)),
    th('name', 'duck'),
    th('breed', 'breed'),
    ...MENDELIAN.map((m) => th(m.col, m.label, scope ? `Sort by ${m.label} alleles` : `Sort by ${m.label}`)),
    ...ADDITIVE.map((a) => th(a.col, a.label, `Sort by ${a.label} (+ alleles)`)),
    th('std', 'std %', 'How close to its breed\'s show standard'),
    th('ped', 'ped', 'Pedigree'),
    th('value', 'value', 'Breeding value'),
  );

  const body = el('tbody');
  for (const duck of sorted) {
    const verdict = verdicts.get(duck.id);
    const row = el(
      'tr',
      {
        class: `${picked.has(duck.id) ? 'picked' : ''}${duck.id === game.selectedDuckId ? ' selected' : ''}`,
        onclick: (e) => ctx.ui.selectDuck(duck.id, (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey),
      },
    );
    const pick = el('input', { type: 'checkbox', class: 'pick-box', title: 'Pick for comparison' }) as HTMLInputElement;
    pick.checked = picked.has(duck.id);
    pick.addEventListener('click', (e) => e.stopPropagation());
    pick.addEventListener('change', () => {
      if (pick.checked) picked.add(duck.id);
      else picked.delete(duck.id);
      ctx.ui.refreshPanel();
    });
    row.append(el('td', { class: 'pick-col' }, pick));
    const temper = personalityLabels(duck)[0] ?? '';
    const friend = duck.friendId ? duckById(state, duck.friendId) : undefined;
    row.append(
      el(
        'td',
        { class: 'gt-duck' },
        duckPortrait(duck, 30),
        el(
          'div',
          {},
          el('div', { class: 'gt-name' }, duck.stage === 'egg' ? icon('egg', 11) : sexBadge(duck.sex), ` ${duck.stage === 'egg' ? 'Egg' : duck.name}`),
          el('div', { class: 'muted small' }, `${duck.stage}${generationOf(duck) > 0 ? ` · gen ${generationOf(duck)}` : ''}${duck.stage !== 'egg' && temper ? ` · ${temper}` : ''}${friend ? ` · ♥ ${friend.name}` : ''}`),
        ),
      ),
      el('td', { class: 'gt-breed small' }, duck.stage === 'egg' && !scope ? '?' : breedLabel(breedKey(duck.genome))),
    );
    for (const m of MENDELIAN) {
      const cell = el('td', { class: 'gt-alleles' });
      if (scope) {
        const expressed = expressedAlleles(duck.genome, m.id);
        for (const a of duck.genome[m.id]) cell.append(el('span', { class: `allele-tile${expressed.includes(a) ? '' : ' masked'}` }, a));
      } else {
        cell.append(phenotypeCell(duck, m.id));
      }
      row.append(cell);
    }
    for (const a of ADDITIVE) {
      const n = plus(duck, a.loci);
      const pips = el('span', { class: 'pip-row gt-pips', title: `${n}/${a.max}` });
      for (let i = 0; i < a.max; i += 1) pips.append(el('span', { class: `pip${i < n ? ' on' : ''}` }));
      row.append(el('td', {}, pips, el('span', { class: 'muted small gt-pipnum' }, String(n))));
    }
    const std = standardMatch(duck).pct;
    row.append(
      el('td', { class: `gt-num ${std >= 90 ? 'ok-text' : std >= 60 ? '' : 'muted'}` }, `${std}%`),
      el('td', { class: 'gt-num' }, String(pedigreeScore(duck))),
      el(
        'td',
        {},
        duck.stage === 'elder'
          ? el('span', { class: 'chip chip-trait' }, 'elder')
          : duck.stage === 'egg'
            ? el('span', { class: 'muted small' }, '—')
            : verdict === 'key'
              ? el('span', { class: 'chip chip-rare' }, 'key')
              : verdict === 'useful'
                ? el('span', { class: 'chip chip-ready' }, 'keep')
                : el('span', { class: 'chip chip-trait' }, 'covered'),
      ),
    );
    body.append(row);
  }

  const table = el('table', { class: 'gene-table' }, el('thead', {}, head), body);
  const wrap = el('div', { class: 'gene-table-wrap' }, table);
  if (sorted.length === 0) wrap.append(el('div', { class: 'muted small roster-empty' }, 'No ducks to show.'));
  return el(
    'div',
    { class: 'gene-view' },
    el(
      'div',
      { class: 'muted small gene-view-hint' },
      scope
        ? 'Bright tiles are expressed, dashed ones carried. Click a header to sort; click a row to open the card, Ctrl/Cmd-click to pin it.'
        : 'Without the Pedigree Scope the table shows what each duck looks like; the Scope reveals every allele. Click a header to sort; click a row to open the card.',
    ),
    wrap,
  );
}

// What a locus looks like from the outside, for the no-Scope table.
function phenotypeCell(duck: Duck, id: LocusId): HTMLElement {
  const p = duck.phenotype;
  const dot = (color: string, label: string) => {
    const s = el('span', { class: 'swatch-dot small', title: label });
    s.style.background = color;
    return s;
  };
  switch (id) {
    case 'baseColor': return el('span', { class: 'gt-pheno' }, dot(p.bodyColor, 'body'), dot(p.headColor, 'head'));
    case 'dilution': return el('span', { class: 'gt-pheno small' }, expressedAlleles(duck.genome, 'dilution')[0] === 'd' ? 'pastel' : 'full');
    case 'pattern': return el('span', { class: 'gt-pheno small' }, p.pattern);
    case 'patternColor': return p.pattern === 'solid' ? el('span', { class: 'muted small' }, '—') : dot(p.patternColor, 'markings');
    case 'billColor': return dot(p.billColor, 'bill');
    case 'crest': return el('span', { class: 'gt-pheno small' }, p.crested ? 'crest' : '—');
    default: return el('span');
  }
}
