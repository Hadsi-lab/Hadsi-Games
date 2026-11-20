import type { Game, GameContext, GameDef, GameInput } from '../core/types';

const W = 480;
const H = 640;
const TOP = 40;
const COLOR = '#ff5e7e';
const LONG_PRESS = 0.4;

// Expert is laid out 16 wide × 30 tall so it suits a portrait screen.
const MODES: Record<string, { cols: number; rows: number; mines: number; label: string }> = {
  beginner: { cols: 9, rows: 9, mines: 10, label: 'BEGINNER' },
  intermediate: { cols: 16, rows: 16, mines: 40, label: 'INTERMEDIATE' },
  expert: { cols: 16, rows: 30, mines: 99, label: 'EXPERT' },
};
const NUM_COLORS = ['', '#4dfff3', '#7cff6b', '#ff4d6d', '#b26bff', '#ffa64d', '#4d7cff', '#ffffff', '#9a96ad'];
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

interface Press {
  cell: number;
  t: number;
  button: number;
  touch: boolean;
  x: number;
  y: number;
  done: boolean;
}

class MineField implements Game {
  private ctx!: GameContext;
  private cols = 9;
  private rows = 9;
  private mineCount = 10;
  private size = 40;
  private ox = 0;
  private oy = 0;
  private mines: boolean[] = [];
  private counts: number[] = [];
  private open: boolean[] = [];
  private flags: boolean[] = [];
  private placed = false;
  private started = false;
  private time = 0;
  private shown = -1;
  private now = 0;
  private press: Press | null = null;
  private cursor = 0;
  private kb = false;
  private exploded = -1;
  private ended = false;
  private label = '';

  init(ctx: GameContext): void {
    this.ctx = ctx;
    const m = MODES[ctx.mode ?? 'beginner'] ?? MODES.beginner;
    this.cols = m.cols;
    this.rows = m.rows;
    this.mineCount = m.mines;
    this.label = m.label;
    const n = this.cols * this.rows;
    this.mines = Array(n).fill(false);
    this.counts = Array(n).fill(0);
    this.open = Array(n).fill(false);
    this.flags = Array(n).fill(false);
    this.size = Math.floor(Math.min((W - 16) / this.cols, (H - TOP - 12) / this.rows));
    this.ox = Math.floor((W - this.size * this.cols) / 2);
    this.oy = TOP + Math.floor((H - TOP - this.size * this.rows) / 2);
    this.cursor = Math.floor(this.rows / 2) * this.cols + Math.floor(this.cols / 2);
    this.ctx.setScore(0);
  }

