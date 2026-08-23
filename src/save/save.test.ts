import { describe, expect, it } from 'vitest';
import { createNewGame } from '../state';
import { tickLifecycle } from '../sim/lifecycle';
import { tickNeeds } from '../sim/needs';
import { deserialize, serialize } from './save';

describe('save round-trip', () => {
  it('deserialize(serialize(state)) preserves the whole game state', () => {
    const { state, rng } = createNewGame(1234);
    // Advance the sim a bit so the state isn't trivially fresh.
    for (let i = 0; i < 500; i += 1) {
      state.clock.totalTicks += 1;
      tickNeeds(state, rng);
      tickLifecycle(state, rng);
    }
    state.rngState = rng.getState();

    const restored = deserialize(serialize(state));
    expect(restored).toEqual(state);
  });

  it('rejects unknown save versions', () => {
    const { state } = createNewGame(1);
    const json = serialize(state).replace('"version":1', '"version":99');
    expect(() => deserialize(json)).toThrow(/unknown save version/i);
  });
});
