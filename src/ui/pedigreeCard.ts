// Pedigree card for the duck panel: the score with its breakdown, and a
// two-generation family tree drawn from the lineage stamped on the egg (so
// it still renders after the parents are gone).
import { el } from './dom';
import { icon } from './icons';
import { duckPortrait } from './portrait';
import { createRng } from '../rng';
import type { GameState } from '../state';
import type { Duck } from '../sim/duck';
import { createDuck } from '../sim/duck';
import type { Ancestor } from '../sim/lineage';
import { livingDescendants } from '../sim/lineage';
import { pedigree, PEDIGREE_MAX } from '../sim/pedigree';
import { breedKey, breedLabel } from '../sim/breedBook';
import { describeStandard, standardMatch, STANDARD_THRESHOLD } from '../sim/standards';
import { upgradeLevel } from '../sim/economy';

function ancestorPortrait(a: Ancestor | null, size: number): HTMLElement {
  if (!a) return el('span', { class: 'tree-node unknown', title: 'Unknown — a founder' }, '?');
  const rng = createRng(11);
  const sample = createDuck(rng, { genome: a.genome, stage: 'adult', pos: { x: 0, y: 0 }, sex: a.sex, name: a.name });
  return el(
    'span',
    { class: 'tree-node', title: `${a.name} · ${breedLabel(breedKey(a.genome))}` },
    duckPortrait(sample, size),
    el('span', { class: 'tree-name' }, a.name),
  );
}

export function buildPedigreeCard(state: GameState, duck: Duck): HTMLElement {
  const p = pedigree(duck);
  const card = el(
    'div',
    { class: 'section pedigree' },
    el(
      'div',
      { class: 'pedigree-head' },
      el('strong', {}, 'Pedigree'),
      el('span', { class: 'pedigree-score with-icon' }, icon('star', 12), ` ${p.score}`, el('span', { class: 'muted small' }, ` / ${PEDIGREE_MAX}`)),
    ),
  );
  const bits = el('div', { class: 'gene-badges' });
  bits.append(el('span', { class: 'chip chip-trait', title: 'Generations bred on this pond' }, p.gen === 0 ? 'founder' : `gen ${p.gen}`));
  bits.append(el('span', { class: 'chip chip-trait', title: 'Breed-Book genes fixed (homozygous) — breed true' }, `${p.fixed}/4 fixed`));
  if (p.rare > 0) bits.append(el('span', { class: 'chip chip-rare', title: 'Rare alleles carried (blue, pink bill, crest)' }, `${p.rare} rare`));
  if (p.pure) bits.append(el('span', { class: 'chip chip-ready', title: 'Both parents were the same breed' }, 'purebred'));
  const kids = livingDescendants(state, duck.id).length;
  if (kids > 0) bits.append(el('span', { class: 'chip chip-friend', title: 'Living children and grandchildren' }, `${kids} descendant${kids === 1 ? '' : 's'}`));
  card.append(bits);

  // Family tree: parents on the first row, grandparents on the second.
  const l = duck.lineage;
  if (l && (l.sire || l.dam)) {
    const tree = el(
      'div',
      { class: 'family-tree' },
      el('div', { class: 'tree-row' }, ancestorPortrait(l.dam, 36), ancestorPortrait(l.sire, 36)),
      el('div', { class: 'tree-row grand' }, ...l.grand.map((g) => ancestorPortrait(g, 26))),
    );
    card.append(tree);
  } else {
    card.append(el('div', { class: 'muted small' }, 'A founder — no recorded ancestry.'));
  }
  return card;
}

// Show-standard card: how close this duck is to its breed's standard, with a
// per-slot readout (exact alleles shown with the Scope).
export function buildStandardCard(state: GameState, duck: Duck): HTMLElement {
  const key = breedKey(duck.genome);
  const m = standardMatch(duck, key);
  const awards = state.awards[key] ?? {};
  const tone = m.pct >= STANDARD_THRESHOLD ? 'ok' : m.pct >= 60 ? 'mid' : 'warn';
  const fill = el('div', { class: `br-gauge-fill ${tone}` });
  fill.style.width = `${m.pct}%`;
  const scope = upgradeLevel(state, 'pedigreeScope') > 0;
  const card = el(
    'div',
    { class: 'section standard' },
    el(
      'div',
      { class: 'pedigree-head' },
      el('strong', {}, `${breedLabel(key)} standard`),
      awards.standard !== undefined ? el('span', { class: 'chip chip-ready' }, 'met') : null,
    ),
    el('div', { class: 'br-gauge-row' }, el('div', { class: 'br-gauge' }, fill), el('strong', { class: `br-gauge-pct ${tone}` }, `${m.pct}%`)),
    el('div', { class: 'muted small' }, `The ideal: ${describeStandard(key)}.`),
  );
  const slots = el('div', { class: 'std-slots' });
  for (const s of m.slots) {
    const cls = s.score >= 1 ? 'hit' : s.score > 0 ? 'part' : 'miss';
    slots.append(
      el(
        'span',
        { class: `std-slot ${cls}`, title: scope ? `${s.label}: have ${s.have}, want ${s.want}` : `${s.label}` },
        s.label,
        scope ? el('span', { class: 'std-detail' }, ` ${s.have}→${s.want}`) : null,
      ),
    );
  }
  card.append(slots);
  return card;
}
