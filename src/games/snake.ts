import type { Game, GameContext, GameDef, GameInput } from '../core/types';

const COLS = 20;
const ROWS = 20;
const CELL = 22;
const TOP = 40;
const W = COLS * CELL;
const H = TOP + ROWS * CELL;
const COLOR = '#39ff88';
const BONUS_TIME = 6;

interface P {
  x: number;
  y: number;
}
const DIRS: Record<string, P> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

class Serpentine implements Game {
  private ctx!: GameContext;
  private snake: P[] = [];
  private dir: P = DIRS.right;
  private queue: P[] = [];
  private food: P = { x: 0, y: 0 };
  private bonus: (P & { t: number }) | null = null;
  private grow = 0;
  private acc = 0;
  private eaten = 0;
  private score = 0;
  private time = 0;
  private dead = false;
  private moving = false;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    const cy = Math.floor(ROWS / 2);
    this.snake = [3, 2, 1, 0].map((i) => ({ x: 4 + i, y: cy }));
    this.food = this.freeCell();
  }

  private freeCell(): P {
    const taken = new Set(this.snake.map((s) => s.y * COLS + s.x));
    if (this.bonus) taken.add(this.bonus.y * COLS + this.bonus.x);
    taken.add(this.food.y * COLS + this.food.x);
    const free: number[] = [];
    for (let i = 0; i < COLS * ROWS; i++) if (!taken.has(i)) free.push(i);
    const k = free[Math.floor(Math.random() * free.length)] ?? 0;
    return { x: k % COLS, y: Math.floor(k / COLS) };
  }

  private interval(): number {
    return Math.max(0.055, 0.14 - (this.snake.length - 4) * 0.0025);
  }

  update(dt: number): void {
    if (this.dead) return;
    this.time += dt;
    if (this.bonus) {
      this.bonus.t -= dt;
      if (this.bonus.t <= 0) this.bonus = null;
    }
    if (!this.moving) return;
    // Fixed-step movement.
    this.acc += dt;
    let guard = 0;
    while (this.acc >= this.interval() && !this.dead && guard++ < 5) {
      this.acc -= this.interval();
      this.step();
    }
  }

  private step(): void {
    const next = this.queue.shift();
    if (next) this.dir = next;
    const head = this.snake[0];
    const nh = { x: head.x + this.dir.x, y: head.y + this.dir.y };
    const tailMoves = this.grow === 0;
    const body = tailMoves ? this.snake.slice(0, -1) : this.snake;
    if (nh.x < 0 || nh.y < 0 || nh.x >= COLS || nh.y >= ROWS || body.some((s) => s.x === nh.x && s.y === nh.y)) {
      this.dead = true;
      this.ctx.sfx.play('explode');
      this.ctx.gameOver(this.score);
      return;
    }
    this.snake.unshift(nh);
    if (this.grow > 0) this.grow--;
    else this.snake.pop();

    if (nh.x === this.food.x && nh.y === this.food.y) {
      this.grow += 1;
      this.eaten++;
      this.addScore(10);
      this.ctx.sfx.play('eat');
      this.food = this.freeCell();
      if (this.eaten % 5 === 0 && !this.bonus) this.bonus = { ...this.freeCell(), t: BONUS_TIME };
    } else if (this.bonus && nh.x === this.bonus.x && nh.y === this.bonus.y) {
      this.grow += 3;
      this.addScore(20 + Math.ceil(this.bonus.t) * 10);
      this.ctx.sfx.play('powerup');
      this.bonus = null;
    }
  }

  private addScore(n: number): void {
    this.score += n;
    this.ctx.setScore(this.score);
  }

  handleInput(input: GameInput): void {
    if (input.kind !== 'press') return;
    if (!this.moving && input.action === 'a') {
      this.moving = true;
      return;
    }
    const d = DIRS[input.action];
    if (!d) return;
    if (!this.moving) {
      this.moving = true;
      if (d.x === -this.dir.x && d.y === -this.dir.y) return; // can't start by reversing
    }
    // Buffer up to two turns; ignore reversals and repeats relative to the last queued direction.
    const last = this.queue[this.queue.length - 1] ?? this.dir;
    if ((d.x === -last.x && d.y === -last.y) || (d.x === last.x && d.y === last.y)) return;
    if (this.queue.length < 2) this.queue.push(d);
  }

  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#06080a';
    g.fillRect(0, 0, W, H);

    // HUD
    g.font = '10px "Press Start 2P", monospace';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.fillText(`LENGTH ${this.snake.length}`, 10, TOP / 2);
    if (this.bonus) {
      g.textAlign = 'right';
      g.fillStyle = '#ffe14d';
      g.fillText(`BONUS ${Math.ceil(this.bonus.t)}`, W - 10, TOP / 2);
    }

    g.save();
    g.translate(0, TOP);
    // Grid
    g.fillStyle = '#0b1210';
    g.fillRect(0, 0, W, ROWS * CELL);
    g.fillStyle = 'rgba(57,255,136,0.05)';
    for (let y = 0; y < ROWS; y++) for (let x = (y % 2); x < COLS; x += 2) g.fillRect(x * CELL, y * CELL, CELL, CELL);

    // Food
    drawFood(g, this.food.x * CELL + CELL / 2, this.food.y * CELL + CELL / 2, CELL);
    if (this.bonus) {
      const pulse = this.ctx.reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(this.time * 10);
      drawStar(g, this.bonus.x * CELL + CELL / 2, this.bonus.y * CELL + CELL / 2, CELL * 0.45 * pulse);
    }

    // Snake
    const n = this.snake.length;
    this.snake.forEach((s, i) => {
      const k = i / Math.max(1, n - 1);
      g.fillStyle = this.dead && i === 0 ? '#ff4d6d' : mix('#39ff88', '#1a8a7a', k);
      const pad = i === 0 ? 1 : 2;
      g.beginPath();
      g.roundRect(s.x * CELL + pad, s.y * CELL + pad, CELL - pad * 2, CELL - pad * 2, i === 0 ? 6 : 4);
      g.fill();
    });
    // Eyes
    const h = this.snake[0];
    const cx = h.x * CELL + CELL / 2;
    const cy = h.y * CELL + CELL / 2;
    const px = -this.dir.y;
    const py = this.dir.x;
    g.fillStyle = '#06080a';
    for (const side of [-1, 1]) {
      g.fillRect(cx + this.dir.x * 4 + px * side * 5 - 2, cy + this.dir.y * 4 + py * side * 5 - 2, 4, 4);
    }
    g.strokeStyle = COLOR;
    g.lineWidth = 2;
    g.strokeRect(1, 1, W - 2, ROWS * CELL - 2);
    if (!this.moving) {
      g.textAlign = 'center';
      g.font = '10px "Press Start 2P", monospace';
      g.fillStyle = '#fff';
      g.fillText('STEER TO START', W / 2, ROWS * CELL * 0.3);
    }
    g.restore();
  }

  destroy(): void {
    this.snake = [];
  }
}

