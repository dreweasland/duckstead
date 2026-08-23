# Duck Simulator

A browser game where you breed, raise, and care for ducks. Every duck is drawn
procedurally from its genes — no art assets — so selective breeding visibly
changes your flock: plumage colors, patterns, size, bill shape, and the coveted
crest pom-pom.

## Play

```bash
npm install
npm run dev        # open http://localhost:5173
```

- **Click a duck** to inspect it: needs, genetics, care actions, sell price.
- **Feed** — click the Feed (or Premium) button, then click anywhere on
  the map to toss food. Hungry ducks will swim/waddle over and eat it.
- **Treats** — peas, worms, and berries from the shop. Every duck secretly
  loves one of them: the first time it eats its favourite you get a heart
  burst and it's written on the duck's card. Favourites restore 1.5× hunger
  and add happiness. The Treats button picks which to toss; the duck card
  hand-feeds whatever you have in stock.
- **Goals** unlock the game step by step — Breeding after you've petted the
  flock, the Shop after your first egg, the Breed Book and Pond Derby after
  your first hatch. Saves that have already done those things see everything.
- **Breed** — open the Breed panel and click two adults on the pond (or use
  the chooser, which sorts by readiness and how many new breeds each pairing
  could unlock). The pair's genetics sit side by side — swatches, traits,
  and with the Pedigree Scope their allele tiles and carried recessives —
  above a **clutch viability** gauge (happiness × health, rolled when the
  egg is laid; feed and pet them during the hour-long courtship to tip it)
  and exact **clutch odds** per trait (color, pattern, shade, crest, bill)
  plus a gallery of likely looks. The hen then lays an egg at the nest.
- **Tend eggs** — an egg's warmth drifts down; click it to tuck it into the
  straw (one tuck per game-hour per egg). Warm eggs incubate faster and hatch
  content; cold eggs are slow and hatch hungry. A fully incubated egg cracks
  and rocks — click it to hatch (it hatches on its own after a game-hour).
  The Incubator holds warmth at full.
- **Shop** — buy feed, medicine, new ducks, and upgrades (nesting boxes,
  incubator, pond expansion, filter, toy, and the Pedigree Scope which reveals
  exact genotypes). Late-game sinks scale with the flock: Reed Beds (more
  forage), Feed Silo (bigger self-filling trough), Egg Cooler (+25% basket
  eggs per level), Brooder Lamp (faster, happier young), Training Perch
  (+4% race speed per level), Vet Clinic (half the sickness, double
  medicine), and **festival sponsorship** — pay to raise the next festival
  a tier for a year.
- **Breed Book** — a 60-entry compendium of every phenotype combo you've
  hatched, with discovery rewards for new breeds.
- **Race** — the Pond Derby: your duck's vigor, energy, and build set its
  speed; time your paddle boosts to win prize money. Wild racers paddle like
  a competent player and precision matters (sloppy taps barely help), and
  each duck races once a day — so breeding fast ducks is the way to a
  winning stable. Festival tournaments ignore the daily limit.
- **Visitors** — rare
  wild ducks visit well-kept ponds (pond cleanliness above 70% — watch the
  HUD chip and scrub when it dips; befriend them with premium treats, you
  start with three). Your first wild visitor is guaranteed on day 2.
- **Festivals** — one per season: Spring Egg Show, Summer Derby Grand Prix,
  Autumn Market Day, Winter Lights.
- **Decorations** — lanterns, benches, gnomes and more; they cheer the flock
  and help attract wild visitors. Click a placed decoration to pick it up
  and click the grass to set it down again (Esc cancels). Ducks form friendships and celebrate
  birthdays.
