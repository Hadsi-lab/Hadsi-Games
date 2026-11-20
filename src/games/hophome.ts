import type { Game, GameContext, GameDef, GameInput } from '../core/types';

const COLS = 13;
const ROWS = 13;
const T = 36;
const TOP = 36;
const W = COLS * T;
const H = TOP + ROWS * T + 24;
const COLOR = '#5dff9d';
const HOP_TIME = 0.12;
const LIFE_TIME = 30;
const DENS = [1, 3.75, 6.5, 9.25, 12];
const START = { x: 6.5, y: 12 };
const WRAP = 4; // off-screen slack on each side

type Kind = 'log' | 'turtle' | 'car' | 'truck';

interface Lane {
  y: number;
  kind: Kind;
  len: number;
  speed: number;
  xs: number[];
  color: string;
  dive?: number; // index of the turtle group that dives
}

// [row, kind, length, base speed (tiles/s, sign = direction), count, colour]
const LANES: [number, Kind, number, number, number, string][] = [
  [1, 'log', 3, 1.1, 3, '#8a5a2b'],
  [2, 'turtle', 2, -1.5, 4, '#2fbf71'],
  [3, 'log', 5, 1.8, 2, '#8a5a2b'],
  [4, 'turtle', 3, -1.2, 3, '#2fbf71'],
  [5, 'log', 3, 1.4, 3, '#8a5a2b'],
  [7, 'truck', 2, -1.2, 2, '#ffb84d'],
  [8, 'car', 1, 2.2, 3, '#ff4d6d'],
  [9, 'car', 1, -1.7, 3, '#4dfff3'],
  [10, 'car', 1, 1.3, 3, '#c86bff'],
  [11, 'car', 1, -0.9, 3, '#ffe14d'],
];

const isRiver = (y: number) => y >= 1 && y <= 5;
const isRoad = (y: number) => y >= 7 && y <= 11;

