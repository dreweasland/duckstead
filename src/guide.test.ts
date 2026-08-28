/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import pondGuide from '../public/guide/game/index.html?raw';
import geneticsGuide from '../public/guide/genetics/index.html?raw';
import bookPanelSource from './ui/bookPanel.ts?raw';
import { FESTIVAL_NAMES } from './sim/festivals';
import { RANKS } from './sim/society';
import { MARKS } from './sim/marks';
import { WEATHER_NAMES } from './sim/weather';
import { RIVAL_DEFS } from './sim/rivals';
import { UPGRADES, DECOR_ITEMS } from './sim/economy';
import { LEAGUE } from './sim/league';
import { TRAIN_STAT_META } from './sim/training';
import { SHORTCUTS } from './ui/settingsPanel';

// The pond guide is prose, so nothing keeps it honest but this: every named
// thing in the sim must at least be mentioned. Rename a rank or add a mark
// and the guide has to follow.
const guide = pondGuide.toLowerCase();

describe('the pond guide', () => {
  it('names every festival, league tier, rank, mark, weather, rival, upgrade, decoration, stat, and shortcut', () => {
    const expected = [
      ...Object.values(FESTIVAL_NAMES).map((n) => n.replace(/^Spring |^Derby |^Autumn /, '')),
      ...LEAGUE.map((t) => t.name),
      ...RANKS.map((r) => r.name),
      ...Object.values(MARKS).map((m) => m.label),
      ...Object.keys(WEATHER_NAMES),
      ...RIVAL_DEFS.map((r) => r.name),
      ...UPGRADES.map((u) => u.name),
      ...DECOR_ITEMS.map((d) => d.name.replace('Garden ', '').replace('Wooden ', '')),
      ...Object.values(TRAIN_STAT_META).map((s) => s.label),
      ...SHORTCUTS.map(([key]) => key.split(' ')[0]),
      'Society Cup', 'stud service', 'heritage', 'Pedigree Scope', 'companion', 'broody', 'commissions',
    ];
    const missing = expected.filter((name) => !guide.includes(name.toLowerCase()));
    expect(missing).toEqual([]);
  });

  it('links both guides to each other and the Book links to both', () => {
    expect(guide).toContain('href="/guide/genetics/"');
    expect(geneticsGuide).toContain('href="/guide/game/"');
    expect(bookPanelSource).toContain("'/guide/game/'");
    expect(bookPanelSource).toContain("'/guide/genetics/'");
  });
});
