import type { Duck } from '../sim/duck';

export interface AnimState {
  bob: number; // vertical offset
  bodyTilt: number; // radians; positive = nose down
  legPhase: number; // 0..1 walking cycle
  headDip: number; // 0..1+, head lowered toward ground/water
  headBob: number; // forward/back head pump while walking
  billOpen: number; // 0..1
  wingFlap: number; // radians of wing rotation
  tailWag: number; // radians of tail rotation
  headTuck: number; // 0..1 sleeping tuck
  headBack: number; // 0..1 preening turn
  raise: number; // 0..1 neck stretched tall (flapping, quacking)
  blink: boolean;
}

// All animation is derived from wall-clock time + a per-duck phase hash, so it
// needs no stored state and stays smooth across save/load. The phase offset
// also desynchronizes the flock so ducks never move in lockstep.
export function computeAnim(duck: Duck, timeMs: number): AnimState {
  const phase = idHash(duck.id);
  const t = timeMs / 1000 + phase * 10;
  const anim: AnimState = {
    bob: 0,
    bodyTilt: 0,
    legPhase: 0,
    headDip: 0,
    headBob: 0,
    billOpen: 0,
    wingFlap: 0,
    tailWag: 0,
    headTuck: 0,
    headBack: 0,
    raise: 0,
    blink: false,
  };

  switch (duck.activity) {
    case 'waddle':
      anim.legPhase = (t * 2.2) % 1;
      anim.bodyTilt = Math.sin(t * 2.2 * Math.PI * 2) * 0.09;
      anim.bob = Math.abs(Math.sin(t * 2.2 * Math.PI * 2)) * 1.5;
      // Pigeon-style head pump synced to the steps.
      anim.headBob = Math.sin(t * 2.2 * Math.PI * 2 + Math.PI / 2) * 2.6;
      break;
    case 'swim':
      anim.bob = Math.sin(t * 2.5) * 1.8;
      anim.bodyTilt = Math.sin(t * 1.7) * 0.04;
      // Gentle head sway while paddling.
      anim.headBob = Math.sin(t * 1.3) * 1.2;
      break;
    case 'dabble':
      // Classic bottoms-up: tail high, head plunged under the waterline.
      anim.bodyTilt = -0.28;
      anim.headDip = 1.5 + Math.sin(t * 7) * 0.15;
      anim.tailWag = Math.sin(t * 9) * 0.22;
      anim.bob = 2;
      break;
    case 'eat':
      anim.headDip = Math.max(0, Math.sin(t * 6)) * 0.9;
      anim.billOpen = Math.max(0, Math.sin(t * 12)) * 0.6;
      anim.legPhase = (t * 2.6) % 1;
      // Excited tail wiggle between pecks.
      anim.tailWag = Math.sin(t * 14) * 0.14;
      break;
    case 'forage':
      // Head down in the grass, bill working, a slow step, tail twitching.
      anim.headDip = 0.55 + Math.max(0, Math.sin(t * 4.5)) * 0.5;
      anim.billOpen = Math.max(0, Math.sin(t * 9 + 1)) * 0.45;
      anim.legPhase = (t * 0.9) % 1;
      anim.bodyTilt = 0.08 + Math.sin(t * 4.5) * 0.03;
      anim.tailWag = Math.sin(t * 7) * 0.1;
      anim.bob = Math.abs(Math.sin(t * 0.9 * Math.PI * 2)) * 0.6;
      break;
    case 'sleep':
      anim.headTuck = 1;
      anim.bob = Math.sin(t * 0.9) * 0.8;
      break;
    case 'preen':
      // Head turned around, working up and down through the wing feathers,
      // bill nibbling as it goes.
      anim.headBack = 0.7 + Math.sin(t * 4) * 0.25;
      anim.billOpen = Math.max(0, Math.sin(t * 8)) * 0.35;
      anim.wingFlap = Math.max(0, Math.sin(t * 5)) * 0.12;
      anim.tailWag = Math.sin(t * 5.5) * 0.12;
      break;
    case 'flap':
      // Rear up, stretch the neck, and beat the wings.
      anim.raise = 1;
      anim.wingFlap = Math.abs(Math.sin(t * 11)) * 0.95;
      anim.bob = Math.abs(Math.sin(t * 11)) * 2.2;
      anim.bodyTilt = -0.12;
      anim.billOpen = 0.25;
      break;
    case 'shake':
      // Fast whole-body shiver, shedding water.
      anim.bodyTilt = Math.sin(t * 26) * 0.13;
      anim.headBob = Math.sin(t * 24) * 2.5;
      anim.tailWag = Math.sin(t * 28) * 0.35;
      break;
    case 'idle': {
      anim.bob = Math.sin(t * 1.3) * 0.7;
      // Occasional flourishes, staggered per duck: a quack with a raised
      // head, a curious head tilt, or a little tail wag.
      const flourish = Math.sin(t * 0.43);
      if (flourish > 0.93) {
        anim.billOpen = 0.5;
        anim.raise = 0.6;
      } else if (flourish < -0.94) {
        anim.headBob = 2;
        anim.bodyTilt = 0.05;
      }
      if (Math.sin(t * 0.31 + 2) > 0.9) anim.tailWag = Math.sin(t * 10) * 0.2;
      break;
    }
    case 'sit':
      break;
  }

  // Blink every few seconds (not while sleeping or underwater).
  if (duck.activity !== 'sleep' && duck.activity !== 'dabble') {
    const blinkCycle = (t * 0.34) % 1;
    anim.blink = blinkCycle < 0.035;
  }

  // Unhappy ducks droop.
  if (duck.stage !== 'egg' && duck.needs.happiness < 25 && duck.activity !== 'sleep') {
    anim.headDip = Math.max(anim.headDip, 0.35);
    anim.bodyTilt += 0.05;
  }
  return anim;
}

function idHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}