class HopHome implements Game {
  private ctx!: GameContext;
  private lanes: Lane[] = [];
  private px = START.x;
  private py = START.y;
  private hop: { fx: number; fy: number; tx: number; ty: number; t: number } | null = null;
  private facing = { x: 0, y: -1 };
  private dens = [false, false, false, false, false];
  private best = START.y;
  private timer = LIFE_TIME;
  private score = 0;
  private lives = 3;
  private level = 1;
  private deathT = 0;
  private deathKind: 'splash' | 'squash' = 'squash';
  private clearT = 0;
  private time = 0;
  private over = false;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.buildLanes();
  }

  private buildLanes(): void {
    const mult = 1 + 0.15 * (this.level - 1);
    this.lanes = LANES.map(([y, kind, len, speed, count, color]) => {
      const period = COLS + WRAP * 2;
      return {
        y,
        kind,
        len,
        speed: speed * mult,
        color,
        xs: Array.from({ length: count }, (_, i) => -WRAP + (i * period) / count + Math.random() * 0.6),
        dive: kind === 'turtle' ? 0 : undefined,
      };
    });
  }

  private resetPlayer(): void {
    this.px = START.x;
    this.py = START.y;
    this.hop = null;
    this.best = START.y;
    this.timer = LIFE_TIME;
    this.facing = { x: 0, y: -1 };
  }

  private addScore(n: number): void {
    this.score += n;
    this.ctx.setScore(this.score);
  }

  private submerged(lane: Lane, i: number): number {
    if (lane.dive !== i) return 0;
    const p = (this.time * 0.25 + i * 0.3) % 1;
    if (p < 0.55) return 0;
    if (p < 0.65) return 0.5; // sinking
    if (p < 0.85) return 1; // under
    return 0.5;
  }

  private die(kind: 'splash' | 'squash'): void {
    if (this.deathT > 0) return;
    this.deathT = 1.1;
    this.deathKind = kind;
    this.lives--;
    this.ctx.sfx.play(kind === 'splash' ? 'splash' : 'explode');
  }

  update(dt: number): void {
    if (this.over) return;
    this.time += dt;

    // Traffic and river always move.
    const period = COLS + WRAP * 2;
    for (const l of this.lanes) {
      for (let i = 0; i < l.xs.length; i++) {
        l.xs[i] += l.speed * dt;
        if (l.speed > 0 && l.xs[i] > COLS + WRAP) l.xs[i] -= period;
        if (l.speed < 0 && l.xs[i] + l.len < -WRAP) l.xs[i] += period;
      }
    }

    if (this.clearT > 0) {
      this.clearT -= dt;
      if (this.clearT <= 0) {
        this.level++;
        this.dens = this.dens.map(() => false);
        this.buildLanes();
        this.resetPlayer();
      }
      return;
    }

    if (this.deathT > 0) {
      this.deathT -= dt;
      if (this.deathT <= 0) {
        if (this.lives <= 0) {
          this.over = true;
          this.ctx.gameOver(this.score);
        } else this.resetPlayer();
      }
      return;
    }

    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0;
      this.die('squash');
      return;
    }
    if (this.timer < 5 && Math.ceil(this.timer) !== Math.ceil(this.timer + dt)) this.ctx.sfx.play('tick');

    if (this.hop) {
      this.hop.t += dt;
      const k = Math.min(1, this.hop.t / HOP_TIME);
      this.px = this.hop.fx + (this.hop.tx - this.hop.fx) * k;
      this.py = this.hop.fy + (this.hop.ty - this.hop.fy) * k;
      // Keep drifting with the platform we're hopping along.
      if (k >= 1) {
        this.py = this.hop.ty;
        this.px = this.hop.tx;
        this.hop = null;
        this.land();
      }
      return;
    }
    this.checkPosition(dt);
  }

  private land(): void {
    const y = this.py;
    if (y < this.best) {
      this.best = y;
      this.addScore(10);
    }
    if (y === 0) {
      const i = DENS.findIndex((d) => Math.abs(d - this.px) < 0.6);
      if (i < 0 || this.dens[i]) {
        this.die('squash');
        return;
      }
      this.dens[i] = true;
      this.addScore(50 + Math.floor(this.timer) * 10);
      this.ctx.sfx.play('eat');
      if (this.dens.every(Boolean)) {
        this.addScore(1000);
        this.ctx.sfx.play('levelup');
        this.clearT = 1.6;
        this.px = DENS[i];
        return;
      }
      this.resetPlayer();
      return;
    }
    this.checkPosition(0);
  }

  private checkPosition(dt: number): void {
    const y = Math.round(this.py);
    const lane = this.lanes.find((l) => l.y === y);
    if (isRoad(y) && lane) {
      for (const x of lane.xs) {
        if (this.px + 0.32 > x + 0.08 && this.px - 0.32 < x + lane.len - 0.08) {
          this.die('squash');
          return;
        }
      }
    } else if (isRiver(y) && lane) {
      let on = false;
      lane.xs.forEach((x, i) => {
        if (this.px > x + 0.05 && this.px < x + lane.len - 0.05 && this.submerged(lane, i) < 1) on = true;
      });
      if (!on) {
        this.die('splash');
        return;
      }
      this.px += lane.speed * dt;
      if (this.px < 0.2 || this.px > COLS - 0.2) this.die('splash');
    }
  }

  handleInput(input: GameInput): void {
    if (input.kind !== 'press' || this.hop || this.deathT > 0 || this.clearT > 0 || this.over) return;
    const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[input.action as string];
    if (!d) return;
    const tx = this.px + d[0];
    const ty = this.py + d[1];
    this.facing = { x: d[0], y: d[1] };
    if (ty > ROWS - 1 || ty < 0 || tx < 0.3 || tx > COLS - 0.3) return;
    this.hop = { fx: this.px, fy: this.py, tx, ty, t: 0 };
    this.ctx.sfx.play('hop');
  }

  // ---------- render ----------
  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#07060d';
    g.fillRect(0, 0, W, H);

    // HUD
    g.font = '10px "Press Start 2P", monospace';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.fillText(`LEVEL ${this.level}`, 10, TOP / 2);
    for (let i = 0; i < this.lives; i++) drawHopper(g, W - 20 - i * 24, TOP / 2, 0.5, { x: 0, y: -1 }, 0);

    g.save();
    g.translate(0, TOP);

    // Ground
    for (let y = 0; y < ROWS; y++) {
      if (isRiver(y)) g.fillStyle = '#0b2a6b';
      else if (isRoad(y)) g.fillStyle = '#16151d';
      else if (y === 0) g.fillStyle = '#123d24';
      else g.fillStyle = '#2a1640';
      g.fillRect(0, y * T, W, T);
    }
    // River shimmer
    g.fillStyle = 'rgba(120,180,255,0.12)';
    for (let y = 1; y <= 5; y++) {
      for (let x = 0; x < COLS; x += 2) {
        const off = this.ctx.reducedMotion ? 0 : (this.time * 12 + y * 7) % (2 * T);
        g.fillRect(x * T + off - T, y * T + T / 2, 10, 2);
      }
    }
    // Road markings
    g.fillStyle = 'rgba(255,255,255,0.25)';
    for (let y = 8; y <= 11; y++) for (let x = 0; x < W; x += 36) g.fillRect(x + 6, y * T - 1, 18, 2);
    // Kerbs
    g.fillStyle = COLOR;
    g.fillRect(0, 6 * T, W, 2);
    g.fillRect(0, 7 * T - 2, W, 2);
    g.fillRect(0, 12 * T, W, 2);

    // Dens
    DENS.forEach((dx, i) => {
      const x = dx * T;
      g.fillStyle = '#062014';
      g.fillRect(x - T * 0.55, 6, T * 1.1, T - 6);
      g.strokeStyle = COLOR;
      g.lineWidth = 2;
      g.strokeRect(x - T * 0.55, 6, T * 1.1, T - 6);
      if (this.dens[i]) drawHopper(g, x, T / 2 + 3, 0.8, { x: 0, y: 1 }, 0);
    });

    // Lanes
    for (const l of this.lanes) {
      l.xs.forEach((x, i) => {
        const px = x * T;
        const py = l.y * T;
        if (l.kind === 'log') drawLog(g, px, py, l.len * T);
        else if (l.kind === 'turtle') drawTurtles(g, px, py, l.len, this.submerged(l, i), l.speed < 0);
        else drawVehicle(g, px, py, l.len * T, l.color, l.speed > 0, l.kind === 'truck');
      });
    }

    // Player
    if (this.deathT > 0) {
      const k = 1 - this.deathT / 1.1;
      const cx = this.px * T;
      const cy = this.py * T + T / 2;
      if (this.deathKind === 'splash') {
        g.strokeStyle = '#bfe3ff';
        g.lineWidth = 2;
        for (let r = 0; r < 3; r++) {
          g.beginPath();
          g.arc(cx, cy, 4 + (this.ctx.reducedMotion ? r * 6 : k * 16 + r * 6), 0, Math.PI * 2);
          g.stroke();
        }
      } else {
        g.fillStyle = '#ff4d6d';
        g.globalAlpha = 1 - k * 0.6;
        g.fillRect(cx - 12, cy - 4, 24, 8);
        g.fillRect(cx - 4, cy - 12, 8, 24);
        g.globalAlpha = 1;
      }
    } else if (this.clearT <= 0) {
      const lift = this.hop ? Math.sin((this.hop.t / HOP_TIME) * Math.PI) * 6 : 0;
      drawHopper(g, this.px * T, this.py * T + T / 2 - lift, 1, this.facing, this.hop ? 1 : 0);
    }

    // Timer bar
    const frac = this.timer / LIFE_TIME;
    g.fillStyle = '#9a96ad';
    g.font = '8px "Press Start 2P", monospace';
    g.textAlign = 'left';
    g.fillText('TIME', 8, ROWS * T + 12);
    g.fillStyle = frac < 0.2 ? '#ff4d6d' : COLOR;
    g.fillRect(52, ROWS * T + 7, (W - 62) * frac, 10);
    if (this.clearT > 0) {
      g.fillStyle = COLOR;
      g.font = '14px "Press Start 2P", monospace';
      g.textAlign = 'center';
      g.fillText('ALL HOME!', W / 2, 6.5 * T);
    }
    g.restore();
  }

  destroy(): void {
    this.lanes = [];
  }
}

