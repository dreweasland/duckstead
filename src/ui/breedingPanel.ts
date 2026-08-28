// The Breeding panel: pick a pair, read their genetics side by side, see the
// odds for every trait the clutch could express, and nest them. Also hosts
// the nest itself (courting pairs and incubating eggs).
import { clamp } from '../types';
import type { PanelCtx } from './ui';
import { el, panelHeader } from './dom';
import { icon, sexBadge } from './icons';
import { duckPortrait } from './portrait';
import type { Duck } from '../sim/duck';
import { createDuck } from '../sim/duck';
import type { Allele, Genome, LocusId } from '../sim/genetics';
import { computePhenotype, expressedAlleles, LOCI } from '../sim/genetics';
import { eggsIncubating, nestPair, pairViability } from '../sim/breeding';
import { TICKS_PER_MINUTE } from '../sim/time';
import { breedReadiness, canBreedPair, eggSpeedFor, eggWarmth, tuckEgg } from '../sim/needs';
import { breedingValue, keepVerdict } from '../sim/advisor';
import { breedKey, breedLabel } from '../sim/breedBook';
import type { GameState } from '../state';
import { nestCapacity, pondHasRoom, sellDuck, sellPrice, upgradeLevel } from '../sim/economy';
import { claimHatch, eggIncubationTicks } from '../sim/lifecycle';
import { createRng } from '../rng';
import { buildGeneStrip } from './geneticsCard';
import { closeKin } from '../sim/lineage';
import { describeBalance, drakePressure, flockBalance } from '../sim/flockBalance';
import { pairKeys } from '../sim/advisor';
import { PRESSURE_VIABILITY_PENALTY } from '../sim/needs';

// Module-level selection persists across the panel's 500ms refreshes.
let slotA: string | null = null;
let slotB: string | null = null;
let choosing: 'A' | 'B' | null = null;
let breedingTab: 'pairing' | 'nest' = 'pairing';

// Called when a duck on the pond is clicked while this panel is open: fill
// the slot being chosen, else the first empty one, else the slot of the same
// sex. Returns false if the duck can't take a slot (not an adult).
export function pickMateFromPond(state: GameState, duckId: string): boolean {
  const duck = state.ducks.find((d) => d.id === duckId);
  if (!duck || duck.stage !== 'adult') return false;
  const a = state.ducks.find((d) => d.id === slotA) ?? null;
  const b = state.ducks.find((d) => d.id === slotB) ?? null;
  if (choosing === 'A' || (!choosing && (!a || (b && b.sex !== duck.sex && a.sex === duck.sex)))) {
    if (b?.id === duck.id) slotB = null;
    slotA = duck.id;
  } else if (choosing === 'B' || !b || b.sex === duck.sex) {
    if (a?.id === duck.id) slotA = null;
    slotB = duck.id;
  } else {
    slotA = duck.id;
  }
  choosing = null;
  return true;
}

