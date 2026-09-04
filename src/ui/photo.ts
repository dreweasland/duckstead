// Photo mode: a portrait card of one duck — name, breed, pedigree,
// temperament, marks — rendered to a PNG you can save or share. The same
// painter that draws the pond draws the card, so it's the real duck.
import type { Game } from '../game';
import type { Duck } from '../sim/duck';
import { breedKey, breedLabel } from '../sim/breedBook';
import { pedigreeScore } from '../sim/pedigree';
import { personalityLabels } from '../sim/behavior';
import { MARKS } from '../sim/marks';
import { formatClock } from '../sim/time';
import { computeAnim } from '../render/animation';
import { drawDuck } from '../render/duckPainter';
import { el } from './dom';
import { backToPondRow, eventCard } from './eventCard';

const W = 560;
const H = 360;

function renderPhotoCard(game: Game, duck: Duck): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  // Backdrop: a soft pond-and-sky.
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#6aa5d8');
  sky.addColorStop(0.55, '#b9dcf2');
  sky.addColorStop(0.56, '#77b055');
  sky.addColorStop(1, '#4f8a3f');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(58, 130, 190, 0.85)';
  ctx.beginPath();
  ctx.ellipse(W * 0.38, H * 0.72, 190, 62, 0, 0, Math.PI * 2);
  ctx.fill();
  // The duck, large.
  ctx.save();
  ctx.translate(W * 0.36, H * 0.66);
  ctx.scale(3.1, 3.1);
  const still = { ...duck, activity: duck.stage === 'egg' ? 'sit' : 'idle' } as Duck;
  drawDuck(ctx, still, { inWater: duck.stage !== 'egg', selected: false, anim: computeAnim(still, 0), facingLeft: false, timeMs: 0 });
  ctx.restore();
  // Card text.
  ctx.fillStyle = 'rgba(16, 22, 30, 0.72)';
  roundRect(ctx, W * 0.62, 24, W * 0.35, H - 48, 14);
  ctx.fill();
  ctx.fillStyle = '#ecebe6';
  ctx.font = 'bold 22px "Avenir Next", "Segoe UI", system-ui, sans-serif';
  ctx.fillText(duck.name, W * 0.65, 60);
  ctx.font = '13px "Avenir Next", "Segoe UI", system-ui, sans-serif';
  const lines: string[] = [];
  lines.push(duck.stage === 'egg' ? 'An egg' : `${duck.sex === 'F' ? 'Hen' : 'Drake'} · ${duck.stage}`);
  if (duck.stage !== 'egg') lines.push(breedLabel(breedKey(duck.genome)));
  lines.push(`Pedigree ★ ${pedigreeScore(duck)}`);
  if (duck.stage !== 'egg') lines.push(personalityLabels(duck).join(', '));
  for (const m of duck.marks ?? []) lines.push(`${MARKS[m].label} — ${MARKS[m].blurb.split(':')[0]}`);
  if (duck.training) {
    const t = duck.training;
    if (t.paddle + t.stamina + t.poise > 0) lines.push(`Trained: paddle ${Math.round(t.paddle)} · stamina ${Math.round(t.stamina)} · poise ${Math.round(t.poise)}`);
  }
  let y = 88;
  for (const line of lines) {
    wrapText(ctx, line, W * 0.65, y, W * 0.3, 17);
    y += 17 * Math.max(1, Math.ceil(ctx.measureText(line).width / (W * 0.3)));
  }
  ctx.fillStyle = 'rgba(236, 235, 230, 0.7)';
  ctx.font = '11px "Avenir Next", "Segoe UI", system-ui, sans-serif';
  ctx.fillText(`Duck Homestead · ${formatClock(game.state.clock)}`, W * 0.65, H - 40);
  return canvas;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number): void {
  const words = text.split(' ');
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineH;
    } else line = test;
  }
  ctx.fillText(line, x, y);
}

export function openPhoto(game: Game, ui: { toast(msg: string): void }, duck: Duck): void {
  const ev = eventCard(document.getElementById('ui-root')!, 'drill', 'photo-card');
  if (!ev) return;
  const canvas = renderPhotoCard(game, duck);
  canvas.className = 'photo-canvas';
  const filename = `${duck.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'duck'}.png`;
  const toBlob = () => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  const actions = el(
    'div',
    { class: 'actions race-actions' },
    el(
      'button',
      {
        class: 'action-btn primary',
        onclick: async () => {
          const blob = await toBlob();
          if (!blob) return ui.toast('Could not render the photo');
          const url = URL.createObjectURL(blob);
          const a = el('a', { href: url, download: filename }) as HTMLAnchorElement;
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        },
      },
      'Save PNG',
    ),
  );
  if (typeof navigator.share === 'function') {
    actions.append(
      el(
        'button',
        {
          class: 'action-btn',
          onclick: async () => {
            const blob = await toBlob();
            if (!blob) return;
            const file = new File([blob], filename, { type: 'image/png' });
            try {
              await navigator.share({ files: [file], title: duck.name });
            } catch {
              // Cancelled — nothing to report.
            }
          },
        },
        'Share…',
      ),
    );
  }
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    actions.append(
      el(
        'button',
        {
          class: 'action-btn',
          onclick: async () => {
            const blob = await toBlob();
            if (!blob) return;
            try {
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
              ui.toast('Copied the photo to the clipboard');
            } catch {
              ui.toast('The browser would not allow the copy');
            }
          },
        },
        'Copy',
      ),
    );
  }
  ev.card.append(ev.header('cards', `${duck.name} — portrait`), el('div', { class: 'photo-wrap' }, canvas), actions, backToPondRow(ev.close));
}
