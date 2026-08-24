import type { PanelCtx } from './ui';
import { el, statBar } from './dom';
import { icon } from './icons';
import { duckPortrait } from './portrait';
import {
  ALL_BREED_KEYS,
  breedLabel,
  breedsDiscovered,
  representativeGenome,
} from '../sim/breedBook';
import { createDuck } from '../sim/duck';
import { createRng } from '../rng';
import type { GameState, DuckSummary } from '../state';
import type { Duck } from '../sim/duck';
import { chronicleDate, type ChronicleKind } from '../sim/chronicle';
import { pedigreeScore } from '../sim/pedigree';
import { computePhenotype } from '../sim/genetics';
import { generationOf } from '../sim/lineage';
import { dayOf } from '../sim/time';
import { AWARD_LABELS, AWARD_TIERS, awardCount } from '../sim/awards';
import { describeStandard } from '../sim/standards';

type Tab = 'breeds' | 'chronicle' | 'records';
let activeTab: Tab = 'breeds';

export function renderBookPanel(ctx: PanelCtx): HTMLElement {
  const state = ctx.game.state;
  const discovered = breedsDiscovered(state);
  const total = ALL_BREED_KEYS.length;

  const panel = el('aside', { class: 'panel roster book' });
  panel.append(
    el(
      'div',
      { class: 'panel-header' },
      el('strong', { class: 'with-icon' }, icon('book'), 'Breed Book'),
      el('span', { class: 'br-nest-pill' }, ` ${discovered}/${total}`),
      el('button', { class: 'close-btn', onclick: ctx.close }, icon('close', 13)),
    ),
  );
  const tabs = el('div', { class: 'shop-tabs' });
  const defs: Array<{ id: Tab; label: string; icon: Parameters<typeof icon>[0]; badge?: string }> = [
    { id: 'breeds', label: 'Breeds', icon: 'book' },
    { id: 'chronicle', label: 'Chronicle', icon: 'flag', badge: state.chronicle.length ? String(state.chronicle.length) : undefined },
    { id: 'records', label: 'Records', icon: 'star' },
  ];
  for (const t of defs) {
    tabs.append(
      el(
        'button',
        { class: `shop-tab${activeTab === t.id ? ' active' : ''}`, onclick: () => { activeTab = t.id; ctx.ui.refreshPanel(); } },
        icon(t.icon, 12),
        t.label,
        t.badge ? el('span', { class: 'shop-tab-badge' }, t.badge) : null,
      ),
    );
  }
  panel.append(tabs);

  if (activeTab === 'breeds') panel.append(breedsTab(state, discovered, total));
  else if (activeTab === 'chronicle') panel.append(chronicleTab(state));
  else panel.append(recordsTab(state));
  return panel;
}

function breedsTab(state: GameState, discovered: number, total: number): HTMLElement {
  const box = el(
    'div',
    {},
    statBar((discovered / total) * 100, '#e8b83a'),
    el(
      'div',
      { class: 'muted small book-legend' },
      el('a', { class: 'guide-link', href: '/guide/', target: '_blank', rel: 'noopener' }, 'The full genetics guide ↗'),
    ),
    el(
      'div',
      { class: 'muted small book-legend' },
      `${awardCount(state)}/${total * AWARD_TIERS.length} awards · pips: `,
      el('span', { class: 'book-pip on' }), ' Pure ',
      el('span', { class: 'book-pip on' }), ' Standard (90% match) ',
      el('span', { class: 'book-pip on' }), ' Master (5 alive)',
    ),
  );
  const grid = el('div', { class: 'book-grid' });
  const portraitRng = createRng(7);
  for (const key of ALL_BREED_KEYS) {
    const entry = state.breedBook[key];
    if (!entry) {
      grid.append(
        el(
          'div',
          { class: 'book-cell locked', title: 'Not yet hatched on this pond' },
          el('span', { class: 'book-mystery' }, '?'),
        ),
      );
      continue;
    }
    const sample = createDuck(portraitRng, {
      genome: representativeGenome(key),
      stage: 'adult',
      pos: { x: 0, y: 0 },
      sex: 'F',
      name: 'specimen',
    });
    const awards = state.awards[key] ?? {};
    const pips = el('span', { class: 'book-awards' });
    for (const tier of AWARD_TIERS) {
      pips.append(el('span', { class: `book-pip${awards[tier] !== undefined ? ' on' : ''}`, title: `${AWARD_LABELS[tier]}${awards[tier] !== undefined ? ` — day ${awards[tier]}` : ''}` }));
    }
    grid.append(
      el(
        'div',
        {
          class: 'book-cell',
          title: `First hatched: ${entry.firstName} (day ${entry.day}) · bred ${entry.count}× · standard: ${describeStandard(key)}`,
        },
        duckPortrait(sample, 54),
        el('span', { class: 'book-label' }, breedLabel(key)),
        el('span', { class: 'muted book-count' }, `×${entry.count}`),
        pips,
      ),
    );
  }
  box.append(grid);

  // Feather Album: every plumage color molted on this pond.
  const album = Object.entries(state.featherAlbum).sort((a, b) => b[1] - a[1]);
  const albumBox = el(
    'div',
    { class: 'section' },
    el('strong', {}, 'Feather Album'),
    el('div', { class: 'muted small' }, album.length > 0
      ? `${state.stats.feathersCollected} feather${state.stats.feathersCollected === 1 ? '' : 's'} in ${album.length} color${album.length === 1 ? '' : 's'} — pick up what your ducks molt.`
      : 'Your ducks molt feathers on the grass — tap one to start the album.'),
  );
  if (album.length > 0) {
    const row = el('div', { class: 'feather-row' });
    for (const [color, count] of album) {
      const swatch = el('span', { class: 'feather-swatch', title: `${color} ×${count}` });
      swatch.style.background = color;
      row.append(el('span', { class: 'feather-chip' }, swatch, el('span', { class: 'muted small' }, `×${count}`)));
    }
    albumBox.append(row);
  }
  box.append(albumBox);
  return box;
}

