# Duck Homestead

Browser game (TypeScript, Vite, no runtime deps) plus a Cloudflare Worker for
cloud save sync. README.md explains the game; GENETICS.md the inheritance
model. This file is the working agreement for changes.

## Commands

- `npm run dev` — game on :5173. `npm run dev:worker` — sync API on :8787 (Vite proxies `/api`).
- `npm run ci` — typecheck (game + worker), lint, tests, build. Keep it green; CI runs exactly this.
- `npm test` — vitest. `src/sim/soak.test.ts` runs 1.5 game-years and takes ~12s; that is deliberate.
- `npm run deploy` — build + `wrangler deploy`.

## Layout

- `src/sim/` — the simulation. Pure functions `tickX(state, rng)` mutate `GameState` in place. All randomness goes through the seeded `Rng` (never `Math.random`, never `Date.now`) so a seed replays exactly. Tunable numbers live in `src/sim/tuning.ts`.
- `src/ui/` — DOM panels built with `el()` from `src/ui/dom.ts`; strings become text nodes (there is no innerHTML anywhere — keep it that way). `src/render/` — canvas. `src/companion/` — the phone view: a check-in device that never replaces the desktop (peek / take the reins / release).
- `src/save/save.ts` — envelope + migration chain. Bump `STATE_VERSION` in `src/state.ts` and add a `MIGRATIONS[n]` step when the saved shape changes; `deserialize` also heals old shapes with `??=` backfills.
- `src/sync/` — cloud sync client. `syncPlan.ts` holds the pure decisions; `sync.ts` the attachment (push on `saved`, poll, handoff on pagehide).
- `worker/` — its own tsconfig; must not import from `src/`. `protocol.ts` is pure and tested; `worker/api.test.ts` drives the routes against an in-memory Durable Object fake.

## Conventions

- ESLint + strict tsc are the style guide. `no-explicit-any` is on outside tests.
- Comments explain *why*, in prose. Commit messages are one plain sentence describing the player-visible change.
- Don't add dependencies for things a few lines can do; the game ships zero runtime packages.