function drawLog(g: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  g.fillStyle = '#8a5a2b';
  g.beginPath();
  g.roundRect(x + 2, y + 6, w - 4, T - 12, 10);
  g.fill();
  g.fillStyle = '#a8743d';
  g.fillRect(x + 8, y + 10, w - 16, 3);
  g.fillStyle = '#5e3b19';
  g.fillRect(x + 12, y + T - 15, w - 30, 2);
  g.fillStyle = '#c9965b';
  g.beginPath();
  g.ellipse(x + w - 9, y + T / 2, 5, 10, 0, 0, Math.PI * 2);
  g.fill();
}

function drawTurtles(g: CanvasRenderingContext2D, x: number, y: number, n: number, sub: number, left: boolean): void {
  for (let i = 0; i < n; i++) {
    const cx = x + i * T + T / 2;
    const cy = y + T / 2;
    if (sub >= 1) {
      g.strokeStyle = 'rgba(191,227,255,0.5)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx, cy, 8, 0, Math.PI * 2);
      g.stroke();
      continue;
    }
    g.globalAlpha = sub > 0 ? 0.5 : 1;
    g.fillStyle = '#1f8a4f';
    g.beginPath();
    g.arc(cx + (left ? -12 : 12), cy, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2fbf71';
    g.beginPath();
    g.arc(cx, cy, 13, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#145c34';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx - 9, cy);
    g.lineTo(cx + 9, cy);
    g.moveTo(cx, cy - 9);
    g.lineTo(cx, cy + 9);
    g.stroke();
    g.globalAlpha = 1;
  }
}

function drawVehicle(g: CanvasRenderingContext2D, x: number, y: number, w: number, color: string, right: boolean, truck: boolean): void {
  const top = y + 7;
  const h = T - 14;
  g.fillStyle = '#05050a';
  g.fillRect(x + 5, top - 3, 8, 4);
  g.fillRect(x + w - 13, top - 3, 8, 4);
  g.fillRect(x + 5, top + h - 1, 8, 4);
  g.fillRect(x + w - 13, top + h - 1, 8, 4);
  g.fillStyle = color;
  g.fillRect(x + 2, top, w - 4, h);
  g.fillStyle = 'rgba(10,10,20,0.75)';
  if (truck) {
    const cab = right ? x + w - 16 : x + 4;
    g.fillRect(cab, top + 3, 12, h - 6);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(right ? x + 4 : x + 18, top + 3, w - 24, h - 6);
  } else {
    g.fillRect(right ? x + w - 13 : x + 5, top + 3, 8, h - 6);
  }
  g.fillStyle = '#fff6c2';
  g.fillRect(right ? x + w - 4 : x + 2, top + 2, 2, 4);
  g.fillRect(right ? x + w - 4 : x + 2, top + h - 6, 2, 4);
}

/** The hopper: a squat neon critter with big eyes. */
function drawHopper(g: CanvasRenderingContext2D, x: number, y: number, s: number, dir: { x: number; y: number }, legs: number): void {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.rotate(Math.atan2(dir.x, -dir.y));
  g.fillStyle = '#2fbf71';
  const spread = 4 + legs * 4;
  g.fillRect(-11 - legs * 2, -2 - spread, 5, 6);
  g.fillRect(6 + legs * 2, -2 - spread, 5, 6);
  g.fillRect(-11 - legs * 2, 4 + legs * 2, 5, 6);
  g.fillRect(6 + legs * 2, 4 + legs * 2, 5, 6);
  g.fillStyle = COLOR;
  g.beginPath();
  g.roundRect(-9, -9, 18, 18, 6);
  g.fill();
  g.fillStyle = '#fff';
  g.fillRect(-7, -10, 5, 5);
  g.fillRect(2, -10, 5, 5);
  g.fillStyle = '#07060d';
  g.fillRect(-5, -10, 2, 2);
  g.fillRect(4, -10, 2, 2);
  g.restore();
}

function preview(g: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  const s = 0.62;
  g.save();
  g.scale(s, s);
  const W2 = w / s;
  const rows = [
    { y: 0, kind: 'river' },
    { y: 1, kind: 'river' },
    { y: 2, kind: 'safe' },
    { y: 3, kind: 'road' },
    { y: 4, kind: 'road' },
    { y: 5, kind: 'safe' },
  ];
  const oy = (h / s - rows.length * T) / 2;
  for (const r of rows) {
    g.fillStyle = r.kind === 'river' ? '#0b2a6b' : r.kind === 'road' ? '#16151d' : '#2a1640';
    g.fillRect(0, oy + r.y * T, W2, T);
  }
  const span = W2 + 200;
  const m = (v: number) => (((v % span) + span) % span) - 100;
  for (let i = 0; i < 3; i++) drawLog(g, m(t * 50 + i * 190), oy, 3 * T);
  for (let i = 0; i < 4; i++) drawTurtles(g, m(-t * 40 + i * 150), oy + T, 2, 0, true);
  for (let i = 0; i < 3; i++) drawVehicle(g, m(t * 90 + i * 200), oy + 3 * T, T, '#ff4d6d', true, false);
  for (let i = 0; i < 2; i++) drawVehicle(g, m(-t * 60 + i * 260), oy + 4 * T, 2 * T, '#ffb84d', false, true);
  // Hopper hopping up through the safe rows on a loop.
  const step = Math.floor(t * 1.5) % 4;
  const frac = (t * 1.5) % 1;
  const ys = [5, 2, 2, 5];
  const yy = ys[step];
  const lift = frac < 0.3 ? Math.sin((frac / 0.3) * Math.PI) * 8 : 0;
  drawHopper(g, W2 / 2, oy + yy * T + T / 2 - lift, 1, { x: 0, y: -1 }, lift > 0 ? 1 : 0);
  g.restore();
}

export const hopHome: GameDef = {
  id: 'hophome',
  title: 'Hop Home',
  tagline: 'Cross the road, ride the river.',
  color: COLOR,
  width: W,
  height: H,
  controls: {
    keys: 'Arrows or WASD hop · Fill all five dens before time runs out',
    touch: 'Tap to hop forward · Swipe or D-pad to hop any way',
  },
  touch: { swipe: true, dpad: true, tap: 'up' },
  create: () => new HopHome(),
  preview,
};
