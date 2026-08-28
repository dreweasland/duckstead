// The duck panel's genetics card: color swatches, polygenic gauges, and
// (with the Pedigree Scope) per-locus allele tiles plus carrier callouts.
import { clamp } from '../types';
import type { GameState } from '../state';
import type { Duck } from '../sim/duck';
import { expressedAlleles, type Allele, type LocusId } from '../sim/genetics';
import { upgradeLevel } from '../sim/economy';
import { el } from './dom';

const MENDELIAN_LOCI: Array<{ id: LocusId; label: string }> = [
  { id: 'baseColor', label: 'color' },
  { id: 'dilution', label: 'dilution' },
  { id: 'pattern', label: 'pattern' },
  { id: 'patternColor', label: 'markings' },
  { id: 'billColor', label: 'bill' },
  { id: 'crest', label: 'crest' },
];

const ADDITIVE_GROUPS: Array<{ label: string; loci: LocusId[]; max: number }> = [
  { label: 'size', loci: ['size1', 'size2', 'size3'], max: 6 },
  { label: 'bill', loci: ['bill1', 'bill2'], max: 4 },
  { label: 'vigor', loci: ['vigor1', 'vigor2'], max: 4 },
  { label: 'temper', loci: ['temper1', 'temper2'], max: 4 },
];

// Friendly names for alleles a duck can secretly carry.
const CARRIER_NAMES: Partial<Record<LocusId, Partial<Record<Allele, string>>>> = {
  baseColor: { W: 'white', k: 'black', B: 'blue' },
  dilution: { d: 'pastel' },
  pattern: { p: 'spotted', c: 'capped' },
  patternColor: { a: 'pale markings' },
  billColor: { y: 'yellow bill', P: 'pink bill' },
  crest: { R: 'crest' },
};

export function buildGeneticsCard(state: GameState, duck: Duck): HTMLElement {
  const p = duck.phenotype;
  const card = el('div', { class: 'section' }, el('strong', {}, 'Genetics'));

  // Plumage swatches.
  const swatches = el(
    'div',
    { class: 'gene-swatches' },
    swatch(p.bodyColor, 'body'),
    swatch(p.headColor, 'head'),
    swatch(p.billColor, 'bill'),
  );
  if (p.pattern !== 'solid') swatches.append(swatch(p.patternColor, p.pattern));
  card.append(swatches);

  // Trait badges.
  const badges = el('div', { class: 'gene-badges' });
  badges.append(el('span', { class: 'chip chip-trait' }, p.pattern));
  if (p.crested) badges.append(el('span', { class: 'chip chip-rare' }, 'crested'));
  if (p.rarityScore >= 4) badges.append(el('span', { class: 'chip chip-rare' }, 'rare'));
  card.append(badges);

  // Polygenic gauges.
  card.append(
    gauge('size', (p.sizeScale - 0.75) / 0.55, 'petite', 'grand'),
    gauge('bill', p.billLength, 'stubby', 'long'),
    gauge('vigor', p.vigor, 'frail', 'hardy'),
    gauge('temper', p.boldness, 'timid', 'bold'),
  );

  if (upgradeLevel(state, 'pedigreeScope') > 0) {
    card.append(buildScopeReadout(duck));
  } else {
    card.append(
      el('div', { class: 'muted hint' }, 'Buy the Pedigree Scope to read exact genotypes.'),
    );
  }
  return card;
}

function swatch(color: string, label: string): HTMLElement {
  const dot = el('span', { class: 'swatch-dot' });
  dot.style.background = color;
  return el('span', { class: 'swatch' }, dot, el('span', { class: 'swatch-label' }, label));
}

function gauge(label: string, fraction: number, lo: string, hi: string): HTMLElement {
  const marker = el('span', { class: 'gene-marker' });
  marker.style.left = `${clamp(fraction, 0, 1) * 100}%`;
  return el(
    'div',
    { class: 'gene-gauge-row' },
    el('span', { class: 'gene-gauge-label' }, label),
    el('span', { class: 'gene-gauge-end' }, lo),
    el('div', { class: 'gene-gauge' }, marker),
    el('span', { class: 'gene-gauge-end' }, hi),
  );
}

