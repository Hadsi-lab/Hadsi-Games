import type { Game, GameContext, GameDef, GameInput } from '../core/types';

const W = 400;
const H = 500;
const N = 4;
const GAP = 10;
const BOARD = 372;
const BX = (W - BOARD) / 2;
const BY = 100;
const CELL = (BOARD - GAP * (N + 1)) / N;
const COLOR = '#ffc04d';
const SLIDE = 0.1;
const POP = 0.14;

const TILE_COLORS: Record<number, [string, string]> = {
  2: ['#3a3560', '#f4f1ff'],
  4: ['#4b3f80', '#f4f1ff'],
  8: ['#ff9f43', '#1b1430'],
  16: ['#ff6b4d', '#1b1430'],
  32: ['#ff4d6d', '#1b1430'],
  64: ['#ff2e9a', '#1b1430'],
  128: ['#ffd84d', '#1b1430'],
  256: ['#ffe14d', '#1b1430'],
  512: ['#c8ff4d', '#1b1430'],
  1024: ['#4dff9d', '#1b1430'],
  2048: ['#4dfff3', '#1b1430'],
};
const tileColor = (v: number): [string, string] => TILE_COLORS[v] ?? ['#b26bff', '#f4f1ff'];

interface Tile {
  id: number;
  v: number;
  r: number;
  c: number;
  fr: number;
  fc: number;
  pop: number;
  popKind: 'new' | 'merge';
  dying?: boolean;
  doubleTo?: number;
}

type Dir = 'up' | 'down' | 'left' | 'right';