export function renderBreedingPanel(ctx: PanelCtx): HTMLElement {
  const { game } = ctx;
  const state = game.state;
  const ducks = state.ducks;
  const a = ducks.find((d) => d.id === slotA) ?? null;
  const b = ducks.find((d) => d.id === slotB) ?? null;
  if (slotA && !a) slotA = null;
  if (slotB && !b) slotB = null;

  const nestUsed = eggsIncubating(state) + state.pendingClutches.length;
  const panel = el('aside', { class: 'panel breeding' });
  panel.append(
    panelHeader('heart', 'Breeding', ctx.close),
  );

  // Tabs: the pairing table and the nest.
  const tabs = el('div', { class: 'shop-tabs' });
  const tabDefs = [
    { id: 'pairing' as const, label: 'Pairing', icon: 'heart' as const, badge: null as string | null },
    { id: 'nest' as const, label: 'The Nest', icon: 'egg' as const, badge: `${nestUsed}/${nestCapacity(state)}` },
  ];
  for (const t of tabDefs) {
    tabs.append(
      el(
        'button',
        {
          class: `shop-tab${breedingTab === t.id ? ' active' : ''}`,
          onclick: () => {
            breedingTab = t.id;
            ctx.ui.refreshPanel();
          },
        },
        icon(t.icon, 12),
        t.label,
        t.badge ? el('span', { class: `shop-tab-badge${nestUsed >= nestCapacity(state) ? ' full' : ''}` }, t.badge) : null,
      ),
    );
  }
  panel.append(tabs);

  if (breedingTab === 'nest') {
    panel.append(nestSection(ctx));
    return panel;
  }

  // --- The pair ---
  const pair = el(
    'div',
    { class: 'br-pair' },
    mateCard(ctx, 'A', a, b),
    el('div', { class: 'br-heart' }, icon('heart', 18)),
    mateCard(ctx, 'B', b, a),
  );
  panel.append(pair);
  panel.append(
    el('div', { class: 'muted hint br-hint' }, 'Tip: click a duck on the pond to drop it into a slot · Ctrl-click pins its card.'),
  );

  // --- Chooser ---
  if (choosing) panel.append(chooser(ctx, choosing, choosing === 'A' ? b : a));

  // --- Verdict + odds ---
  if (a && b) {
    panel.append(pairVerdict(ctx, a, b));
    panel.append(offspringOdds(state, a, b));
  } else if (!choosing) {
    panel.append(
      el(
        'div',
        { class: 'br-empty' },
        icon('heartOutline', 22),
        el('div', {}, 'Pick two adults to compare their genes and preview the clutch.'),
      ),
    );
  }
  return panel;
}

// ---------------------------------------------------------------------------

function mateCard(ctx: PanelCtx, which: 'A' | 'B', duck: Duck | null, other: Duck | null): HTMLElement {
  const state = ctx.game.state;
  const card = el('div', { class: `br-mate${choosing === which ? ' choosing' : ''}${duck ? '' : ' empty'}` });
  const pick = el(
    'button',
    {
      class: 'br-mate-pick',
      title: duck ? 'Change' : 'Choose a duck',
      onclick: () => {
        choosing = choosing === which ? null : which;
        ctx.ui.refreshPanel();
      },
    },
    duck ? duckPortrait(duck, 72) : el('span', { class: 'br-slot-plus' }, '+'),
  );
  card.append(pick);
  if (!duck) {
    card.append(el('div', { class: 'br-mate-name muted' }, which === 'A' ? 'First mate' : 'Second mate'));
    card.append(el('div', { class: 'small muted' }, 'click to choose'));
    return card;
  }
  const ready = other ? canBreedPair(duck, other) : breedReadiness(duck);
  card.append(
    el('div', { class: 'br-mate-name' }, sexBadge(duck.sex), ` ${duck.name}`),
    el('div', { class: `br-ready ${ready.ok ? 'ok' : 'warn'}` }, ready.ok ? 'ready' : ready.reason ?? ''),
    buildGeneStrip(state, duck),
  );
  return card;
}

function chooser(ctx: PanelCtx, which: 'A' | 'B', other: Duck | null): HTMLElement {
  const state = ctx.game.state;
  const discovered = new Set(Object.keys(state.breedBook));
  const candidates = state.ducks
    .filter((d) => d.stage === 'adult' && d.id !== other?.id && (!other || d.sex !== other.sex))
    .map((d) => {
      const gate = other ? canBreedPair(d, other) : breedReadiness(d);
      const value = breedingValue(state, d);
      // pairKeys caches per duck pair — childBreedKeys walks up to 256
      // genotype leaves and this runs per candidate per 500ms refresh.
      const newBreeds = other
        ? [...pairKeys(d, other)].filter((k) => !discovered.has(k)).length
        : value.newBreeds.length;
      return { d, gate, newBreeds, verdict: keepVerdict(value) };
    })
    .sort((x, y) => Number(y.gate.ok) - Number(x.gate.ok) || y.newBreeds - x.newBreeds);

  const box = el(
    'div',
    { class: 'br-chooser' },
    el(
      'div',
      { class: 'br-section-title' },
      other ? `Partners for ${other.name}` : `Choose the ${which === 'A' ? 'first' : 'second'} mate`,
      el('span', { class: 'muted small' }, ' · sorted by readiness, then new breeds'),
    ),
  );
  if (candidates.length === 0) {
    box.append(el('div', { class: 'muted small' }, 'No eligible adults — raise a duckling or adopt one.'));
    return box;
  }
  const grid = el('div', { class: 'br-cand-grid' });
  for (const { d, gate, newBreeds, verdict } of candidates) {
    grid.append(
      el(
        'button',
        {
          class: `br-cand${gate.ok ? '' : ' not-ready'}`,
          title: gate.ok ? 'Ready to breed' : gate.reason ?? '',
          onclick: () => {
            if (which === 'A') slotA = d.id;
            else slotB = d.id;
            choosing = null;
            ctx.ui.refreshPanel();
          },
        },
        duckPortrait(d, 44),
        el(
          'span',
          { class: 'br-cand-info' },
          el('span', { class: 'br-cand-name' }, sexBadge(d.sex), ` ${d.name}`),
          el('span', { class: 'br-cand-meta' },
            gate.ok
              ? el('span', { class: 'ok-text' }, 'ready')
              : el('span', { class: 'warn-text' }, gate.reason ?? ''),
          ),
          swatchRow(d),
          el(
            'span',
            { class: 'br-cand-badges' },
            verdict === 'key' ? el('span', { class: 'chip chip-rare' }, 'key') : null,
            newBreeds > 0 ? el('span', { class: 'chip chip-ready' }, `+${newBreeds} new`) : null,
          ),
        ),
      ),
    );
  }
  box.append(grid);
  return box;
}

