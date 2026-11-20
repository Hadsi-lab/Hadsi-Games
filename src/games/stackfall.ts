import type { Game, GameContext, GameDef, GameInput } from '../core/types';

const W = 440;
const H = 600;
const COLS = 10;
const ROWS = 22; // two hidden rows on top
const HIDDEN = 2;
const CELL = 26;
const BX = 90;
const BY = 50;
const COLOR = '#00e5ff';
const DAS = 0.17;
const ARR = 0.05;
const LOCK_DELAY = 0.5;
const MAX_LOCK_RESETS = 15;
const CLEAR_TIME = 0.25;

type Kind = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
const KINDS: Kind[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

const PIECE_COLORS: Record<Kind, string> = {
  I: '#3df5ff',
  O: '#ffe14d',
  T: '#c86bff',
  S: '#5dff7a',
  Z: '#ff4d6d',
  J: '#4d7cff',
  L: '#ff9f43',
};

// Spawn-state cells and bounding-box size.
const SHAPES: Record<Kind, { n: number; cells: [number, number][] }> = {
  I: { n: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  O: { n: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  T: { n: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  S: { n: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  Z: { n: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  J: { n: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { n: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
};

/** Cells for each of the 4 rotation states, precomputed by rotating clockwise in the box. */
const ROTATIONS: Record<Kind, [number, number][][]> = Object.fromEntries(
  KINDS.map((k) => {
    const { n, cells } = SHAPES[k];
    const states: [number, number][][] = [cells];
    for (let r = 1; r < 4; r++) {
      const prev = states[r - 1];
      states.push(k === 'O' ? prev : prev.map(([x, y]) => [n - 1 - y, x] as [number, number]));
    }
    return [k, states];
  }),
) as Record<Kind, [number, number][][]>;

// Clockwise wall kicks, indexed by the rotation state being left. y is down.
const KICKS_JLSTZ: [number, number][][] = [
  [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]], // 0 -> R
  [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]], // R -> 2
  [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]], // 2 -> L
  [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]], // L -> 0
];
const KICKS_I: [number, number][][] = [
  [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
];

const LINE_POINTS = [0, 100, 300, 500, 800];

interface Piece {
  kind: Kind;
  rot: number;
  x: number;
  y: number;
}

class Stackfall implements Game {
  private ctx!: GameContext;
  private board: (Kind | null)[][] = [];
  private bag: Kind[] = [];
  private queue: Kind[] = [];
  private piece!: Piece;
  private hold: Kind | null = null;
  private holdUsed = false;
  private score = 0;
  private lines = 0;
  private level = 1;
  private fall = 0;
  private lockT = 0;
  private lockResets = 0;
  private dir = 0;
  private dasT = 0;
  private arrT = 0;
  private clearing: { rows: number[]; t: number } | null = null;
  private over = false;
  private flashT = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.board = Array.from({ length: ROWS }, () => Array<Kind | null>(COLS).fill(null));
    while (this.queue.length < 5) this.queue.push(this.draw());
    this.spawn();
  }

  private draw(): Kind {
    if (!this.bag.length) {
      this.bag = [...KINDS];
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    return this.bag.pop()!;
  }

  private spawn(kind?: Kind): void {
    const k = kind ?? this.queue.shift()!;
    if (!kind) this.queue.push(this.draw());
    this.piece = { kind: k, rot: 0, x: k === 'O' ? 4 : 3, y: 0 };
    this.fall = 0;
    this.lockT = 0;
    this.lockResets = 0;
    if (!this.fits(this.piece)) {
      this.over = true;
      this.ctx.gameOver(this.score);
      return;
    }
    // Drop into the visible area straight away if there is room.
    const below = { ...this.piece, y: this.piece.y + 1 };
    if (this.fits(below)) this.piece = below;
  }

  private cells(p: Piece): [number, number][] {
    return ROTATIONS[p.kind][p.rot].map(([x, y]) => [p.x + x, p.y + y]);
  }

  private fits(p: Piece): boolean {
    return this.cells(p).every(
      ([x, y]) => x >= 0 && x < COLS && y >= 0 && y < ROWS && !this.board[y][x],
    );
  }

  private onGround(): boolean {
    return !this.fits({ ...this.piece, y: this.piece.y + 1 });
  }

  private resetLock(): void {
    if (this.onGround() && this.lockResets < MAX_LOCK_RESETS) {
      this.lockT = 0;
      this.lockResets++;
    }
  }

  private shift(dx: number): boolean {
    const p = { ...this.piece, x: this.piece.x + dx };
    if (!this.fits(p)) return false;
    this.piece = p;
    this.resetLock();
    this.ctx.sfx.play('move');
    return true;
  }

  private rotate(): void {
    const p = this.piece;
    if (p.kind === 'O') return;
    const next = (p.rot + 1) % 4;
    const kicks = (p.kind === 'I' ? KICKS_I : KICKS_JLSTZ)[p.rot];
    for (const [kx, ky] of kicks) {
      const t = { ...p, rot: next, x: p.x + kx, y: p.y + ky };
      if (this.fits(t)) {
        this.piece = t;
        this.resetLock();
        this.ctx.sfx.play('rotate');
        return;
      }
    }
  }

  private ghostY(): number {
    let y = this.piece.y;
    while (this.fits({ ...this.piece, y: y + 1 })) y++;
    return y;
  }

  private hardDrop(): void {
    const y = this.ghostY();
    this.addScore((y - this.piece.y) * 2);
    this.piece.y = y;
    this.lock();
  }

  private doHold(): void {
    if (this.holdUsed) return;
    const current = this.piece.kind;
    this.holdUsed = true;
    this.ctx.sfx.play('select');
    if (this.hold) {
      const k = this.hold;
      this.hold = current;
      this.spawn(k);
    } else {
      this.hold = current;
      this.spawn();
    }
  }

  private lock(): void {
    for (const [x, y] of this.cells(this.piece)) this.board[y][x] = this.piece.kind;
    this.holdUsed = false;
    this.ctx.sfx.play('drop');
    const full: number[] = [];
    for (let y = 0; y < ROWS; y++) if (this.board[y].every((c) => c)) full.push(y);
    if (full.length) {
      this.lines += full.length;
      this.addScore(LINE_POINTS[full.length] * this.level);
      const newLevel = 1 + Math.floor(this.lines / 10);
      if (newLevel > this.level) {
        this.level = newLevel;
        this.ctx.sfx.play('levelup');
      } else this.ctx.sfx.play('line');
      if (full.length === 4 && !this.ctx.reducedMotion) this.flashT = 0.3;
      if (this.ctx.reducedMotion) this.removeRows(full);
      else {
        this.clearing = { rows: full, t: CLEAR_TIME };
        return;
      }
    }
    this.spawn();
  }

  private removeRows(rows: number[]): void {
    this.board = this.board.filter((_, y) => !rows.includes(y));
    while (this.board.length < ROWS) this.board.unshift(Array<Kind | null>(COLS).fill(null));
  }

  private addScore(n: number): void {
    if (!n) return;
    this.score += n;
    this.ctx.setScore(this.score);
  }

  private gravity(): number {
    return Math.pow(Math.max(0.05, 0.8 - (this.level - 1) * 0.007), this.level - 1);
  }

  update(dt: number): void {
    if (this.over) return;
    this.flashT = Math.max(0, this.flashT - dt);
    if (this.clearing) {
      this.clearing.t -= dt;
      if (this.clearing.t <= 0) {
        this.removeRows(this.clearing.rows);
        this.clearing = null;
        this.spawn();
      }
      return;
    }

    // Auto-shift (DAS/ARR). Last pressed direction wins; fall back to the other if still held.
    if (this.dir !== 0) {
      const key = this.dir < 0 ? 'left' : 'right';
      if (!this.ctx.isDown(key)) {
        const other = this.dir < 0 ? 'right' : 'left';
        this.dir = this.ctx.isDown(other) ? -this.dir : 0;
        this.dasT = 0;
        this.arrT = 0;
      } else {
        this.dasT += dt;
        if (this.dasT >= DAS) {
          this.arrT += dt;
          while (this.arrT >= ARR) {
            this.arrT -= ARR;
            if (!this.shift(this.dir)) {
              this.arrT = 0;
              break;
            }
          }
        }
      }
    }

    // Gravity, with soft drop.
    const soft = this.ctx.isDown('down');
    const interval = soft ? Math.min(this.gravity(), 0.04) : this.gravity();
    this.fall += dt;
    while (this.fall >= interval) {
      this.fall -= interval;
      if (this.onGround()) break;
      this.piece.y++;
      if (soft) this.addScore(1);
    }

    if (this.onGround()) {
      this.lockT += dt;
      if (this.lockT >= LOCK_DELAY) this.lock();
    } else this.lockT = 0;
  }

  handleInput(input: GameInput): void {
    if (input.kind !== 'press' || this.over || this.clearing) return;
    switch (input.action) {
      case 'left':
      case 'right': {
        const d = input.action === 'left' ? -1 : 1;
        this.dir = d;
        this.dasT = 0;
        this.arrT = 0;
        this.shift(d);
        break;
      }
      case 'up':
        this.rotate();
        break;
      case 'down':
        // Soft drop is held (handled in update); a tap/swipe still drops one row.
        if (!this.onGround()) {
          this.piece.y++;
          this.addScore(1);
          this.fall = 0;
        }
        break;
      case 'a':
        this.hardDrop();
        break;
      case 'b':
        this.doHold();
        break;
    }
  }

  // ---------- rendering ----------
  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#07060d';
    g.fillRect(0, 0, W, H);

    // Board well
    g.fillStyle = '#0d0c18';
    g.fillRect(BX, BY, COLS * CELL, (ROWS - HIDDEN) * CELL);
    g.strokeStyle = 'rgba(255,255,255,0.04)';
    g.lineWidth = 1;
    for (let x = 1; x < COLS; x++) {
      g.beginPath();
      g.moveTo(BX + x * CELL + 0.5, BY);
      g.lineTo(BX + x * CELL + 0.5, BY + (ROWS - HIDDEN) * CELL);
      g.stroke();
    }
    for (let y = 1; y < ROWS - HIDDEN; y++) {
      g.beginPath();
      g.moveTo(BX, BY + y * CELL + 0.5);
      g.lineTo(BX + COLS * CELL, BY + y * CELL + 0.5);
      g.stroke();
    }

    // Settled blocks
    for (let y = HIDDEN; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const k = this.board[y][x];
        if (k) drawCell(g, BX + x * CELL, BY + (y - HIDDEN) * CELL, CELL, PIECE_COLORS[k]);
      }
    }

    // Clearing rows flash
    if (this.clearing) {
      const a = this.clearing.t / CLEAR_TIME;
      g.fillStyle = `rgba(255,255,255,${0.85 * a})`;
      for (const y of this.clearing.rows) g.fillRect(BX, BY + (y - HIDDEN) * CELL, COLS * CELL, CELL);
    } else if (!this.over) {
      // Ghost
      const gy = this.ghostY();
      g.strokeStyle = PIECE_COLORS[this.piece.kind];
      g.globalAlpha = 0.45;
      g.lineWidth = 2;
      for (const [x, y] of ROTATIONS[this.piece.kind][this.piece.rot]) {
        const cy = gy + y - HIDDEN;
        if (cy < 0) continue;
        g.strokeRect(BX + (this.piece.x + x) * CELL + 2, BY + cy * CELL + 2, CELL - 4, CELL - 4);
      }
      g.globalAlpha = 1;
      // Active piece
      for (const [x, y] of this.cells(this.piece)) {
        if (y < HIDDEN) continue;
        drawCell(g, BX + x * CELL, BY + (y - HIDDEN) * CELL, CELL, PIECE_COLORS[this.piece.kind]);
      }
    }

    // Frame
    g.strokeStyle = COLOR;
    g.lineWidth = 2;
    g.strokeRect(BX - 1, BY - 1, COLS * CELL + 2, (ROWS - HIDDEN) * CELL + 2);

    if (this.flashT > 0) {
      g.fillStyle = `rgba(0,229,255,${this.flashT * 0.5})`;
      g.fillRect(BX, BY, COLS * CELL, (ROWS - HIDDEN) * CELL);
    }

    // Side panels
    g.font = '10px "Press Start 2P", monospace';
    g.textBaseline = 'top';
    g.textAlign = 'center';
    g.fillStyle = '#9a96ad';
    g.fillText('HOLD', 45, BY);
    if (this.hold) drawMini(g, this.hold, 45, BY + 40, 14, this.holdUsed ? 0.35 : 1);

    const rx = (BX + COLS * CELL + W) / 2;
    g.fillStyle = '#9a96ad';
    g.fillText('NEXT', rx, BY);
    this.queue.slice(0, 3).forEach((k, i) => drawMini(g, k, rx, BY + 40 + i * 52, i === 0 ? 14 : 11, 1));

    const stats: [string, number][] = [
      ['LEVEL', this.level],
      ['LINES', this.lines],
    ];
    stats.forEach(([label, v], i) => {
      g.fillStyle = '#9a96ad';
      g.font = '8px "Press Start 2P", monospace';
      g.fillText(label, 45, 140 + i * 50);
      g.fillStyle = '#fff';
      g.font = '12px "Press Start 2P", monospace';
      g.fillText(String(v), 45, 156 + i * 50);
    });
  }

  destroy(): void {
    this.board = [];
  }
}

function drawCell(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  g.fillStyle = color;
  g.fillRect(x + 1, y + 1, s - 2, s - 2);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(x + 1, y + 1, s - 2, 3);
  g.fillRect(x + 1, y + 1, 3, s - 2);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(x + 1, y + s - 4, s - 2, 3);
  g.fillRect(x + s - 4, y + 1, 3, s - 2);
}

function drawMini(g: CanvasRenderingContext2D, k: Kind, cx: number, cy: number, s: number, alpha: number): void {
  const cells = ROTATIONS[k][0];
  const xs = cells.map((c) => c[0]);
  const ys = cells.map((c) => c[1]);
  const w = (Math.max(...xs) - Math.min(...xs) + 1) * s;
  const h = (Math.max(...ys) - Math.min(...ys) + 1) * s;
  g.globalAlpha = alpha;
  for (const [x, y] of cells) {
    drawCell(g, cx - w / 2 + (x - Math.min(...xs)) * s, cy - h / 2 + (y - Math.min(...ys)) * s, s, PIECE_COLORS[k]);
  }
  g.globalAlpha = 1;
}

function preview(g: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  const s = 14;
  const cols = 10;
  const ox = (w - cols * s) / 2;
  const rows = Math.floor(h / s);
  g.fillStyle = '#0d0c18';
  g.fillRect(ox, 0, cols * s, h);
  // Fixed stack
  const stack = ['LLL.TTTJJJ', 'ZLSSTOOIJ.', 'ZZ.SSOOIZZ', '.ZJJJTTIZZ'];
  stack.forEach((row, r) => {
    [...row].forEach((c, x) => {
      if (c !== '.') drawCell(g, ox + x * s, h - (stack.length - r) * s, s, PIECE_COLORS[c as Kind]);
    });
  });
  // Falling T piece, cycling
  const fallRows = rows - stack.length - 2;
  const y = Math.floor((t * 4) % fallRows);
  for (const [cx, cy] of ROTATIONS.T[2]) drawCell(g, ox + (3 + cx) * s, (y + cy) * s, s, PIECE_COLORS.T);
  g.strokeStyle = COLOR;
  g.lineWidth = 2;
  g.strokeRect(ox - 1, -2, cols * s + 2, h + 4);
}

export const stackfall: GameDef = {
  id: 'stackfall',
  title: 'Stackfall',
  tagline: 'Stack falling blocks, clear lines.',
  color: COLOR,
  width: W,
  height: H,
  controls: {
    keys: 'Left/Right move · Up rotates · Down soft drop · Space hard drop · X holds',
    touch: 'Swipe or D-pad to move · Tap or Up rotates · DROP and HOLD buttons',
  },
  touch: { swipe: true, dpad: true, tap: 'up', buttons: ['a', 'b'], labels: { a: 'DROP', b: 'HOLD' } },
  create: () => new Stackfall(),
  preview,
};