  private neighbours(i: number): number[] {
    const x = i % this.cols;
    const y = Math.floor(i / this.cols);
    const out: number[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < this.cols && ny < this.rows) out.push(ny * this.cols + nx);
      }
    return out;
  }

  /** Lays the mines on the first reveal, keeping the clicked cell and its neighbours clear. */
  private place(safe: number): void {
    const n = this.cols * this.rows;
    const keep = new Set([safe, ...this.neighbours(safe)]);
    const pool = [...Array(n).keys()].filter((i) => !keep.has(i));
    for (let k = 0; k < this.mineCount; k++) {
      const j = k + Math.floor(Math.random() * (pool.length - k));
      [pool[k], pool[j]] = [pool[j], pool[k]];
      this.mines[pool[k]] = true;
    }
    for (let i = 0; i < n; i++) this.counts[i] = this.neighbours(i).filter((j) => this.mines[j]).length;
    this.placed = true;
    this.started = true;
  }

  private reveal(i: number): void {
    if (this.ended || this.flags[i] || this.open[i]) return;
    if (!this.placed) this.place(i);
    if (this.mines[i]) return this.lose(i);
    const stack = [i];
    let opened = 0;
    while (stack.length) {
      const c = stack.pop()!;
      if (this.open[c] || this.flags[c]) continue;
      this.open[c] = true;
      opened++;
      if (this.counts[c] === 0) for (const nb of this.neighbours(c)) if (!this.open[nb]) stack.push(nb);
    }
    this.ctx.sfx.play(opened > 1 ? 'line' : 'reveal');
    this.checkWin();
  }

  private chord(i: number): void {
    if (!this.open[i] || this.counts[i] === 0) return;
    const nbs = this.neighbours(i);
    const flagged = nbs.filter((j) => this.flags[j]).length;
    if (flagged !== this.counts[i]) {
      this.ctx.sfx.play('blip');
      return;
    }
    for (const j of nbs) if (!this.open[j] && !this.flags[j]) {
      if (this.mines[j]) return this.lose(j);
      this.reveal(j);
      if (this.ended) return;
    }
  }

  private act(i: number): void {
    if (this.open[i]) this.chord(i);
    else this.reveal(i);
  }

  private toggleFlag(i: number): void {
    if (this.ended || this.open[i]) return;
    this.flags[i] = !this.flags[i];
    this.ctx.sfx.play('flag');
  }

  private lose(i: number): void {
    this.ended = true;
    this.exploded = i;
    this.ctx.sfx.play('explode');
    this.ctx.gameOver(Math.max(1, Math.ceil(this.time)), { won: false });
  }

  private checkWin(): void {
    const total = this.cols * this.rows;
    const opened = this.open.filter(Boolean).length;
    if (opened !== total - this.mineCount) return;
    this.ended = true;
    this.mines.forEach((m, k) => m && (this.flags[k] = true));
    this.ctx.gameOver(Math.max(1, Math.ceil(this.time)), { won: true });
  }

  private cellAt(x: number, y: number): number {
    const cx = Math.floor((x - this.ox) / this.size);
    const cy = Math.floor((y - this.oy) / this.size);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return -1;
    return cy * this.cols + cx;
  }

  update(dt: number): void {
    this.now += dt;
    if (this.ended) return;
    if (this.started) {
      this.time += dt;
      const s = Math.floor(this.time);
      if (s !== this.shown) {
        this.shown = s;
        this.ctx.setScore(s);
      }
    }
    // Long press flags on touch.
    const p = this.press;
    if (p && p.touch && !p.done && this.now - p.t >= LONG_PRESS) {
      p.done = true;
      this.toggleFlag(p.cell);
      navigator.vibrate?.(15);
    }
  }

  handleInput(input: GameInput): void {
    if (this.ended) return;
    if (input.kind === 'pointer') {
      this.kb = false;
      if (input.phase === 'down') {
        const cell = this.cellAt(input.x, input.y);
        this.press =
          cell < 0
            ? null
            : { cell, t: this.now, button: input.button ?? 0, touch: input.pointerType !== 'mouse', x: input.x, y: input.y, done: false };
      } else if (input.phase === 'move') {
        if (this.press && Math.hypot(input.x - this.press.x, input.y - this.press.y) > this.size * 0.6) this.press.done = true;
      } else {
        const p = this.press;
        this.press = null;
        if (!p || p.done) return;
        if (p.button === 2) this.toggleFlag(p.cell);
        else if (p.button === 1) this.chord(p.cell);
        else this.act(p.cell);
      }
      return;
    }
    if (input.kind !== 'press') return;
    this.kb = true;
    const x = this.cursor % this.cols;
    const y = Math.floor(this.cursor / this.cols);
    switch (input.action) {
      case 'left':
        this.cursor = y * this.cols + ((x - 1 + this.cols) % this.cols);
        break;
      case 'right':
        this.cursor = y * this.cols + ((x + 1) % this.cols);
        break;
      case 'up':
        this.cursor = ((y - 1 + this.rows) % this.rows) * this.cols + x;
        break;
      case 'down':
        this.cursor = ((y + 1) % this.rows) * this.cols + x;
        break;
      case 'a':
        this.act(this.cursor);
        break;
      case 'b':
        this.toggleFlag(this.cursor);
        break;
    }
  }

  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#0a0710';
    g.fillRect(0, 0, W, H);

    // HUD
    const flagsUsed = this.flags.filter(Boolean).length;
    g.font = '10px "Press Start 2P", monospace';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = COLOR;
    g.fillText(`MINES ${this.mineCount - flagsUsed}`, 10, TOP / 2);
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    g.fillText(fmtTime(this.time), W / 2, TOP / 2);
    g.textAlign = 'right';
    g.fillStyle = '#9a96ad';
    g.fillText(this.label, W - 10, TOP / 2);

    const s = this.size;
    const fontPx = Math.max(9, Math.floor(s * 0.55));
    const lost = this.exploded >= 0;
    for (let i = 0; i < this.cols * this.rows; i++) {
      const x = this.ox + (i % this.cols) * s;
      const y = this.oy + Math.floor(i / this.cols) * s;
      if (this.open[i] || (lost && this.mines[i] && !this.flags[i])) {
        g.fillStyle = i === this.exploded ? '#7a1028' : '#16121f';
        g.fillRect(x, y, s, s);
        g.strokeStyle = '#241d33';
        g.lineWidth = 1;
        g.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
        if (this.mines[i]) drawMine(g, x + s / 2, y + s / 2, s * 0.28);
        else if (this.counts[i]) {
          g.fillStyle = NUM_COLORS[this.counts[i]];
          g.font = `${fontPx}px "Press Start 2P", monospace`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(String(this.counts[i]), x + s / 2 + 1, y + s / 2 + 1);
        }
      } else {
        g.fillStyle = '#2b2140';
        g.fillRect(x + 1, y + 1, s - 2, s - 2);
        g.fillStyle = '#3d2f5c';
        g.fillRect(x + 1, y + 1, s - 2, 2);
        g.fillRect(x + 1, y + 1, 2, s - 2);
        g.fillStyle = '#17112a';
        g.fillRect(x + 1, y + s - 3, s - 2, 2);
        g.fillRect(x + s - 3, y + 1, 2, s - 2);
        if (this.flags[i]) {
          drawFlag(g, x + s / 2, y + s / 2, s * 0.32);
          if (lost && !this.mines[i]) {
            g.strokeStyle = '#fff';
            g.lineWidth = 2;
            g.beginPath();
            g.moveTo(x + 4, y + 4);
            g.lineTo(x + s - 4, y + s - 4);
            g.moveTo(x + s - 4, y + 4);
            g.lineTo(x + 4, y + s - 4);
            g.stroke();
          }
        }
      }
    }

    // Board frame
    g.strokeStyle = COLOR;
    g.lineWidth = 2;
    g.strokeRect(this.ox - 2, this.oy - 2, s * this.cols + 4, s * this.rows + 4);

    // Long-press progress ring
    const p = this.press;
    if (p && p.touch && !p.done) {
      const k = Math.min(1, (this.now - p.t) / LONG_PRESS);
      if (k > 0.15) {
        const cx = this.ox + (p.cell % this.cols) * s + s / 2;
        const cy = this.oy + Math.floor(p.cell / this.cols) * s + s / 2;
        g.strokeStyle = COLOR;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(cx, cy, s * 0.6, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
        g.stroke();
      }
    }

    // Keyboard cursor
    if (this.kb && !this.ended) {
      const cx = this.ox + (this.cursor % this.cols) * s;
      const cy = this.oy + Math.floor(this.cursor / this.cols) * s;
      g.strokeStyle = '#ffe14d';
      g.lineWidth = 2;
      g.strokeRect(cx + 1, cy + 1, s - 2, s - 2);
    }
  }

  destroy(): void {
    this.mines = [];
  }
}