- **Hens lay** — every adult hen that's fed and content drops one
  unfertilised egg a day on the grass (on the bank if she's swimming). Tap
  to gather it into your **egg basket** and sell the basket at the shop —
  a steady income that doesn't cost you a fertilised egg. Autumn and
  Market Day pay more.
- **Flock balance** — ducks keep best at one drake per three hens (two
  drakes are always fine). Surplus drakes harry the hens: happiness drains,
  hens skip laying, clutch viability drops 6% per extra drake. The Flock
  panel shows the ratio; pond sizes 8/12/16/20 fit 2/3/4/5 drakes exactly.
- **Pond capacity** counts hatched ducks; eggs and courting pairs live in
  the nest, so the nest keeps running at a full pond. Hatch over the limit
  and the pond is **overcrowded**: the flock gets stressed, the water fouls
  faster, and wild ducks stay away until you sell or expand. Nesting boxes
  add egg slots *and* keep eggs warm (−25% warmth loss per level).
- **Forage** — tap what you find on the grass: beetles and snails by day
  (coins; a nearby duck may eat one first), fireflies by night, **feathers**
  molted by your own ducks (coins + a Feather Album entry in the Book), and
  **duckweed** on the pond rim (free feed). Feathers and duckweed never
  expire, so there's always something to gather after a fast-forward.
- **Dawn report** — at 06:00 a briefing card lists the day's opportunities:
  buyer at the gate, wild visitor, cracking or cold eggs, courting pairs,
  festival countdown, hungry ducks, pond state. At night a **Sleep 'til
  dawn** button skips straight to it.
- **Pedigree & lineage** — every egg is stamped with two generations of
  ancestry (it survives the parents leaving). A duck's **pedigree score**
  (generations bred here, fixed Book genes, rare alleles, purebred parents)
  raises its sale price and is shown with a family tree on its card. Close
  kin throw less vigorous clutches. Birthdays come every season.
- **Breed standards** — each of the 60 breeds has a 13-locus show standard
  (its own build: size, bill, bill colour, markings, vigor). The duck card
  shows % match; the Breed Book's award ladder pays for **Pure** (both
  parents the breed), **Standard** (90% match alive) and **Master** (five
  alive) — 180 awards, each worth coins and Society points.
- **Commissions board** (Shop → Board, open from day one) — breeders post
  contracts for a breed, starting as plain "wants a Spotted Mallard"
  requests and growing demands as you fill them (sex, generation, standard
  %, pink bill). Deliver from the duck's card for several times market price
  plus Society points. If nobody on the pond fits, the card names the pair
  most likely to hatch one and the chance per egg. Open commissions also
  show under Goals.
- **Duck Fanciers' Society** (Shop → Society) — twenty ranks paid with coins
  *and* Society points (awards, commissions, festival placings, derby
  promotions, discoveries — never coins). Ranks unlock pond styles (water,
  lilies, grass, hutch), titles for your top-pedigree duck, a champion
  statue, commissioned stock (order a duck with a chosen rare gene), an
  extra nest slot, richer wild visitors, and a golden egg basket.
- **Derby league** — daily races sit in Pond → County → National tiers
  (bigger purses, tougher fields; National takes show-standard ducks only).
  Three net wins promote, three net losses relegate.
- **Festivals that scale** — Egg Show rivals are built from the breeds you've
  already shown and judges score against the standard; the Grand Prix field
  matches your best racer. Win and next year's edition is County, then
  Regional, then National, with bigger purses. Winter Lights ends with a
  wish of your choosing.
- **Chronicle & Records** (Book tabs) — an auto-written history of the pond
  (new breeds, champions, farewells with descendants) and lifetime records.
- **Heritage** (Save panel) — once the Book has 10 breeds, retire the pond
  and refound it with one drake and one hen. Book, awards, Society, chronicle
  and records carry over; each retirement adds a nest slot and +1% mutation.
- **Speed controls** — ⏸ / 1× / 4× / 16×. One game-day = 24 real minutes at 1×.
  The game autosaves to localStorage every 30 seconds; it only runs while the
  tab is visible (no offline progress).

### Gene Lab (dev tool)

Open `http://localhost:5173/?lab` for a grid of random genomes — click two
ducks, then "Breed selected" to inspect inheritance without playing the game.

## How the genetics work

Each duck has a diploid genome across 13 loci:

| Trait | Kind | Notes |
|---|---|---|
| Base color | Mendelian | M mallard > W white > k black; **B blue** is rare and blends codominantly with M |
| Dilution | Mendelian | `dd` = pastel (40% lighter) |
| Pattern | Mendelian | solid > spotted > capped |
| Pattern color | Mendelian | dark or white markings |
| Size | Additive ×3 loci | 75%–130% body scale |
| Bill shape | Additive ×2 loci | stubby ↔ long |
| Bill color | Mendelian | orange > yellow; **P pink** is rare |
| Crest | Recessive | only `RR` grows the pom-pom |
| Vigor | Additive ×2 loci | lifespan ±20%, sickness resistance |

