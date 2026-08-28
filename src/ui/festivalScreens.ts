// The four festival screens — Egg Show, Grand Prix, Market Day, Winter
// Lights — and the Grand Prix recap. Each takes the host UI's hooks rather
// than the UI itself, and every state change goes through sim/festivals.
import type { Game } from '../game';
import type { Duck } from '../sim/duck';
import { createDuck } from '../sim/duck';
import { createRng } from '../rng';
import { dayOf } from '../sim/time';
import { ordinal } from '../text';
import {
  closeMarket,
  festivalEnteredToday,
  festivalPurseScale,
  festivalTier,
  festivalTitle,
  generateMarketBuyers,
  LANTERN_WISHES,
  marketHaggle,
  marketSell,
  marketTarget,
  noteFestivalWinPublic,
  runEggShow,
  winterCeremonyFinale,
  winterParadeScore,
  winterParadeTarget,
  WINTER_WISHES,
  type EggShowResult,
  type MarketBuyer,
} from '../sim/festivals';
import { markFestivalEntered } from '../sim/festivals';
import { rivalRacers } from '../sim/rivals';
import { el, statTile } from './dom';
import { icon } from './icons';
import { backToPondRow, eventCard } from './eventCard';
import { duckPortrait } from './portrait';
import { openRacePanel } from './racePanel';

export interface FestivalHost {
  game: Game;
  root: HTMLElement;
  floatHost: HTMLElement;
  toast(msg: string): void;
  selectDuck(id: string): void;
}

// A row of already-lit lanterns for Winter Lights recaps.
function litLanternRow(): HTMLElement {
  const row = el('div', { class: 'lantern-row static' });
  for (let i = 0; i < 5; i += 1) row.append(el('span', { class: 'lantern lit' }, el('span', { class: 'lantern-flame' })));
  return row;
}

// --- Grand Prix ---------------------------------------------------------

// Two-round tournament against the rival ponds' racers: top two in the
// heat advance to the final. Reputation tiers raise the purse and sharpen
// the field; the rivals themselves get faster with the years.
export function openGrandPrix(host: FestivalHost): void {
  const state = host.game.state;
  if (festivalEnteredToday(state, 'grandPrix')) {
    const last = state.lastFestival;
    if (last?.kind === 'grandPrix' && last.day === dayOf(state.clock) && last.race) {
      showRaceRecap(host, last.race);
    } else {
      host.toast('You already raced the Grand Prix today!');
    }
    return;
  }
  const tier = festivalTier(state, 'grandPrix');
  const scale = festivalPurseScale(state, 'grandPrix');
  const fieldBoost = 1 + tier * 0.05;
  const gpTitle = festivalTitle(state, 'grandPrix');
  const field = rivalRacers(state);
  openRacePanel(host.game, { toast: (m) => host.toast(m) }, {
    title: `${gpTitle} — Qualifying Heat`,
    entryFee: 15,
    prizes: [0, 0, 0, 0],
    aiBoost: fieldBoost * 0.92,
    ignoreDailyLimit: true,
    field,
    onFinish: (heatPlace) => {
      markFestivalEntered(state, 'grandPrix');
      state.lastFestival = { day: dayOf(state.clock), kind: 'grandPrix', race: { heatPlace, prize: 0 } };
    },
    nextRace: (place) =>
      place <= 1
        ? {
            title: `${gpTitle} — Final`,
            entryFee: 0,
            prizes: [Math.round(75 * scale), Math.round(25 * scale), 0, 0],
            aiBoost: fieldBoost,
            ignoreDailyLimit: true,
            field,
            onFinish: (finalPlace) => {
              if (finalPlace === 0) noteFestivalWinPublic(state, 'grandPrix');
              if (state.lastFestival?.race) {
                state.lastFestival.race.finalPlace = finalPlace;
                state.lastFestival.race.prize = finalPlace === 0 ? Math.round(75 * scale) : finalPlace === 1 ? Math.round(25 * scale) : 0;
              }
            },
          }
        : null,
  });
}

