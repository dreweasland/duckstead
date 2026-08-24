import { Game } from './game';
import { fitWorldToWindow } from './state';
import { startLoop } from './loop';
import { Renderer } from './render/renderer';
import { UI } from './ui/ui';
import { runLab } from './lab';
import { attachCloudSync, prepareCloudBoot } from './sync/sync';
import { isSyncConfigured } from './sync/syncMeta';

async function boot(): Promise<void> {
  const canvas = document.getElementById('pond-canvas') as HTMLCanvasElement;
  fitWorldToWindow(); // before Game so starter ducks spawn on the pond
  // With a linked cloud save, settle which copy to play before Game reads
  // localStorage (no-op when sync isn't configured or the network is down).
  if (isSyncConfigured()) await prepareCloudBoot();
  const game = new Game();
  const renderer = new Renderer(canvas, game);
  new UI(game, renderer);
  attachCloudSync(game);
  startLoop(game.tick, renderer.render, () => game.speed);
}

if (new URLSearchParams(location.search).has('lab')) {
  runLab();
} else {
  void boot();
}