class Doubles implements Game {
  private ctx!: GameContext;
  private tiles: Tile[] = [];
  private nextId = 1;
  private score = 0;
  private slideT = 0;
  private reached = false;
  private prompt = false;
  private over = false;
  private best = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.spawn();
    this.spawn();
    for (const t of this.tiles) t.pop = 0;
  }

  private at(r: number, c: number): Tile | undefined {
    return this.tiles.find((t) => !t.dying && t.r === r && t.c === c);
  }

  private spawn(): void {
    const empty: [number, number][] = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!this.at(r, c)) empty.push([r, c]);
    if (!empty.length) return;
    const [r, c] = empty[Math.floor(Math.random() * empty.length)];
    this.tiles.push({ id: this.nextId++, v: Math.random() < 0.9 ? 2 : 4, r, c, fr: r, fc: c, pop: this.ctx.reducedMotion ? 0 : POP, popKind: 'new' });
  }

  /** Finishes any running slide: removes merged-away tiles and doubles survivors. */
  private settle(): void {
    this.tiles = this.tiles.filter((t) => !t.dying);
    for (const t of this.tiles) {
      t.fr = t.r;
      t.fc = t.c;
      if (t.doubleTo) {
        t.v = t.doubleTo;
        t.doubleTo = undefined;
        t.pop = this.ctx.reducedMotion ? 0 : POP;
        t.popKind = 'merge';
      }
    }
    this.slideT = 0;
  }

  private move(dir: Dir): void {
    if (this.slideT > 0) {
      this.settle();
      if (this.spawnPending) {
        this.spawnPending = false;
        this.afterMove();
      }
      if (this.over || this.prompt) return;
    }
    const vertical = dir === 'up' || dir === 'down';
    const reverse = dir === 'down' || dir === 'right';
    let moved = false;
    let gained = 0;
    for (let line = 0; line < N; line++) {
      const cells: Tile[] = [];
      for (let k = 0; k < N; k++) {
        const idx = reverse ? N - 1 - k : k;
        const t = vertical ? this.at(idx, line) : this.at(line, idx);
        if (t) cells.push(t);
      }
      let pos = 0;
      let last: Tile | null = null;
      for (const t of cells) {
        if (last && last.v === t.v && !last.doubleTo) {
          // Merge t into last.
          last.doubleTo = last.v * 2;
          gained += last.v * 2;
          t.dying = true;
          t.fr = t.r;
          t.fc = t.c;
          t.r = last.r;
          t.c = last.c;
          moved = true;
          continue;
        }
        const idx = reverse ? N - 1 - pos : pos;
        const r = vertical ? idx : line;
        const c = vertical ? line : idx;
        t.fr = t.r;
        t.fc = t.c;
        if (t.r !== r || t.c !== c) moved = true;
        t.r = r;
        t.c = c;
        last = t;
        pos++;
      }
    }
    if (!moved) return;
    this.score += gained;
    this.ctx.setScore(this.score);
    this.ctx.sfx.play(gained ? 'merge' : 'move');
    if (this.ctx.reducedMotion) {
      this.settle();
      this.afterMove();
    } else {
      this.slideT = SLIDE;
      this.spawnPending = true;
    }
  }

  private spawnPending = false;

  private afterMove(): void {
    this.spawn();
    this.best = Math.max(this.best, ...this.tiles.map((t) => t.v));
    if (!this.reached && this.best >= 2048) {
      this.reached = true;
      this.prompt = true;
      this.ctx.sfx.play('win');
      return;
    }
    if (!this.canMove()) {
      this.over = true;
      this.ctx.gameOver(this.score, { won: this.reached });
    }
  }

  private canMove(): boolean {
    if (this.tiles.length < N * N) return true;
    for (const t of this.tiles) {
      const right = this.at(t.r, t.c + 1);
      const down = this.at(t.r + 1, t.c);
      if ((right && right.v === t.v) || (down && down.v === t.v)) return true;
    }
    return false;
  }

  update(dt: number): void {
    for (const t of this.tiles) t.pop = Math.max(0, t.pop - dt);
    if (this.slideT > 0) {
      this.slideT -= dt;
      if (this.slideT <= 0) {
        this.settle();
        if (this.spawnPending) {
          this.spawnPending = false;
          this.afterMove();
        }
      }
    }
  }

  handleInput(input: GameInput): void {
    if (this.over) return;
    if (this.prompt) {
      if (input.kind === 'press' && input.action === 'a') this.keepGoing();
      else if (input.kind === 'press' && input.action === 'b') this.endNow();
      else if (input.kind === 'pointer' && input.phase === 'up') {
        if (input.y > 300 && input.y < 350) {
          if (input.x < W / 2) this.keepGoing();
          else this.endNow();
        }
      }
      return;
    }
    if (input.kind !== 'press') return;
    if (input.action === 'up' || input.action === 'down' || input.action === 'left' || input.action === 'right') this.move(input.action);
  }

  private keepGoing(): void {
    this.prompt = false;
    this.ctx.sfx.play('select');
    if (!this.canMove()) {
      this.over = true;
      this.ctx.gameOver(this.score, { won: true });
    }
  }

  private endNow(): void {
    this.prompt = false;
    this.over = true;
    this.ctx.gameOver(this.score, { won: true });
  }

  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#0d0a14';
    g.fillRect(0, 0, W, H);

    // Title block
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = '22px "Press Start 2P", monospace';
    g.fillStyle = COLOR;
    g.fillText('DOUBLES', BX, 46);
    g.font = '8px "Press Start 2P", monospace';
    g.fillStyle = '#9a96ad';
    g.fillText('MERGE MATCHING TILES TO 2048', BX, 78);
    g.textAlign = 'right';
    g.fillText('BEST TILE', W - BX, 34);
    g.font = '14px "Press Start 2P", monospace';
    g.fillStyle = '#fff';
    g.fillText(String(Math.max(this.best, ...this.tiles.map((t) => t.v), 0)), W - BX, 56);

    // Board
    g.fillStyle = '#1b1430';
    g.beginPath();
    g.roundRect(BX, BY, BOARD, BOARD, 6);
    g.fill();
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) {
        g.fillStyle = '#251c3d';
        g.beginPath();
        g.roundRect(BX + GAP + c * (CELL + GAP), BY + GAP + r * (CELL + GAP), CELL, CELL, 4);
        g.fill();
      }

    // Tiles (dying ones first so survivors draw on top)
    const k = this.slideT > 0 ? 1 - this.slideT / SLIDE : 1;
    const ease = 1 - (1 - k) * (1 - k);
    const ordered = [...this.tiles].sort((a, b) => Number(!!b.dying) - Number(!!a.dying));
    for (const t of ordered) {
      const r = t.fr + (t.r - t.fr) * ease;
      const c = t.fc + (t.c - t.fc) * ease;
      const x = BX + GAP + c * (CELL + GAP);
      const y = BY + GAP + r * (CELL + GAP);
      const p = t.pop > 0 ? t.pop / POP : 0;
      const scale = t.pop > 0 ? (t.popKind === 'new' ? 1 - p * 0.6 : 1 + Math.sin(p * Math.PI) * 0.12) : 1;
      drawTile(g, x, y, CELL, t.v, scale);
    }

    if (this.prompt) {
      g.fillStyle = 'rgba(13,10,20,0.85)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.fillStyle = COLOR;
      g.font = '20px "Press Start 2P", monospace';
      g.fillText('2048!', W / 2, 220);
      g.font = '9px "Press Start 2P", monospace';
      g.fillStyle = '#f4f1ff';
      g.fillText('You made the tile. Keep going?', W / 2, 260);
      drawButton(g, W / 4, 325, 'KEEP GOING', true);
      drawButton(g, (W * 3) / 4, 325, 'END RUN', false);
      g.fillStyle = '#9a96ad';
      g.font = '8px "Press Start 2P", monospace';
      g.fillText('Space = keep going   X = end', W / 2, 380);
    }
  }

  destroy(): void {
    this.tiles = [];
  }
}