const KIND_ICON: Record<ChronicleKind, Parameters<typeof icon>[0]> = {
  breed: 'book', hatch: 'egg', death: 'grave', festival: 'flag', race: 'flag', award: 'star',
  visitor: 'sparkle', sale: 'coin', birthday: 'smile', society: 'star', milestone: 'star',
};

function chronicleTab(state: GameState): HTMLElement {
  const box = el('div', { class: 'chronicle' });
  if (state.chronicle.length === 0) {
    box.append(el('div', { class: 'muted small roster-empty' }, 'Nothing written yet. New breeds, champions, and farewells are recorded here.'));
    return box;
  }
  let lastDay = -1;
  for (const entry of [...state.chronicle].reverse()) {
    if (entry.day !== lastDay) {
      box.append(el('div', { class: 'chronicle-date' }, chronicleDate(entry.day)));
      lastDay = entry.day;
    }
    box.append(
      el('div', { class: `chronicle-line kind-${entry.kind}` }, el('span', { class: 'chronicle-icon' }, icon(KIND_ICON[entry.kind], 11)), el('span', {}, entry.text)),
    );
  }
  return box;
}

function recordsTab(state: GameState): HTMLElement {
  const s = state.stats;
  const living = state.ducks.filter((d) => d.stage !== 'egg');
  const oldestLiving = living.reduce<Duck | null>((best, d) => {
    const age = d.bornDay !== undefined ? dayOf(state.clock) - d.bornDay : 0;
    const bestAge = best && best.bornDay !== undefined ? dayOf(state.clock) - best.bornDay : -1;
    return age > bestAge ? d : best;
  }, null);
  const longestLived = state.memorial.reduce<DuckSummary | null>((best, m) => ((m.ageDays ?? 0) > (best?.ageDays ?? -1) ? m : best), null);
  const bestPed = living.reduce<Duck | null>((best, d) => (!best || pedigreeScore(d) > pedigreeScore(best) ? d : best), null);
  const mostDescendants = state.memorial.reduce<DuckSummary | null>((best, m) => ((m.descendants ?? 0) > (best?.descendants ?? 0) ? m : best), null);

  const tile = (label: string, value: string, sub?: string) =>
    el('div', { class: 'record-tile' }, el('div', { class: 'record-value' }, value), el('div', { class: 'record-label' }, label), sub ? el('div', { class: 'record-sub muted small' }, sub) : null);

  const box = el('div', {});
  box.append(
    el('div', { class: 'record-grid' },
      tile('Ducks hatched', String(s.ducksHatched)),
      tile('Breeds found', `${Object.keys(state.breedBook).length}/${ALL_BREED_KEYS.length}`),
      tile('Deepest generation', String(Math.max(s.deepestGen, ...living.map(generationOf)))),
      tile('Best pedigree', String(Math.max(s.bestPedigree, ...living.map(pedigreeScore))), bestPed ? bestPed.name : undefined),
      tile('Biggest sale', `${s.biggestSale}`, 'coins'),
      tile('Ducks sold', String(s.ducksSold)),
      tile('Derby wins', String(s.racesWon)),
      tile('Festival wins', String(s.festivalWins)),
      tile('Hen eggs gathered', String(s.henEggsGathered)),
      tile('Feathers', String(s.feathersCollected)),
      tile('Wild ducks befriended', String(s.wildRecruited)),
      tile('Favourites found', String(s.favouritesFound)),
      tile('Oldest living', oldestLiving && oldestLiving.bornDay !== undefined ? `${dayOf(state.clock) - oldestLiving.bornDay}d` : '—', oldestLiving?.name),
      tile('Longest life', longestLived?.ageDays !== undefined ? `${longestLived.ageDays}d` : '—', longestLived?.name),
      tile('Greatest line', mostDescendants && (mostDescendants.descendants ?? 0) > 0 ? `${mostDescendants.descendants}` : '—', mostDescendants && (mostDescendants.descendants ?? 0) > 0 ? `${mostDescendants.name}'s descendants` : undefined),
    ),
  );

  if (state.memorial.length > 0) {
    const memorial = el(
      'div',
      { class: 'section' },
      el('strong', { class: 'with-icon' }, icon('grave'), 'Remembered fondly'),
      el('div', { class: 'muted small' }, 'The ducks who made this pond what it is.'),
    );
    const grid = el('div', { class: 'memorial-grid' });
    for (const gone of state.memorial.slice(-24).reverse()) grid.append(memorialCard(gone));
    memorial.append(grid);
    box.append(memorial);
  }
  return box;
}