Inheritance is one random allele per parent per locus, with a 2% mutation rate
per allele — mutation is the *only* way rare alleles (blue, pink bill) enter a
fresh flock. Starter ducks each hide at least one recessive, so early clutches
produce surprises. Adult mallard-expressing males grow green heads; ducklings
wear yellow fluff that conceals their true colors until the juvenile molt.

Care quality feeds back into breeding: egg viability is the average of the
parents' happiness and health, so a neglected flock breeds poorly.

## Deploying

The game is a static Vite build (`dist/`), hosted on **Cloudflare Pages**.

- **CI** (`.github/workflows/ci.yml`) type-checks, runs the test suite, and
  builds on every push and pull request.
- **Deploy** — easiest is Cloudflare's Git integration: in the Cloudflare
  dashboard, Workers & Pages → Create → Pages → connect this GitHub repo with
  build command `npm run build` and output directory `dist`. Every push to
  `main` goes live and every PR gets a preview URL. (Node version is pinned
  by `.nvmrc`.)
- Alternatively `.github/workflows/deploy.yml` publishes from GitHub Actions
  with Wrangler; set repository variable `CLOUDFLARE_PAGES_PROJECT` and
  secrets `CLOUDFLARE_API_TOKEN` (Pages: Edit) + `CLOUDFLARE_ACCOUNT_ID`. If
  you use the Git integration instead, delete that workflow.
- `public/_headers` makes Pages cache hashed assets for a year and never
  cache `index.html`, so new builds show up immediately.

## Development

```bash
npm test           # vitest suite (genetics ratios, needs, lifecycle, economy, save round-trip, 1.5-year soak)
npm run build      # type-check + production bundle
```

Architecture: fixed-timestep simulation at 10 Hz with interpolated
requestAnimationFrame rendering. All game state is one plain JSON-safe object
(`src/state.ts`); systems are pure-ish functions run in order each tick
(`src/game.ts`). The pond scene is Canvas 2D; panels/HUD are a DOM overlay.
Key files:

- `src/sim/genetics.ts` — loci, breeding, mutation, genotype→phenotype
- `src/render/duckPainter.ts` — phenotype → procedural canvas drawing
- `src/sim/needs.ts` — care mechanics and the breeding gate
- `src/sim/economy.ts` — all balance numbers in one `BALANCE`/`UPGRADES` table
- `src/save/save.ts` — versioned localStorage saves with export/import

## Playtest checklist

- [ ] New game: 4 visibly distinct starter ducks (2 male, 2 female)
- [ ] Feed-drop: duck seeks pellet and eats; hunger bar refills
- [ ] Neglect → sickness (green tint, droopy eye) → medicine cures
- [ ] Breed two carriers repeatedly → recessive surprise hatches (white/capped/crested)
- [ ] Duckling's yellow fluff → true colors reveal at juvenile
- [ ] Night (21:00–06:00): ducks head ashore, sleep with z's, scene darkens
- [ ] Nest a pair, pet both during courtship: viability % rises in the panel
- [ ] Egg warmth bar drops; click egg → tucked (hearts), cooldown shown
- [ ] Egg cracks and rocks at 100%; click → hatches; leave one → self-hatches
- [ ] Pond chip turns amber <70% and the Scrub button appears
- [ ] Day 2, 10:00: a wild duck visits regardless of pond state
- [ ] Feathers appear near ducks in their plumage color; tap → album grows in Book
- [ ] Duckweed clumps on the pond rim; tap → +1 feed
- [ ] Fireflies drift after 21:00, gone by 06:00
- [ ] 06:00: dawn card lists buyer/eggs/festival; click dismisses
- [ ] Night: "Sleep 'til dawn" jumps to 06:00 and shows the card
- [ ] Sell an egg; buy the incubator; next egg hatches in half a day
- [ ] Pond capacity blocks adoption until expansion is bought
- [ ] Reload mid-game: identical state (autosave)
- [ ] Run 3 game-years at 16×: elders die to the memorial, no NaNs
- [ ] Resize window: scene letterboxes cleanly
- [ ] `?lab` grid shows color/pattern/size/crest variety