function mix(a: string, b: string, k: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * k)).join(',')})`;
}

function drawFood(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.fillStyle = '#ff4d6d';
  g.beginPath();
  g.moveTo(x, y - s * 0.38);
  g.lineTo(x + s * 0.38, y);
  g.lineTo(x, y + s * 0.38);
  g.lineTo(x - s * 0.38, y);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillRect(x - 2, y - s * 0.22, 3, 3);
}

function drawStar(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.fillStyle = '#ffe14d';
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
}

function preview(g: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  const s = 14;
  const cols = Math.floor(w / s);
  const rows = Math.floor(h / s);
  g.fillStyle = '#0b1210';
  g.fillRect(0, 0, w, h);
  // Snake follows a rectangular loop.
  const x0 = 3;
  const y0 = 3;
  const x1 = cols - 4;
  const y1 = rows - 4;
  const perim = 2 * (x1 - x0 + (y1 - y0));
  const at = (d: number) => {
    d = ((d % perim) + perim) % perim;
    const wd = x1 - x0;
    const hd = y1 - y0;
    if (d < wd) return { x: x0 + d, y: y0 };
    d -= wd;
    if (d < hd) return { x: x1, y: y0 + d };
    d -= hd;
    if (d < wd) return { x: x1 - d, y: y1 };
    d -= wd;
    return { x: x0, y: y1 - d };
  };
  const head = Math.floor(t * 10);
  for (let i = 0; i < 14; i++) {
    const p = at(head - i);
    g.fillStyle = mix('#39ff88', '#1a8a7a', i / 13);
    g.fillRect(p.x * s + 1, p.y * s + 1, s - 2, s - 2);
  }
  const f = at(head + 20 - (head % 20));
  drawFood(g, f.x * s + s / 2, f.y * s + s / 2, s);
}

export const serpentine: GameDef = {
  id: 'snake',
  title: 'Serpentine',
  tagline: 'Eat, grow, and don’t bite yourself.',
  color: COLOR,
  width: W,
  height: H,
  controls: {
    keys: 'Arrows or WASD steer · Gold stars are worth more the faster you get them',
    touch: 'Swipe or D-pad to steer',
  },
  touch: { swipe: true, dpad: true },
  create: () => new Serpentine(),
  preview,
};