function drawTile(g: CanvasRenderingContext2D, x: number, y: number, s: number, v: number, scale: number): void {
  const [bg, fg] = tileColor(v);
  g.save();
  g.translate(x + s / 2, y + s / 2);
  g.scale(scale, scale);
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(-s / 2, -s / 2, s, s, 4);
  g.fill();
  if (v >= 128) {
    g.shadowColor = bg;
    g.shadowBlur = 14;
    g.fill();
    g.shadowBlur = 0;
  }
  const digits = String(v).length;
  const size = digits <= 2 ? 22 : digits === 3 ? 18 : digits === 4 ? 14 : 11;
  g.fillStyle = fg;
  g.font = `${size}px "Press Start 2P", monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(v), 1, 2);
  g.restore();
}

function drawButton(g: CanvasRenderingContext2D, cx: number, cy: number, label: string, primary: boolean): void {
  const w = 150;
  const h = 44;
  g.fillStyle = primary ? COLOR : 'transparent';
  g.strokeStyle = COLOR;
  g.lineWidth = 2;
  g.fillRect(cx - w / 2, cy - h / 2, w, h);
  g.strokeRect(cx - w / 2, cy - h / 2, w, h);
  g.fillStyle = primary ? '#0d0a14' : COLOR;
  g.font = '9px "Press Start 2P", monospace';
  g.textAlign = 'center';
  g.fillText(label, cx, cy + 1);
}

function preview(g: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  const s = 40;
  const gap = 6;
  const bw = 4 * s + 5 * gap;
  const ox = (w - bw) / 2;
  const oy = (h - bw) / 2;
  g.fillStyle = '#1b1430';
  g.fillRect(ox, oy, bw, bw);
  const grid = [
    [2, 0, 0, 4],
    [0, 8, 16, 0],
    [32, 64, 0, 0],
    [128, 0, 256, 2048],
  ];
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      g.fillStyle = '#251c3d';
      g.fillRect(ox + gap + c * (s + gap), oy + gap + r * (s + gap), s, s);
    }
  const phase = (t * 0.6) % 1;
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      const v = grid[r][c];
      if (!v) continue;
      let cc = c;
      if (r === 0 && v === 2) cc = Math.min(phase * 4, 1) * 2; // a 2 slides right
      g.save();
      g.translate(ox + gap + cc * (s + gap), oy + gap + r * (s + gap));
      const [bg, fg] = tileColor(v);
      g.fillStyle = bg;
      g.fillRect(0, 0, s, s);
      g.fillStyle = fg;
      g.font = `${String(v).length > 3 ? 8 : 11}px "Press Start 2P", monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(v), s / 2 + 1, s / 2 + 1);
      g.restore();
    }
}

export const doubles: GameDef = {
  id: 'doubles',
  title: 'Doubles',
  tagline: 'Slide and merge to 2048.',
  color: COLOR,
  width: W,
  height: H,
  controls: {
    keys: 'Arrows or WASD slide every tile · Merge equal tiles to double them',
    touch: 'Swipe (or D-pad) to slide every tile',
  },
  touch: { swipe: true, dpad: true, pointer: true },
  create: () => new Doubles(),
  preview,
};