// A finished Grand Prix, recapped from the festival chip.
export function showRaceRecap(host: FestivalHost, race: { heatPlace: number; finalPlace?: number; prize: number }): void {
  const won = race.finalPlace === 0;
  const ev = eventCard(host.root, 'derby', won ? 'win' : '');
  if (!ev) return;
  const round = (label: string, placed: number, note: string, reward: number) =>
    el(
      'div',
      { class: 'race-result-row mine' },
      el('span', { class: `race-place p${placed + 1}` }, String(placed + 1)),
      el('span', { class: 'race-result-name' }, label),
      el('span', { class: 'muted small' }, note),
      reward > 0 ? el('span', { class: 'goal-reward with-icon' }, icon('coin', 11), String(reward)) : null,
    );
  const rows = el(
    'div',
    { class: 'race-results' },
    round('Qualifying Heat', race.heatPlace, race.heatPlace <= 1 ? 'advanced to the final' : 'eliminated', 0),
  );
  if (race.finalPlace !== undefined) rows.append(round('Final', race.finalPlace, won ? 'champion!' : 'finished', race.prize));
  ev.card.append(
    ev.header('flag', won ? 'Grand Prix champions!' : festivalTitle(host.game.state, 'grandPrix')),
    rows,
    backToPondRow(ev.close),
  );
}

// --- Market Day ---------------------------------------------------------

// A queue of smitten buyers; accept, haggle, or send them off. Sell past the
// day's target and the festival is won.
export function openMarketStall(host: FestivalHost): void {
  if (document.querySelector('.race-overlay')) return;
  const state = host.game.state;
  const today = dayOf(state.clock);
  // The day's buyers are generated once and kept, so you can close the stall
  // to think it over and come back to the same queue. An empty queue for
  // today means the stall has closed.
  if (!state.market || state.market.day !== today) {
    const fresh = generateMarketBuyers(state, host.game.rng);
    if (fresh.length === 0) {
      host.toast('No ducks to show at market — the stalls stay quiet.');
      return;
    }
    state.market = { day: today, buyers: fresh, sold: 0, earned: 0 };
  }
  const market = state.market!;
  const buyers = market.buyers;
  const target = marketTarget(state);
  const tally = () =>
    el(
      'div',
      { class: 'race-stats fit' },
      statTile('duck', String(market.sold), market.sold === 1 ? 'duck sold' : 'ducks sold'),
      statTile('coin', String(market.earned), 'earned'),
      statTile('flag', String(target), 'target'),
    );
  if (buyers.length === 0 || festivalEnteredToday(state, 'marketDay')) {
    // Packed up: show the day's tally instead of a shrug.
    const ev0 = eventCard(host.root, 'market', market.earned >= target ? 'win' : '');
    if (!ev0) return;
    ev0.card.append(
      ev0.header('cart', market.earned >= target ? 'Market Day — won!' : 'Market Day — closed'),
      tally(),
      el(
        'div',
        { class: 'egg-comment' },
        market.earned >= target
          ? 'The best trade of the fair — next year\'s market will be a bigger one.'
          : market.sold > 0 ? 'The stalls have packed up until next autumn.' : 'The stalls have packed up — nothing sold this year.',
      ),
      backToPondRow(ev0.close),
    );
    return;
  }

  const ev = eventCard(host.root, 'market', '', () => host.floatHost.classList.remove('above-overlay'));
  if (!ev) return;
  const { card, close, header } = ev;
  const index = 0;
  // A buyer leaves the queue when dealt with; the stall closes (and the day
  // is judged) once the last one goes.
  const dismiss = (buyer: MarketBuyer) => {
    const i = buyers.indexOf(buyer);
    if (i >= 0) buyers.splice(i, 1);
  };

  const showBuyer = () => {
    if (index >= buyers.length) {
      const result = closeMarket(state);
      const won = result?.won ?? market.earned >= target;
      card.classList.toggle('win', won);
      card.replaceChildren(
        header('cart', won ? 'Market Day — won!' : 'Market Day'),
        tally(),
        el(
          'div',
          { class: 'egg-comment' },
          won
            ? 'The last buyer tips their hat — and the fair\'s steward notes the day\'s takings. Next year\'s market is a bigger one.'
            : `The last buyer tips their hat. The stalls pack up until next autumn${market.earned > 0 ? ` — ${target - market.earned} short of the fair's mark` : ''}.`,
        ),
        el(
          'div',
          { class: 'actions race-actions' },
          el('button', { class: 'action-btn primary', onclick: close }, 'Back to the pond'),
        ),
      );
      return;
    }
    const buyer = buyers[index];
    const duck = state.ducks.find((d) => d.id === buyer.duckId);
    if (!duck) {
      dismiss(buyer);
      showBuyer();
      return;
    }
    const actions = el(
      'div',
      { class: 'actions race-actions' },
      el(
        'button',
        {
          class: 'action-btn primary',
          onclick: () => {
            marketSell(state, buyer);
            dismiss(buyer);
            showBuyer();
          },
        },
        'Accept ',
        icon('coin', 11),
        ` ${buyer.offer}`,
      ),
      buyer.haggled
        ? null
        : el(
            'button',
            {
              class: 'action-btn',
              title: 'Push for 25% more — but they may walk away',
              onclick: () => {
                if (marketHaggle(buyer, host.game.rng)) {
                  host.toast(`They grumble… and agree to ${buyer.offer}!`);
                  showBuyer();
                } else {
                  host.toast('“Outrageous!” The buyer storms off.');
                  dismiss(buyer);
                  showBuyer();
                }
              },
            },
            'Haggle for more',
          ),
      el(
        'button',
        {
          class: 'action-btn',
          onclick: () => {
            dismiss(buyer);
            showBuyer();
          },
        },
        `Not for sale`,
      ),
    );
    card.replaceChildren(
      header('cart', `Market Day — ${buyers.length} buyer${buyers.length === 1 ? '' : 's'} waiting`),
      el('div', { class: 'muted small race-blurb' }, `Sell ${target} coins' worth today to win the fair (${market.earned} so far).`),
      el(
        'div',
        { class: 'egg-stage market-stage' },
        el('div', { class: 'egg-breeder' }, buyer.name),
        el('div', { class: 'egg-comment' }, buyer.quote),
        el(
          'button',
          {
            class: 'egg-pedestal pedestal-btn',
            title: `Look ${duck.name} over before you decide`,
            onclick: () => {
              // The duck card normally sits under the stall overlay; lift
              // it above and it steps aside so both stay readable.
              host.floatHost.classList.add('above-overlay');
              host.selectDuck(duck.id);
            },
          },
          duckPortrait(duck, 64),
        ),
        el('div', { class: 'muted small' }, `${duck.name} — offering `, icon('coin', 11), ` ${buyer.offer}`),
        el('div', { class: 'muted small pedestal-hint' }, 'tap the pedestal to look them over'),
      ),
      actions,
    );
  };

  showBuyer();
}