function swatchRow(duck: Duck): HTMLElement {
  const p = duck.phenotype;
  const row = el('span', { class: 'br-swatches' });
  for (const c of [p.bodyColor, p.headColor, p.billColor]) {
    const dot = el('span', { class: 'swatch-dot' });
    dot.style.background = c;
    row.append(dot);
  }
  if (p.pattern !== 'solid') row.append(el('span', { class: 'br-tag' }, p.pattern));
  if (p.crested) row.append(el('span', { class: 'br-tag rare' }, 'crest'));
  return row;
}

function pairVerdict(ctx: PanelCtx, a: Duck, b: Duck): HTMLElement {
  const state = ctx.game.state;
  const gate = canBreedPair(a, b);
  const crowded = !pondHasRoom(state);
  const nestOk = eggsIncubating(state) + state.pendingClutches.length < nestCapacity(state);
  const viability = Math.round(pairViability(state, a, b) * 100);
  const tone = viability >= 80 ? 'ok' : viability >= 60 ? 'mid' : 'warn';
  const fill = el('div', { class: `br-gauge-fill ${tone}` });
  fill.style.width = `${viability}%`;

  let blocker: string | null = null;
  if (!gate.ok) blocker = gate.reason ?? null;
  else if (!nestOk) blocker = 'The nest is full — sell or hatch some eggs first';

  return el(
    'div',
    { class: 'br-verdict' },
    el(
      'div',
      { class: 'br-gauge-row' },
      el('span', { class: 'br-gauge-label' }, 'Clutch viability'),
      el('div', { class: 'br-gauge' }, fill),
      el('strong', { class: `br-gauge-pct ${tone}` }, `${viability}%`),
    ),
    el(
      'div',
      { class: 'muted small' },
      'Happiness × health, rolled when the egg is laid — feed and pet the pair during the hour of courtship to raise it.',
    ),
    blocker ? el('div', { class: 'br-blocker' }, icon('warning', 12), blocker) : null,
    !blocker && crowded
      ? el('div', { class: 'br-blocker soft' }, icon('warning', 12), 'The pond is at capacity — the clutch will overcrowd it until you sell.')
      : null,
    closeKin(a, b)
      ? el('div', { class: 'br-blocker soft' }, icon('warning', 12), 'Close kin — the clutch will be less vigorous.')
      : null,
    drakePressure(state) > 0
      ? el('div', { class: 'br-blocker soft' }, icon('warning', 12), `${describeBalance(flockBalance(state))} — viability −${drakePressure(state) * Math.round(PRESSURE_VIABILITY_PENALTY * 100)}%.`)
      : null,
    el(
      'button',
      {
        class: 'action-btn primary br-nest-btn',
        disabled: blocker !== null,
        onclick: () => {
          const result = nestPair(state, a.id, b.id);
          if (!result.ok && result.reason) ctx.ui.toast(result.reason);
          ctx.ui.refreshPanel();
        },
      },
      icon('egg', 13),
      'Nest this pair',
    ),
  );
}

