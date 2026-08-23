// Dev-only gene lab (open with ?lab): renders a grid of random genomes and
// lets you breed any two to inspect inheritance visually.
import { createRng } from './rng';
import { createDuck, type Duck } from './sim/duck';
import { breed, formatGenotype, randomCommonGenome, LOCI } from './sim/genetics';
import { el } from './ui/dom';
import { icon } from './ui/icons';
import { duckPortrait } from './ui/portrait';

export function runLab(): void {
  document.getElementById('pond-canvas')?.remove();
  const root = document.getElementById('ui-root')!;
  root.className = 'lab-root';

  const rng = createRng(1234);
  let ducks: Duck[] = [];
  let parentA: Duck | null = null;
  let parentB: Duck | null = null;

  const grid = el('div', { class: 'lab-grid' });

  const makeDuck = (genome = randomCommonGenome(rng)): Duck =>
    createDuck(rng, { genome, stage: 'adult', pos: { x: 0, y: 0 } });

  // Seed with random genomes plus a few extreme/rare showcases.
  const showcase = () => {
    ducks = [];
    for (let i = 0; i < 20; i += 1) ducks.push(makeDuck());
    const rare = randomCommonGenome(rng);
    rare.baseColor = ['B', 'B'];
    rare.crest = ['R', 'R'];
    rare.billColor = ['P', 'y'];
    rare.dilution = ['d', 'd'];
    ducks.push(makeDuck(rare));
    const tiny = randomCommonGenome(rng);
    for (const id of ['size1', 'size2', 'size3'] as const) tiny[id] = ['-', '-'];
    tiny.pattern = ['p', 'p'];
    ducks.push(makeDuck(tiny));
    render();
  };

  const render = () => {
    grid.replaceChildren();
    for (const duck of ducks) {
      const selected = duck === parentA || duck === parentB;
      const cell = el(
        'button',
        {
          class: `lab-cell${selected ? ' selected' : ''}`,
          onclick: () => {
            if (parentA === duck) parentA = null;
            else if (parentB === duck) parentB = null;
            else if (!parentA) parentA = duck;
            else if (!parentB) parentB = duck;
            else parentA = duck;
            render();
          },
        },
        duckPortrait(duck, 80),
        el('code', { class: 'small' }, formatGenotype(duck.genome)),
      );
      grid.append(cell);
    }
  };

  root.append(
    el(
      'div',
      { class: 'lab-toolbar' },
      el('strong', { class: 'with-icon' }, icon('duck', 18), 'Gene Lab'),
      el('button', { class: 'action-btn', onclick: showcase }, 'Reroll genomes'),
      el(
        'button',
        {
          class: 'action-btn',
          onclick: () => {
            if (!parentA || !parentB) return;
            for (let i = 0; i < 6; i += 1) {
              ducks.push(makeDuck(breed(parentA.genome, parentB.genome, rng)));
            }
            render();
          },
        },
        'Breed selected ×6',
      ),
      el('span', { class: 'muted small' }, `${LOCI.length} loci · click two ducks, then breed`),
      el('a', { href: location.pathname }, '← back to game'),
    ),
    grid,
  );
  showcase();
}
