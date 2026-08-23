// Lineage: who a duck came from, stamped on the egg at lay time so it
// survives the parents being sold or dying. Two generations are kept with
// genomes (enough for a family tree and for "pure" breeding checks).
import type { Sex } from '../types';
import type { Duck } from './duck';
import type { Genome } from './genetics';
import type { GameState } from '../state';

export interface Ancestor {
  id: string;
  name: string;
  sex: Sex;
  genome: Genome;
}

export interface Lineage {
  gen: number; // 0 = founder (starter, adopted, wild); +1 per generation bred on this pond
  sire: Ancestor | null;
  dam: Ancestor | null;
  // Grandparents in order: dam's dam, dam's sire, sire's dam, sire's sire.
  grand: Array<Ancestor | null>;
}

export function founderLineage(): Lineage {
  return { gen: 0, sire: null, dam: null, grand: [null, null, null, null] };
}

function ancestorOf(duck: Duck): Ancestor {
  return { id: duck.id, name: duck.name, sex: duck.sex, genome: duck.genome };
}

export function lineageFrom(mother: Duck, father: Duck): Lineage {
  const ml = mother.lineage ?? founderLineage();
  const fl = father.lineage ?? founderLineage();
  return {
    gen: Math.max(ml.gen, fl.gen) + 1,
    dam: ancestorOf(mother),
    sire: ancestorOf(father),
    grand: [ml.dam, ml.sire, fl.dam, fl.sire],
  };
}

export function generationOf(duck: Duck): number {
  return duck.lineage?.gen ?? 0;
}

// Living descendants (children, grandchildren) of a duck, by id.
export function livingDescendants(state: GameState, duckId: string): Duck[] {
  return state.ducks.filter((d) => {
    const l = d.lineage;
    if (!l) return false;
    if (l.sire?.id === duckId || l.dam?.id === duckId) return true;
    return l.grand.some((g) => g?.id === duckId);
  });
}

// Are these two ducks close kin (share a parent, or one is the other's
// parent)? Used to flag inbreeding in the Breed panel.
export function closeKin(a: Duck, b: Duck): boolean {
  const la = a.lineage;
  const lb = b.lineage;
  if (la && (la.sire?.id === b.id || la.dam?.id === b.id)) return true;
  if (lb && (lb.sire?.id === a.id || lb.dam?.id === a.id)) return true;
  if (la && lb) {
    const pa = [la.sire?.id, la.dam?.id].filter(Boolean);
    const pb = [lb.sire?.id, lb.dam?.id].filter(Boolean);
    if (pa.some((id) => pb.includes(id))) return true;
  }
  return false;
}