// ---------------------------------------------------------------------------
// Offspring odds: exact per-trait distributions (one random allele from each
// parent per locus, no mutation), plus a sampled gallery of the most likely
// looks, and what the pairing could add to the Breed Book.

const ALLELE_NAMES: Partial<Record<LocusId, Record<string, string>>> = {
  baseColor: { M: 'mallard', W: 'white', k: 'black', B: 'blue', 'B+M': 'blue-mallard' },
  dilution: { D: 'full', d: 'pastel' },
  pattern: { S: 'solid', p: 'spotted', c: 'capped' },
  patternColor: { A: 'dark markings', a: 'pale markings' },
  billColor: { O: 'orange bill', y: 'yellow bill', P: 'pink bill' },
  crest: { r: 'plain', R: 'crested' },
};

interface TraitOdds {
  label: string;
  locus: LocusId;
  outcomes: Array<{ name: string; pct: number; rare: boolean }>;
}

// Exact distribution of the *expressed* result at one locus.
function locusOdds(a: Genome, b: Genome, id: LocusId, label: string): TraitOdds {
  const counts = new Map<string, number>();
  for (const x of a[id]) {
    for (const y of b[id]) {
      const child = { ...a, [id]: [x, y] as [Allele, Allele] };
      const key =
        id === 'crest'
          ? x === 'R' && y === 'R' ? 'R' : 'r'
          : [...expressedAlleles(child, id)].sort().join('+');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const outcomes = [...counts.entries()]
    .map(([key, n]) => ({
      name: ALLELE_NAMES[id]?.[key] ?? key,
      pct: Math.round((n / 4) * 100),
      rare: key.includes('B') || key === 'P' || key === 'R',
    }))
    .sort((x, y) => y.pct - x.pct);
  return { label, locus: id, outcomes };
}

function offspringOdds(state: GameState, a: Duck, b: Duck): HTMLElement {
  const box = el('div', { class: 'br-odds' });

  // Breed Book impact.
  const discovered = new Set(Object.keys(state.breedBook));
  const unlockable = [...pairKeys(a, b)].filter((k) => !discovered.has(k));
  box.append(
    el(
      'div',
      { class: 'br-section-title' },
      'Clutch odds',
      unlockable.length > 0
        ? el(
            'span',
            { class: 'chip chip-ready', title: unlockable.slice(0, 8).map(breedLabel).join(' · ') },
            `${unlockable.length} new breed${unlockable.length === 1 ? '' : 's'} possible`,
          )
        : el('span', { class: 'muted small' }, ' nothing new for the Book'),
    ),
  );

  // Per-trait bars.
  const traits = [
    locusOdds(a.genome, b.genome, 'baseColor', 'Color'),
    locusOdds(a.genome, b.genome, 'pattern', 'Pattern'),
    locusOdds(a.genome, b.genome, 'dilution', 'Shade'),
    locusOdds(a.genome, b.genome, 'crest', 'Crest'),
    locusOdds(a.genome, b.genome, 'billColor', 'Bill'),
  ];
  const table = el('div', { class: 'br-traits' });
  for (const t of traits) {
    // Skip traits that are certain and boring (e.g. 100% full shade).
    if (t.outcomes.length === 1 && !t.outcomes[0].rare && (t.locus === 'dilution' || t.locus === 'crest')) continue;
    const bar = el('div', { class: 'br-trait-bar' });
    const legend = el('div', { class: 'br-trait-legend' });
    t.outcomes.forEach((o, i) => {
      const seg = el('span', { class: `br-seg s${i % 4}${o.rare ? ' rare' : ''}`, title: `${o.name} ${o.pct}%` });
      seg.style.width = `${o.pct}%`;
      bar.append(seg);
      legend.append(
        el('span', { class: `br-legend-item${o.rare ? ' rare' : ''}` }, el('span', { class: `br-dot s${i % 4}${o.rare ? ' rare' : ''}` }), `${o.name} ${o.pct}%`),
      );
    });
    table.append(el('div', { class: 'br-trait' }, el('span', { class: 'br-trait-label' }, t.label), bar, legend));
  }
  const columns = el('div', { class: 'br-odds-columns' });
  columns.append(el('div', {}, table));

  // Likely looks (sampled, grouped by what reads at a glance).
  const rng = createRng(hashIds(a.id, b.id));
  const counts = new Map<string, { genome: Genome; n: number }>();
  const SAMPLES = 400;
  for (let i = 0; i < SAMPLES; i += 1) {
    const genome = sampleChild(a.genome, b.genome, rng);
    const key = phenoKey(genome);
    const entry = counts.get(key);
    if (entry) entry.n += 1;
    else counts.set(key, { genome, n: 1 });
  }
  const top = [...counts.values()].sort((x, y) => y.n - x.n).slice(0, 6);
  const row = el('div', { class: 'br-gallery' });
  const previewRng = createRng(42);
  for (const { genome, n } of top) {
    const sample = createDuck(previewRng, { genome, stage: 'adult', pos: { x: 0, y: 0 }, sex: 'F', name: 'preview' });
    const key = breedKey(genome);
    const isNew = !state.breedBook[key];
    row.append(
      el(
        'div',
        { class: `br-look${isNew ? ' new' : ''}`, title: breedLabel(key) },
        duckPortrait(sample, 50),
        el('span', { class: 'br-look-pct' }, `${Math.round((n / SAMPLES) * 100)}%`),
        isNew ? el('span', { class: 'br-look-new' }, 'NEW') : null,
      ),
    );
  }
  columns.append(el('div', {}, el('div', { class: 'br-subtitle' }, 'Likely looks'), row));
  box.append(columns);

  const scope = upgradeLevel(state, 'pedigreeScope') > 0;
  box.append(
    el(
      'div',
      { class: 'muted hint' },
      scope
        ? 'Odds are exact from both genotypes; mutation (2% per gene) can still surprise.'
        : 'Odds use each parent’s true genes — the Pedigree Scope lets you read them too.',
    ),
  );
  return box;
}

// ---------------------------------------------------------------------------

function nestSection(ctx: PanelCtx): HTMLElement {
  const { game } = ctx;
  const state = game.state;
  const ducks = state.ducks;
  const eggs = ducks.filter((d) => d.stage === 'egg');
  const clutches = state.pendingClutches;
  const box = el('div', { class: 'br-nest' });
  if (eggs.length === 0 && clutches.length === 0) {
    box.append(
      el(
        'div',
        { class: 'br-empty' },
        icon('egg', 22),
        el('div', {}, 'The nest is empty. Pair two adults and the hen lays here after an hour of courtship.'),
      ),
    );
    return box;
  }

  if (clutches.length > 0) {
    box.append(el('div', { class: 'br-section-title' }, 'Courting'));
    const grid = el('div', { class: 'nest-grid' });
    for (const clutch of clutches) {
      const mother = ducks.find((d) => d.id === clutch.motherId);
      const father = ducks.find((d) => d.id === clutch.fatherId);
      const mins = Math.ceil(clutch.ticksRemaining / TICKS_PER_MINUTE);
      const pct = clamp((1 - clutch.ticksRemaining / (60 * TICKS_PER_MINUTE)) * 100, 0, 100);
      const odds = mother && father ? Math.round(pairViability(state, mother, father) * 100) : null;
      const fill = el('div', { class: 'bar-fill' });
      fill.style.width = `${pct}%`;
      fill.style.background = '#e37ba3';
      grid.append(
        el(
          'div',
          { class: 'nest-card courting' },
          el(
            'div',
            { class: 'nest-card-top' },
            mother ? duckPortrait(mother, 40) : icon('heartOutline', 16),
            el('span', { class: 'br-heart' }, icon('heart', 14)),
            father ? duckPortrait(father, 40) : icon('heartOutline', 16),
          ),
          el('div', { class: 'nest-card-title' }, `${mother?.name ?? '?'} & ${father?.name ?? '?'}`),
          el('div', { class: 'bar bar-thin', title: 'Courtship' }, fill),
          el(
            'div',
            { class: 'muted small' },
            `egg in ${mins}m`,
            odds !== null ? el('span', { class: odds >= 80 ? 'ok-text' : odds >= 60 ? '' : 'warn-text' }, ` · ${odds}% odds`) : null,
          ),
          el('div', { class: 'muted small' }, 'Feed and pet them now — the roll happens at lay time.'),
        ),
      );
    }
    box.append(grid);
  }

  if (eggs.length > 0) {
    box.append(el('div', { class: 'br-section-title' }, `Incubating · ${eggs.length}`));
    const grid = el('div', { class: 'nest-grid' });
    const target = eggIncubationTicks(state);
    for (const egg of eggs) {
      const pct = Math.min(100, (egg.incubationTicks / target) * 100);
      const warmth = eggWarmth(egg);
      const speed = eggSpeedFor(warmth);
      const fill = el('div', { class: 'bar-fill' });
      fill.style.width = `${pct}%`;
      fill.style.background = '#e8b83a';
      const warmFill = el('div', { class: 'bar-fill' });
      warmFill.style.width = `${warmth}%`;
      warmFill.style.background = warmth > 40 ? '#e0893a' : '#6aa0d8';
      const mother = egg.parents ? ducks.find((d) => d.id === egg.parents![0]) : undefined;
      const father = egg.parents ? ducks.find((d) => d.id === egg.parents![1]) : undefined;
      const minsLeft = Math.ceil((target - egg.incubationTicks) / speed / TICKS_PER_MINUTE);
      grid.append(
        el(
          'div',
          { class: `nest-card${egg.readyToHatch ? ' ready' : ''}` },
          el(
            'div',
            { class: 'nest-card-top' },
            duckPortrait(egg, 40),
            el(
              'div',
              { class: 'nest-card-id' },
              el('div', { class: 'nest-card-title' }, egg.readyToHatch ? 'Cracking!' : `${pct.toFixed(0)}%`),
              el('div', { class: 'muted small' }, mother || father ? `${mother?.name ?? '?'} × ${father?.name ?? '?'}` : 'wild clutch'),
            ),
          ),
          el('div', { class: 'nest-bar-row' }, icon('egg', 10), el('div', { class: 'bar bar-thin', title: 'Incubation' }, fill), el('span', { class: 'muted small nest-mins' }, egg.readyToHatch ? 'now' : `~${minsLeft}m`)),
          el('div', { class: 'nest-bar-row' }, icon('sparkle', 10), el('div', { class: 'bar bar-thin', title: 'Warmth — tuck to restore' }, warmFill), el('span', { class: `muted small nest-mins${warmth < 40 ? ' warn-text' : ''}` }, `${Math.round(warmth)}%`)),
          el(
            'div',
            { class: 'br-egg-actions' },
            egg.readyToHatch
              ? el('button', { class: 'small-btn primary', onclick: () => { claimHatch(state, game.rng, egg.id); ctx.ui.refreshPanel(); } }, 'Hatch!')
              : el('button', { class: 'small-btn', disabled: egg.petCooldownTicks > 0, title: egg.petCooldownTicks > 0 ? 'Tucked in recently' : 'Restore warmth', onclick: () => { tuckEgg(state, egg.id); ctx.ui.refreshPanel(); } }, 'Tuck in'),
            el('button', { class: 'small-btn', onclick: () => { sellDuck(state, egg.id); ctx.ui.refreshPanel(); } }, 'Sell ', icon('coin', 10), `${sellPrice(state, egg)}`),
          ),
        ),
      );
    }
    box.append(grid);
  }
  return box;
}

// Inheritance without mutation, for preview purposes.
function sampleChild(a: Genome, b: Genome, rng: ReturnType<typeof createRng>): Genome {
  const child = {} as Genome;
  for (const def of LOCI) {
    child[def.id] = [a[def.id][rng.int(2)], b[def.id][rng.int(2)]];
  }
  return child;
}

// Group by the traits that read at a glance (colors, pattern, crest) so the
// percentages stay meaningful; size/bill morphs vary within each group.
function phenoKey(genome: Genome): string {
  const p = computePhenotype(genome);
  return [p.bodyColor, p.pattern, p.patternColor, p.crested, p.billColor].join('|');
}

function hashIds(a: string, b: string): number {
  let h = 2166136261;
  for (const ch of a + '|' + b) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