// The Pedigree Scope view: allele tiles per locus (expressed = solid, masked
// = dimmed), additive tallies, and which recessives the duck carries.
function buildScopeReadout(duck: Duck): HTMLElement {
  const box = el('div', { class: 'scope-box' });

  const grid = el('div', { class: 'allele-grid' });
  for (const { id, label } of MENDELIAN_LOCI) {
    const expressed = expressedAlleles(duck.genome, id);
    const row = el('span', { class: 'allele-locus' }, el('span', { class: 'allele-label' }, label));
    for (const allele of duck.genome[id]) {
      const isExpressed = expressed.includes(allele);
      row.append(
        el('span', { class: `allele-tile${isExpressed ? '' : ' masked'}` }, allele),
      );
    }
    grid.append(row);
  }
  box.append(grid);

  // Additive tallies as pip rows.
  for (const group of ADDITIVE_GROUPS) {
    let count = 0;
    for (const id of group.loci) {
      for (const allele of duck.genome[id]) if (allele === '+') count += 1;
    }
    const pips = el('span', { class: 'pip-row' });
    for (let i = 0; i < group.max; i += 1) {
      pips.append(el('span', { class: `pip${i < count ? ' on' : ''}` }));
    }
    box.append(
      el(
        'div',
        { class: 'pip-line' },
        el('span', { class: 'allele-label' }, group.label),
        pips,
        el('span', { class: 'muted small' }, `${count}/${group.max}`),
      ),
    );
  }

  // Hidden recessives worth breeding for.
  const carried = new Set<string>();
  for (const { id } of MENDELIAN_LOCI) {
    const expressed = expressedAlleles(duck.genome, id);
    for (const allele of duck.genome[id]) {
      if (expressed.includes(allele)) continue;
      const name = CARRIER_NAMES[id]?.[allele];
      if (name) carried.add(name);
    }
  }
  if (carried.size > 0) {
    const line = el('div', { class: 'carrier-line' }, el('span', { class: 'muted small' }, 'carries '));
    for (const name of carried) {
      line.append(el('span', { class: 'chip chip-carrier' }, name));
    }
    box.append(line);
  }
  return box;
}

// Compact genetics strip for side-by-side comparison (Breeding panel):
// swatches, trait tags, mini gauges, and — with the Scope — allele tiles for
// the Breed Book loci plus carrier chips. Without the Scope, the hidden side
// stays hidden; the chooser's "+N new" badge is the honest hint instead.
export function buildGeneStrip(state: GameState, duck: Duck): HTMLElement {
  const p = duck.phenotype;
  const strip = el('div', { class: 'gene-strip' });

  const swatches = el('div', { class: 'gene-swatches compact' }, swatch(p.bodyColor, 'body'), swatch(p.headColor, 'head'), swatch(p.billColor, 'bill'));
  if (p.pattern !== 'solid') swatches.append(swatch(p.patternColor, p.pattern));
  strip.append(swatches);

  const tags = el('div', { class: 'gene-badges' }, el('span', { class: 'chip chip-trait' }, p.pattern));
  if (p.crested) tags.append(el('span', { class: 'chip chip-rare' }, 'crested'));
  if (p.rarityScore >= 4) tags.append(el('span', { class: 'chip chip-rare' }, 'rare'));
  strip.append(tags);

  strip.append(
    gauge('size', (p.sizeScale - 0.75) / 0.55, 'petite', 'grand'),
    gauge('vigor', p.vigor, 'frail', 'hardy'),
    gauge('temper', p.boldness, 'timid', 'bold'),
  );

  if (upgradeLevel(state, 'pedigreeScope') > 0) {
    const grid = el('div', { class: 'allele-grid compact' });
    for (const { id, label } of MENDELIAN_LOCI) {
      if (id === 'patternColor') continue;
      const expressed = expressedAlleles(duck.genome, id);
      const row = el('span', { class: 'allele-locus' }, el('span', { class: 'allele-label' }, label));
      for (const allele of duck.genome[id]) {
        row.append(el('span', { class: `allele-tile${expressed.includes(allele) ? '' : ' masked'}` }, allele));
      }
      grid.append(row);
    }
    strip.append(grid);
    const carried = new Set<string>();
    for (const { id } of MENDELIAN_LOCI) {
      const expressed = expressedAlleles(duck.genome, id);
      for (const allele of duck.genome[id]) {
        if (expressed.includes(allele)) continue;
        const name = CARRIER_NAMES[id]?.[allele];
        if (name) carried.add(name);
      }
    }
    if (carried.size > 0) {
      const line = el('div', { class: 'carrier-line' }, el('span', { class: 'muted small' }, 'carries '));
      for (const name of carried) line.append(el('span', { class: 'chip chip-carrier' }, name));
      strip.append(line);
    }
  }
  return strip;
}