// --- Winter Lights ------------------------------------------------------

// Light the five wish-lanterns, then the flock parades beneath them: the
// pond is judged on its decorations, poise, and cheer against the tier's
// bar, and the fifth wish is the player's.
export function openWinterLights(host: FestivalHost): void {
  if (document.querySelector('.race-overlay')) return;
  const state = host.game.state;
  const paradeTiles = (parade: { score: number; target: number; won: boolean } | undefined) =>
    parade
      ? el(
          'div',
          { class: 'race-stats fit' },
          statTile('sparkle', String(parade.score), 'parade score'),
          statTile('flag', String(parade.target), parade.won ? 'bar — cleared!' : 'bar'),
        )
      : null;
  if (festivalEnteredToday(state, 'winterLights')) {
    const last = state.lastFestival;
    if (last?.kind === 'winterLights' && last.day === dayOf(state.clock) && last.winter) {
      const ev0 = eventCard(host.root, 'winter', last.winter.parade?.won ? 'win' : '');
      if (!ev0) return;
      ev0.card.append(
        el(
          'div',
          {},
          ev0.header('sparkle', last.winter.parade?.won ? 'The finest pond on the water' : 'The pond glows'),
          litLanternRow(),
          paradeTiles(last.winter.parade),
          el(
            'div',
            { class: 'race-stats fit' },
            statTile('coin', `+${last.winter.coins}`, 'coins'),
            statTile('wheat', `+${last.winter.premiumFeed}`, 'premium feed'),
          ),
          el('div', { class: 'egg-comment' }, last.winter.wishText),
          backToPondRow(ev0.close),
        ),
      );
      return;
    }
    host.toast('The lanterns already burn bright — enjoy the glow.');
    return;
  }
  let wishTimer = 0;
  const ev = eventCard(host.root, 'winter', '', () => window.clearTimeout(wishTimer));
  if (!ev) return;
  const { card, close, header } = ev;
  let lit = 0;

  const wishLine = el('div', { class: 'egg-comment' }, 'Light each lantern and make a wish…');
  const lanternRow = el('div', { class: 'lantern-row' });
  const showFinale = (reward: ReturnType<typeof winterCeremonyFinale>) => {
    const won = Boolean(reward?.parade?.won);
    card.classList.toggle('win', won);
    const finale = el(
      'div',
      {},
      header('sparkle', won ? 'The finest pond on the water' : 'The pond glows'),
      el(
        'div',
        { class: 'egg-comment' },
        'The whole flock drifts in beneath the lights, feathers silvered by the glow. Somebody quacks softly. It is perfect.',
      ),
      litLanternRow(),
      paradeTiles(reward?.parade),
      reward?.parade
        ? el(
            'div',
            { class: 'muted small race-blurb' },
            won
              ? 'The parade judges are unanimous — next year\'s Lights will be a grander affair.'
              : 'Decorations, poise, and a cheerful flock all count toward the parade.',
          )
        : null,
      reward
        ? el(
            'div',
            { class: 'race-stats fit' },
            statTile('coin', `+${reward.coins}`, 'coins'),
            statTile('wheat', `+${reward.premiumFeed}`, 'premium feed'),
          )
        : null,
      reward ? el('div', { class: 'egg-comment' }, reward.wishText) : null,
      el(
        'div',
        { class: 'actions race-actions' },
        el('button', { class: 'action-btn primary', onclick: close }, 'Stay a while, then head back'),
      ),
    );
    if (reward) state.lastFestival = { day: dayOf(state.clock), kind: 'winterLights', winter: reward };
    card.replaceChildren(finale);
  };
  LANTERN_WISHES.forEach((wish) => {
    const lantern = el(
      'button',
      {
        class: 'lantern',
        onclick: () => {
          if (lantern.classList.contains('lit')) return;
          lantern.classList.add('lit');
          lit += 1;
          wishLine.textContent = wish;
          if (lit === LANTERN_WISHES.length) {
            // The fifth lantern is the player's own wish.
            wishTimer = window.setTimeout(() => {
              const choices = el('div', { class: 'wish-choices' });
              for (const w of WINTER_WISHES) {
                choices.append(
                  el(
                    'button',
                    { class: 'wish-choice', onclick: () => showFinale(winterCeremonyFinale(state, w.id)) },
                    el('strong', {}, w.label),
                    el('span', { class: 'muted small' }, w.blurb),
                  ),
                );
              }
              card.replaceChildren(
                header('sparkle', 'The last lantern is yours'),
                el('div', { class: 'egg-comment' }, 'Four wishes for the flock. The fifth is for the pond. Choose.'),
                choices,
              );
            }, 700);
          }
        },
      },
      el('span', { class: 'lantern-flame' }),
    );
    lanternRow.append(lantern);
  });

  const score = winterParadeScore(state);
  const target = winterParadeTarget(state);
  card.append(
    header('sparkle', 'Winter Lights'),
    wishLine,
    lanternRow,
    el(
      'div',
      { class: 'muted small race-blurb' },
      `The lantern parade will score the pond at ${score} against a bar of ${target} — decorations, poise, and cheer all count.`,
    ),
  );
}