function drawMine(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.strokeStyle = '#f4f1ff';
  g.lineWidth = Math.max(1.5, r * 0.25);
  g.beginPath();
  for (let k = 0; k < 4; k++) {
    const a = (Math.PI / 4) * k;
    g.moveTo(x + Math.cos(a) * r * 1.45, y + Math.sin(a) * r * 1.45);
    g.lineTo(x - Math.cos(a) * r * 1.45, y - Math.sin(a) * r * 1.45);
  }
  g.stroke();
  g.fillStyle = '#f4f1ff';
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = COLOR;
  g.fillRect(x - r * 0.45, y - r * 0.45, r * 0.4, r * 0.4);
}

function drawFlag(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.fillStyle = '#f4f1ff';
  g.fillRect(x - r * 0.15, y - r, Math.max(2, r * 0.2), r * 2);
  g.fillRect(x - r * 0.7, y + r * 0.8, r * 1.4, Math.max(2, r * 0.25));
  g.fillStyle = COLOR;
  g.beginPath();
  g.moveTo(x + r * 0.05, y - r);
  g.lineTo(x + r * 0.95, y - r * 0.55);
  g.lineTo(x + r * 0.05, y - r * 0.1);
  g.closePath();
  g.fill();
}

function preview(g: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  const cols = 10;
  const rows = 6;
  const s = 26;
  const ox = (w - cols * s) / 2;
  const oy = (h - rows * s) / 2;
  const layout = [
    '1F1..12F1.',
    '111..1F21.',
    '.....1121.',
    '11......11',
    'F1.....12F',
    '11....1F##',
  ];
  const step = Math.floor(t * 1.2) % 6;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = layout[r][c];
      const x = ox + c * s;
      const y = oy + r * s;
      const covered = ch === 'F' || ch === '#';
      if (covered) {
        g.fillStyle = '#2b2140';
        g.fillRect(x + 1, y + 1, s - 2, s - 2);
        g.fillStyle = '#3d2f5c';
        g.fillRect(x + 1, y + 1, s - 2, 2);
        if (ch === 'F') drawFlag(g, x + s / 2, y + s / 2, s * 0.32);
      } else {
        g.fillStyle = '#16121f';
        g.fillRect(x, y, s, s);
        if (ch !== '.') {
          g.fillStyle = NUM_COLORS[Number(ch)];
          g.font = '12px "Press Start 2P", monospace';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(ch, x + s / 2 + 1, y + s / 2 + 1);
        }
      }
    }
  }
  // Moving cursor
  const cx = ox + ((step * 3) % cols) * s;
  const cy = oy + (step % rows) * s;
  g.strokeStyle = '#ffe14d';
  g.lineWidth = 2;
  g.strokeRect(cx + 1, cy + 1, s - 2, s - 2);
  g.strokeStyle = COLOR;
  g.strokeRect(ox - 2, oy - 2, cols * s + 4, rows * s + 4);
}

export const mineField: GameDef = {
  id: 'minefield',
  title: 'Mine Field',
  tagline: 'Clear the grid without a bang.',
  color: COLOR,
  width: W,
  height: H,
  controls: {
    keys: 'Click reveals · Right-click flags · Click a number to chord · Keys: arrows, Space, X flags',
    touch: 'Tap reveals or chords · Long-press to flag',
  },
  touch: { pointer: true },
  modes: [
    { id: 'beginner', label: 'Beginner' },
    { id: 'intermediate', label: 'Intermediate' },
    { id: 'expert', label: 'Expert' },
  ],
  lowerIsBetter: true,
  formatScore: (n) => fmtTime(n),
  create: () => new MineField(),
  preview,
};