// A little headstone in the garden of remembrance. Newer saves stored the
// genome at death, so the stone bears a true portrait; older entries get a
// feather in the duck's colour.
const EPITAPHS = [
  'A good duck.',
  'Fond of the reeds.',
  'Never missed a feeding.',
  'Loved the rain.',
  'Kept the pond honest.',
  'First to the trough, last to bed.',
  'Preened to perfection.',
  'A soft spot for duckweed.',
  'Quacked at the moon.',
  'The bench was theirs.',
];

function memorialCard(gone: DuckSummary): HTMLElement {
  const elder = gone.diedStage === 'elder';
  const card = el('div', { class: `memorial-card${elder ? ' honoured' : ''}` });
  if (gone.genome) {
    const stub = {
      id: `memorial-${gone.name}`,
      genome: gone.genome,
      phenotype: computePhenotype(gone.genome),
      sex: gone.sex,
      stage: 'adult',
      sick: false,
      activity: 'idle',
      needs: { hunger: 100, cleanliness: 100, happiness: 100, health: 100 },
    } as unknown as Duck;
    card.append(el('div', { class: 'memorial-portrait' }, duckPortrait(stub, 54)));
  } else {
    const feather = el('div', { class: 'memorial-portrait memorial-feather' }, icon('feather', 30));
    feather.style.color = gone.bodyColor;
    card.append(feather);
  }
  card.append(
    el(
      'div',
      { class: 'memorial-name' },
      el('span', { class: `sex-badge sex-${gone.sex.toLowerCase()}` }, gone.sex === 'M' ? '♂' : '♀'),
      ` ${gone.name}`,
    ),
    el(
      'div',
      { class: 'memorial-line muted small' },
      elder
        ? `passed peacefully${gone.ageDays !== undefined ? ` at ${gone.ageDays} days` : ''}`
        : `died young${gone.ageDays !== undefined ? ` at ${gone.ageDays} days` : ''}`,
    ),
  );
  const meta: string[] = [];
  if (gone.gen) meta.push(`gen ${gone.gen}`);
  if (gone.pedigree) meta.push(`★ ${gone.pedigree}`);
  if (meta.length) card.append(el('div', { class: 'memorial-line muted small' }, meta.join(' · ')));
  if (gone.descendants) {
    card.append(
      el(
        'div',
        { class: 'memorial-line memorial-legacy' },
        `${gone.sex === 'F' ? 'Her' : 'His'} line lives on in ${gone.descendants} duck${gone.descendants === 1 ? '' : 's'}.`,
      ),
    );
  }
  // A small deterministic epitaph, so each stone reads the same every visit.
  let hash = 0;
  for (const ch of gone.name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  card.append(el('div', { class: 'memorial-epitaph' }, `“${EPITAPHS[hash % EPITAPHS.length]}”`));
  return card;
}
