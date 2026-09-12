// Every tuning number that isn't a price lives here, grouped by the system
// that reads it. BALANCE (economy.ts) holds prices and payouts; this holds
// rates, chances, radii, and thresholds. Modules bind their old local names
// to these so the code reads the same — the point is one place to look.
import { TICKS_PER_HOUR, TICKS_PER_MINUTE } from './time';

export const TUNING = {
  // Feed effects live here (not in BALANCE) because food.ts builds its table
  // at module load, and economy.ts sits inside an import cycle with it.
  care: {
    // The Bath House scrubs ducks below this at dawn, one soap each.
    bathThreshold: 60,
    // The Treat Dispenser hands a treat each hour to ducks below this.
    dispenserThreshold: 70,
  },
  visitors: {
    // Wild ducks only drop in on a clean pond; the HUD, the daybook, and the
    // dawn card all quote this so the number lives here.
    inviteCleanliness: 70,
  },
  food: {
    feedRestore: 40,
    premiumFeedRestore: 60,
    premiumFeedHappiness: 5,
  },
  needs: {
    // Decay rates per game-hour.
    hungerDecay: 6,
    cleanDecay: 3,
    happyDecay: 2,
    starvingHealthDrain: 3,
    starvingHappyDrain: 2,
    sickHappyDrain: 5,
    sickHealthDrain: 4,
    overcrowdHappyDrain: 0.6, // per excess duck per hour, capped at 6 excess
    harriedHenDrain: 0.7, // per surplus drake per hour
    squabbleDrain: 0.3,
    pressureViabilityPenalty: 0.06, // per surplus drake
    healthRegen: 1,
    sicknessBaseChance: 0.02, // per hour when cleanliness < 30
    contagionChance: 0.01, // per sick pond-mate per hour
    nightScale: 0.3, // needs drift at 30% overnight
    winterHungerScale: 1.5,
    // Best friends: a bonded (mutual) pair courts a little better.
    bondedViabilityBonus: 0.05,
  },
  // The nest: a clutch is several eggs, each rolling viability on its own,
  // and the nest is measured in clutches (see nest.ts). An egg whose warmth
  // averaged below chillWarmth over its incubation never hatches — the
  // stakes that make tucking a real chore until the Incubator takes it over.
  nest: {
    clutchSize: 3,
    chillWarmth: 35,
  },
  laying: {
    start: 7, // hour
    end: 17,
    maxLooseEggs: 6,
    happinessNeeded: 55, // ±10 by temperament
    temperSwing: 20,
  },
  bugs: {
    maxCritters: 3, // beetles + snails
    maxFireflies: 3,
    maxFeathers: 4,
    maxDuckweed: 3,
    critterLifetime: 2 * TICKS_PER_HOUR,
    // Aim for roughly one spawn every ~20 game-minutes while below the cap.
    critterSpawnChance: 1 / (20 * TICKS_PER_MINUTE),
    fireflySpawnChance: 1 / (15 * TICKS_PER_MINUTE),
    // A flock molts a feather every ~2 game-hours, and weed sprouts every ~3.
    featherSpawnChance: 1 / (2 * TICKS_PER_HOUR),
    duckweedSpawnChance: 1 / (3 * TICKS_PER_HOUR),
    duckEatDistance: 16,
    catchRadius: 18,
    // Pond life: a frog on the rim, a dragonfly over the water (daytime).
    maxPondLife: 2,
    pondLifeSpawnChance: 1 / (25 * TICKS_PER_MINUTE),
  },
  elders: {
    broodyPerHen: 0.25, // egg-warmth decay removed per elder hen
    broodyMaxHens: 2,
    mentorRadius: 140,
    mentorHappyScale: 0.7,
  },
  race: {
    boostCooldownMs: 550,
    // A paddle adds a share of the racer's OWN base speed, so taps amplify
    // the duck rather than replace it. Boost decays by 0.15^dt (k ≈ 1.9/s);
    // perfect paddles every 550ms settle at 0.42/0.55/1.9 ≈ +40% of base,
    // against a genetic spread of roughly 0.74×–1.37× — the derby stays a
    // payoff for a well-bred flock, with hands worth less than genes.
    playerBoost: 0.42,
    aiHitsPerSec: 1.6,
    // Wild racers: 1.6 hits/s × (0.22 + 0.08) ≈ 0.48 base/s → ≈ +25%.
    aiBoostMin: 0.22,
    aiBoostVar: 0.16,
    meterPeriodMs: 210,
    baseSpeed: 52,
  },
  lifeEvents: {
    rollHour: 11,
    expireHour: 20,
    chance: 0.3,
    broodyWarmthScale: 0.5,
    rivalryTreats: 2,
  },
  marks: {
    hardyWarmth: 0.7,
    scrappyWarmth: 0.35,
    steadyMentorShare: 0.25,
    spoiledTreats: 3,
  },
  rivals: {
    flockSize: 6,
    trainingPerSeason: 6,
    trainingPerYear: 2, // extra per season, per year of play
    pointsBase: 8, // seasonal Society-equivalent points a rival earns
    pointsPerYear: 3,
    pointsPerWin: 2,
  },
  cup: {
    entryPoints: 40,
    prizeBase: 300, // coins × year for the winner
    minRank: 5,
  },
  // The Line (line.ts): what makes a Champion and what one is worth.
  line: {
    championGen: 3, // generations bred on the line a champion needs
    championPoints: 6, // Society points — between a Standard (4) and a Master (8)
    championCoins: 50,
    championCupPoints: 10, // on top of the Society points the Cup already counts
    hallCap: 150, // Hall records kept (each carries a genome)
  },
} as const;