// --- Spring Egg Show ----------------------------------------------------

export function openEggShow(host: FestivalHost): void {
  if (document.querySelector('.race-overlay')) return;
  const state = host.game.state;
  const eggs = state.ducks.filter((d) => d.stage === 'egg');
  // Judged entries render as a fresh egg still with a fixed seed.
  const sampleEgg = (genome: Duck['genome']): Duck =>
    createDuck(createRng(7), { genome, stage: 'egg', pos: { x: 0, y: 0 }, name: 'egg' });
  const timers: number[] = [];
  const ev = eventCard(host.root, 'egg', 'egg-show', () => timers.forEach((t) => clearTimeout(t)));
  if (!ev) return;
  const { card, close } = ev;
  const header = (): HTMLElement => ev.header('egg', festivalTitle(state, 'eggShow'));

  const showStandings = (result: EggShowResult, replay = false) => {
    timers.forEach((t) => clearTimeout(t));
    const list = el('div', { class: 'race-results' });
    result.entries.forEach((entry, i) => {
      const sample = sampleEgg(entry.genome);
      list.append(
        el(
          'div',
          { class: `race-result-row${entry.isPlayer ? ' mine' : ''}` },
          el('span', { class: `race-place p${i + 1}` }, `${i + 1}`),
          duckPortrait(sample, 34),
          el(
            'span',
            { class: 'race-result-name egg-standing' },
            el('span', {}, `${entry.eggName} — ${entry.breeder}`),
            el('span', { class: 'chip chip-trait' }, entry.breed),
          ),
          el('span', { class: 'muted small' }, `${entry.score} pts`),
          entry.isPlayer && result.prize > 0
            ? el('span', { class: 'goal-reward with-icon' }, icon('coin', 11), `${result.prize}`)
            : null,
        ),
      );
    });
    card.classList.toggle('win', result.playerPlace === 0);
    card.replaceChildren(
      ev.header('egg', result.playerPlace === 0 ? 'Best in Show!' : 'Final standings'),
      el(
        'div',
        { class: 'muted small' },
        'The judges reveal each bloodline after the verdict:',
      ),
      list,
      el(
        'div',
        { class: 'actions race-actions' },
        el('button', { class: 'action-btn primary', onclick: close }, 'Back to the pond'),
      ),
    );
    if (result.prize > 0 && !replay) host.toast(`Placed ${ordinal(result.playerPlace + 1)} — +${result.prize} coins!`);
  };

  const runCeremony = (result: EggShowResult) => {
    // Judge from the bottom of the field up, so the winner lands last.
    const order = [...result.entries].reverse();
    const stage = el('div', { class: 'egg-stage' });
    card.replaceChildren(
      header(),
      stage,
      el(
        'div',
        { class: 'actions race-actions' },
        el('button', { class: 'action-btn', onclick: () => showStandings(result) }, 'Skip to results'),
      ),
    );
    order.forEach((entry, i) => {
      timers.push(
        window.setTimeout(() => {
          const sample = sampleEgg(entry.genome);
          stage.replaceChildren(
            el('div', { class: 'muted small' }, `Now judging entry ${i + 1} of ${order.length}…`),
            el(
              'div',
              { class: 'egg-pedestal' },
              duckPortrait(sample, 72),
            ),
            el('div', { class: 'egg-breeder' }, `${entry.eggName} — ${entry.breeder}${entry.isPlayer ? ' (you)' : ''}`),
            el('div', { class: 'egg-comment' }, `“${entry.comment}”`),
            el('div', { class: 'egg-score' }, `${entry.score} points`),
          );
        }, i * 2100),
      );
    });
    timers.push(window.setTimeout(() => showStandings(result), order.length * 2100 + 700));
  };

  card.append(header());
  const last = state.lastFestival;
  if (festivalEnteredToday(state, 'eggShow') && last?.kind === 'eggShow' && last.day === dayOf(state.clock) && last.eggShow) {
    showStandings(last.eggShow, true);
    return;
  }
  if (festivalEnteredToday(state, 'eggShow')) {
    card.append(el('div', { class: 'muted' }, 'You already entered an egg this year — see you next spring!'));
  } else if (eggs.length === 0) {
    card.append(el('div', { class: 'muted' }, 'No eggs in the nest to enter. Nest a pair and come back before sundown!'));
  } else {
    card.append(
      el(
        'div',
        { class: 'muted' },
        'Enter one egg against the rival ponds and a local breeder. Judges score hidden genetics, standard, and how well its parents are kept — a poised parent helps.',
      ),
    );
    const grid = el('div', { class: 'race-picker' });
    for (const egg of eggs) {
      grid.append(
        el(
          'button',
          {
            class: 'race-pick',
            onclick: () => {
              const result = runEggShow(state, egg.id, host.game.rng);
              if (result) {
                state.lastFestival = { day: dayOf(state.clock), kind: 'eggShow', eggShow: result };
                runCeremony(result);
              } else close();
            },
          },
          duckPortrait(egg, 48),
          el('span', { class: 'small' }, 'Egg'),
        ),
      );
    }
    card.append(grid);
  }
}
