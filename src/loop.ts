const TICK_MS = 100; // 10 Hz simulation

const MAX_CATCHUP_TICKS = 50;

// Fixed-timestep accumulator loop. `tick` advances the simulation; `render`
// draws with an interpolation alpha in [0,1] between the last two ticks.
export function startLoop(
  tick: () => void,
  render: (alpha: number) => void,
  getSpeed: () => number,
): void {
  let last = performance.now();
  let acc = 0;

  const frame = (now: number) => {
    const speed = getSpeed();
    acc += (now - last) * speed;
    last = now;

    let ticks = 0;
    while (acc >= TICK_MS && ticks < MAX_CATCHUP_TICKS) {
      tick();
      acc -= TICK_MS;
      ticks += 1;
    }
    if (ticks >= MAX_CATCHUP_TICKS) acc = 0; // drop backlog after tab sleep

    render(speed === 0 ? 1 : Math.min(1, acc / TICK_MS));
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
