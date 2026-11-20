import type { Action, Game, GameContext, GameDef } from '../core/types';
import { InputManager } from '../core/input';
import { createLoop } from '../core/loop';
import { sfx } from '../core/audio';
import { getSettings, subscribe } from '../core/settings';
import { addScore, bestScore, getScores, qualifies } from '../core/highscores';
import { load, save } from '../core/storage';
import { getMode, renderModePicker } from './modes';
import { openSettings, settingsOpen } from './settingsDialog';
import { esc, icon } from './icons';

type State = 'ready' | 'playing' | 'paused' | 'over';

const coarse = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

/** The runner: HUD, canvas scaling, start / pause / game over / initials screens and touch controls. */
export function mountGameScreen(root: HTMLElement, def: GameDef, exit: () => void): () => void {
  const fmt = (n: number) => (def.formatScore ? def.formatScore(n) : n.toLocaleString('en'));

  root.innerHTML = `
    <div class="game-screen" style="--game:${def.color}">
      <header class="gs-hud">
        <button type="button" class="gs-icon-btn" data-act="back" aria-label="Back to lobby">${icon('arrowLeft')}</button>
        <h1 class="gs-title">${esc(def.title)}</h1>
        <div class="gs-stat"><span>Score</span><b data-score>0</b></div>
        <div class="gs-stat"><span>Best</span><b data-best>-</b></div>
        <button type="button" class="gs-icon-btn" data-act="pause" aria-label="Pause">${icon('pause')}</button>
        <button type="button" class="gs-icon-btn" data-act="settings" aria-label="Settings">${icon('settings')}</button>
      </header>
      <main class="gs-stage">
        <div class="gs-frame">
          <canvas class="gs-canvas" aria-label="${esc(def.title)} game area" role="img"></canvas>
          <div class="gs-overlay" aria-live="polite"></div>
        </div>
      </main>
      <div class="gs-touch" aria-hidden="true"></div>
    </div>`;

  const screen = root.querySelector<HTMLElement>('.game-screen')!;
  const stage = root.querySelector<HTMLElement>('.gs-stage')!;
  const frame = root.querySelector<HTMLElement>('.gs-frame')!;
  const canvas = root.querySelector<HTMLCanvasElement>('canvas')!;
  const overlay = root.querySelector<HTMLElement>('.gs-overlay')!;
  const touch = root.querySelector<HTMLElement>('.gs-touch')!;
  const scoreEl = root.querySelector<HTMLElement>('[data-score]')!;
  const bestEl = root.querySelector<HTMLElement>('[data-best]')!;
  const pauseBtn = root.querySelector<HTMLButtonElement>('[data-act="pause"]')!;
  const g = canvas.getContext('2d')!;

  let state: State = 'ready';
  let game: Game | null = null;
  let score = 0;
  let ended = false;
  let mode = getMode(def);
  let overTimer = 0;

  const input = new InputManager(def, canvas, (i) => game?.handleInput(i), () => state === 'playing');

  // ---------- canvas scaling ----------
  let dpr = 1;
  let scale = 1;
  const resize = () => {
    const cs = getComputedStyle(stage);
    const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    scale = Math.max(0.1, Math.min(availW / def.width, availH / def.height));
    const w = Math.floor(def.width * scale);
    const h = Math.floor(def.height * scale);
    frame.style.width = `${w}px`;
    frame.style.height = `${h}px`;
    frame.style.setProperty('--ui-scale', String(Math.min(1.4, Math.max(0.6, scale))));
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();

  // ---------- game lifecycle ----------
  const updateBest = () => {
    const b = bestScore(def.id, mode);
    bestEl.textContent = b == null ? '-' : fmt(b);
  };

  const ctx: GameContext = {
    get mode() {
      return mode;
    },
    get reducedMotion() {
      return getSettings().reducedMotion;
    },
    sfx,
    setScore(n) {
      score = n;
      scoreEl.textContent = fmt(n);
    },
    gameOver(final, opts) {
      if (ended) return;
      ended = true;
      score = final;
      scoreEl.textContent = fmt(final);
      state = 'over';
      input.releaseAll();
      pauseBtn.disabled = true;
      overTimer = window.setTimeout(() => showOver(!!opts?.won), 700);
    },
    isDown: (a: Action) => input.isDown(a),
  };

  const newGame = () => {
    game?.destroy();
    clearTimeout(overTimer);
    ended = false;
    ctx.setScore(0);
    game = def.create();
    game.init(ctx);
    updateBest();
  };

  const play = () => {
    if (ended) newGame();
    state = 'playing';
    pauseBtn.disabled = false;
    pauseBtn.innerHTML = icon('pause');
    pauseBtn.setAttribute('aria-label', 'Pause');
    overlay.innerHTML = '';
    overlay.hidden = true;
    canvas.focus?.();
    sfx.play('start');
  };

  const pause = () => {
    if (state !== 'playing') return;
    state = 'paused';
    input.releaseAll();
    pauseBtn.innerHTML = icon('play');
    pauseBtn.setAttribute('aria-label', 'Resume');
    sfx.play('pause');
    showPause();
  };

  const resume = () => {
    if (state !== 'paused') return;
    state = 'playing';
    pauseBtn.innerHTML = icon('pause');
    pauseBtn.setAttribute('aria-label', 'Pause');
    overlay.innerHTML = '';
    overlay.hidden = true;
  };

  const restart = () => {
    newGame();
    play();
  };

  // ---------- overlays ----------
  const table = (highlight = -1) => {
    const list = getScores(def.id, mode);
    if (!list.length) return '<p class="gs-empty">No scores yet</p>';
    return `<ol class="gs-table">${list
      .map(
        (s, i) =>
          `<li class="${i === highlight ? 'is-new' : ''}"><span>${String(i + 1).padStart(2, '0')}</span><span>${esc(s.initials)}</span><span>${fmt(s.score)}</span></li>`,
      )
      .join('')}</ol>`;
  };

  const show = (html: string) => {
    overlay.hidden = false;
    overlay.innerHTML = `<div class="gs-panel">${html}</div>`;
  };

  const focusFirst = () =>
    (overlay.querySelector<HTMLElement>('[data-autofocus]') ?? overlay.querySelector<HTMLElement>('button, input'))?.focus();

  const showReady = () => {
    const isTouch = coarse();
    show(`
      <h2 class="gs-panel__title">${esc(def.title)}</h2>
      <p class="gs-panel__sub">${esc(def.tagline)}</p>
      <div data-modes></div>
      <p class="gs-controls">${esc(isTouch ? def.controls.touch : def.controls.keys)}</p>
      <button type="button" class="gs-btn" data-act="start" data-autofocus>${isTouch ? 'Tap to start' : 'Press Space'}</button>
      <h3 class="gs-panel__h">Top 10</h3>
      <div data-table>${table()}</div>`);
    const picker = renderModePicker(def, (m) => {
      mode = m;
      newGame();
      overlay.querySelector('[data-table]')!.innerHTML = table();
    });
    if (picker) overlay.querySelector('[data-modes]')!.appendChild(picker);
    focusFirst();
  };

  const showPause = () => {
    show(`
      <h2 class="gs-panel__title">Paused</h2>
      <div class="gs-actions">
        <button type="button" class="gs-btn" data-act="resume" data-autofocus>${icon('play', 14)} Resume</button>
        <button type="button" class="gs-btn gs-btn--ghost" data-act="restart">${icon('rotate', 14)} Restart</button>
        <button type="button" class="gs-btn gs-btn--ghost" data-act="back">${icon('arrowLeft', 14)} Lobby</button>
      </div>
      <p class="gs-controls">${esc(coarse() ? def.controls.touch : def.controls.keys)}</p>`);
    focusFirst();
  };

  const showResults = (title: string, highlight = -1) => {
    show(`
      <h2 class="gs-panel__title">${esc(title)}</h2>
      <p class="gs-panel__score">${fmt(score)}</p>
      <h3 class="gs-panel__h">Top 10</h3>
      ${table(highlight)}
      <div class="gs-actions">
        <button type="button" class="gs-btn" data-act="restart" data-autofocus>${icon('rotate', 14)} Play again</button>
        <button type="button" class="gs-btn gs-btn--ghost" data-act="back">${icon('arrowLeft', 14)} Lobby</button>
      </div>`);
    focusFirst();
  };

  const showOver = (won: boolean) => {
    const title = won ? 'You win!' : 'Game over';
    sfx.play(won ? 'win' : 'lose');
    const eligible = (!def.lowerIsBetter || won) && qualifies(def.id, mode, score, def.lowerIsBetter);
    if (!eligible) return showResults(title);
    const last = load<string>('initials', '');
    show(`
      <h2 class="gs-panel__title">${esc(title)}</h2>
      <p class="gs-panel__score">${fmt(score)}</p>
      <form class="gs-initials">
        <label for="gs-initials">New high score! Enter initials</label>
        <input id="gs-initials" name="initials" maxlength="3" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(last)}" required />
        <button type="submit" class="gs-btn">Save</button>
      </form>`);
    const form = overlay.querySelector<HTMLFormElement>('form')!;
    const field = form.querySelector<HTMLInputElement>('input')!;
    field.addEventListener('input', () => {
      field.value = field.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const initials = (field.value || 'AAA').toUpperCase().padEnd(3, ' ').slice(0, 3);
      save('initials', initials.trim());
      const rank = addScore(
        def.id,
        mode,
        { initials, score, date: new Date().toISOString() },
        def.lowerIsBetter,
      );
      updateBest();
      sfx.play('select');
      showResults(title, rank);
    });
    field.focus();
    field.select();
  };

  // ---------- events ----------
  overlay.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'start') play();
    else if (act === 'resume') resume();
    else if (act === 'restart') restart();
    else if (act === 'back') exit();
  });

  root.querySelector('.gs-hud')!.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'back') exit();
    else if (act === 'pause') (state === 'playing' ? pause() : state === 'paused' ? resume() : undefined);
    else if (act === 'settings') {
      pause();
      openSettings();
    }
  });

  const isPause = (e: KeyboardEvent) => e.code === 'KeyP' || e.key === 'Escape';
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || settingsOpen()) return;
    const target = e.target as HTMLElement;
    const onControl = target.matches?.('button, input, select, textarea');
    if (target.matches?.('input')) return;
    switch (state) {
      case 'playing':
        if (isPause(e)) {
          e.preventDefault();
          pause();
        } else input.key(e, true);
        break;
      case 'paused':
        if (isPause(e)) {
          e.preventDefault();
          resume();
        }
        break;
      case 'ready':
        if (e.key === 'Escape') exit();
        else if (!onControl && (e.code === 'Space' || e.key === 'Enter')) {
          e.preventDefault();
          play();
        }
        break;
      case 'over':
        if (e.key === 'Escape' && !overlay.querySelector('form')) exit();
        break;
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (state !== 'playing') return;
    input.key(e, false);
  };
  const onBlur = () => pause();
  const onVisibility = () => document.hidden && pause();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);

  // ---------- touch controls ----------
  const buildTouch = () => {
    touch.innerHTML = '';
    const t = def.touch;
    const showDpad = !!t.dpad && (!t.swipe || getSettings().touchMode === 'dpad');
    const buttons = t.buttons ?? [];
    touch.hidden = !coarse() || (!showDpad && !buttons.length);
    if (touch.hidden) return;
    if (showDpad) {
      const pad = document.createElement('div');
      pad.className = 'gs-dpad';
      (['up', 'left', 'right', 'down'] as const).forEach((dir) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `gs-dpad__${dir}`;
        b.tabIndex = -1;
        b.innerHTML = icon(dir, 28);
        input.bindButton(b, dir);
        pad.appendChild(b);
      });
      touch.appendChild(pad);
    }
    if (buttons.length) {
      const wrap = document.createElement('div');
      wrap.className = 'gs-buttons';
      buttons.forEach((a) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `gs-action gs-action--${a}`;
        b.tabIndex = -1;
        b.textContent = t.labels?.[a] ?? a.toUpperCase();
        input.bindButton(b, a);
        wrap.appendChild(b);
      });
      touch.appendChild(wrap);
    }
    requestAnimationFrame(resize);
  };

  const applySettings = () => {
    const s = getSettings();
    screen.classList.toggle('crt', s.scanlines);
    screen.classList.toggle('reduced-motion', s.reducedMotion);
    buildTouch();
  };
  const unsub = subscribe(applySettings);
  applySettings();

  // ---------- loop ----------
  const loop = createLoop((dt) => {
    if (!game) return;
    if (state === 'playing') game.update(dt);
    const s = scale * dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#000';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.setTransform(s, 0, 0, s, 0, 0);
    g.save();
    game.render(g);
    g.restore();
  });

  newGame();
  showReady();
  loop.start();

  return () => {
    loop.stop();
    clearTimeout(overTimer);
    unsub();
    ro.disconnect();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
    input.destroy();
    game?.destroy();
    game = null;
    root.innerHTML = '';
  };
}
