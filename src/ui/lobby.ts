import { games, upcoming } from '../games/registry';
import { bestScore } from '../core/highscores';
import { getSettings, subscribe } from '../core/settings';
import { getMode } from './modes';
import { openSettings, settingsOpen } from './settingsDialog';
import { esc, icon } from './icons';

const PW = 320;
const PH = 200;

export function mountLobby(root: HTMLElement): () => void {
  const total = games.length + upcoming.length;
  const playable = games
    .map((def, i) => {
      const best = bestScore(def.id, getMode(def));
      const fmt = (n: number) => (def.formatScore ? def.formatScore(n) : n.toLocaleString('en'));
      return `
      <li>
        <a class="lb-card" href="#/play/${esc(def.id)}" data-card style="--game:${def.color}">
          <canvas class="lb-card__preview" width="${PW}" height="${PH}" data-preview="${i}" aria-hidden="true"></canvas>
          <span class="lb-card__num">${String(i + 1).padStart(2, '0')}</span>
          <span class="lb-card__title">${esc(def.title)}</span>
          <span class="lb-card__tag">${esc(def.tagline)}</span>
          <span class="lb-card__best">Best <b>${best == null ? '-' : fmt(best)}</b></span>
        </a>
      </li>`;
    })
    .join('');
  const locked = upcoming
    .map(
      (u, i) => `
      <li>
        <div class="lb-card is-locked" data-card tabindex="-1" aria-disabled="true" style="--game:${u.color}">
          <div class="lb-card__preview lb-card__preview--locked">${icon('lock', 28)}</div>
          <span class="lb-card__num">${String(games.length + i + 1).padStart(2, '0')}</span>
          <span class="lb-card__title">${esc(u.title)}</span>
          <span class="lb-card__tag">${esc(u.tagline)}</span>
          <span class="lb-card__best">Coming soon</span>
        </div>
      </li>`,
    )
    .join('');

  root.innerHTML = `
    <div class="lobby mn">
      <header class="lb-head">
        <div>
          <p class="mn-eyebrow">${upcoming.length ? `${games.length} of ${total} playable` : `${games.length} games`}</p>
          <h1 class="mn-display">Arcade</h1>
        </div>
        <button type="button" class="mn-icon-btn" data-settings aria-label="Settings">${icon('settings', 22)}</button>
      </header>
      <ul class="lb-grid" role="list">${playable}${locked}</ul>
      <footer class="lb-foot">
        <p>Keyboard: arrows to move, Enter to play. Scores are saved on this device.</p>
      </footer>
    </div>`;

  root.querySelector('[data-settings]')!.addEventListener('click', () => openSettings());

  // Arrow-key navigation across the grid.
  const cards = [...root.querySelectorAll<HTMLElement>('[data-card]')];
  const onKey = (e: KeyboardEvent) => {
    if (settingsOpen() || e.defaultPrevented) return;
    const i = cards.indexOf(document.activeElement as HTMLElement);
    if (i < 0) {
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        cards[0]?.focus();
      }
      return;
    }
    const top = cards[0].offsetTop;
    const cols = Math.max(1, cards.filter((c) => c.offsetTop === top).length);
    const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols };
    const d = delta[e.key];
    if (d == null) return;
    e.preventDefault();
    const next = cards[Math.min(cards.length - 1, Math.max(0, i + d))];
    next.focus();
    next.scrollIntoView({ block: 'nearest', behavior: getSettings().reducedMotion ? 'auto' : 'smooth' });
  };
  window.addEventListener('keydown', onKey);

  // Animated previews.
  const canvases = [...root.querySelectorAll<HTMLCanvasElement>('[data-preview]')].map((c) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = PW * dpr;
    c.height = PH * dpr;
    return { c, g: c.getContext('2d')!, def: games[Number(c.dataset.preview)], dpr };
  });
  let raf = 0;
  const draw = (t: number) => {
    for (const { g, def, dpr } of canvases) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#0b0a10';
      g.fillRect(0, 0, PW, PH);
      g.save();
      def.preview(g, t, PW, PH);
      g.restore();
    }
  };
  const tick = (now: number) => {
    draw(now / 1000);
    raf = requestAnimationFrame(tick);
  };
  const start = () => {
    cancelAnimationFrame(raf);
    if (getSettings().reducedMotion) draw(1.2);
    else raf = requestAnimationFrame(tick);
  };
  const unsub = subscribe(start);
  start();

  (document.querySelector<HTMLElement>('a[data-card]') ?? null)?.focus({ preventScroll: true });

  return () => {
    cancelAnimationFrame(raf);
    unsub();
    window.removeEventListener('keydown', onKey);
    root.innerHTML = '';
  };
}
