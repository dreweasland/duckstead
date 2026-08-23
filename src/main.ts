import { Game } from './game';
import { fitWorldToWindow } from './state';
import { startLoop } from './loop';
import { Renderer } from './render/renderer';
import { UI } from './ui/ui';
import { runLab } from './lab';

if (new URLSearchParams(location.search).has('lab')) {
  runLab();
} else {
  const canvas = document.getElementById('pond-canvas') as HTMLCanvasElement;
  fitWorldToWindow(); // before Game so starter ducks spawn on the pond
  const game = new Game();
  const renderer = new Renderer(canvas, game);
  new UI(game, renderer);
  startLoop(game.tick, renderer.render, () => game.speed);
}
