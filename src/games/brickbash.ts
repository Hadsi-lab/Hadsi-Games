import type { Game, GameContext, GameDef, GameInput } from '../core/types';

// ---------- layout (logical units) ----------
const W = 480;
const H = 640;
const TOP = 52; // top wall; HUD band sits above it
const COLS = 10;
const BW = 44;
const BH = 18;
const GAP = 4;
const OX = (W - (COLS * BW + (COLS - 1) * GAP)) / 2;
const OY = TOP + 44;
const PADDLE_Y = 592;
const PADDLE_H = 12;
const PADDLE_W = 80;
const WIDE_W = 128;
const PADDLE_SPEED = 520;
const R = 6;
const MAX_BALLS = 6;
const MAX_LIVES = 5;
const COLOR = '#ff3df0';

const ROW_COLORS = ['#ff4d6d', '#ff8c42', '#ffd23f', '#3ddc97', '#38b6ff', '#9b5de5', '#f15bb5', '#4dfff3'];
const POINTS = [0, 50, 80, 120];

// '.' empty, '1'-'3' hits to break, '#' steel (unbreakable).
const LEVELS: string[][] = [
  ['1111111111', '1111111111', '1111111111', '1111111111', '1111111111'],
  ['....22....', '...2112...', '..211112..', '.21111112.', '2111111112', '1111111111'],
  ['3333333333', '2.2.22.2.2', '1111111111', '1#1#11#1#1', '2222222222', '1111111111'],
  ['....33....', '...3223...', '..322223..', '.32211223.', '..322223..', '...3223...', '....33....'],
  ['#33333333#', '#22222222#', '#11111111#', '#.1.11.1.#', '#11111111#', '###....###'],
  ['3.3.3.3.3.', '.2.2.2.2.2', '3.3.3.3.3.', '.2.2.2.2.2', '1111111111', '1111111111', '##..##..##'],
];

type PowerType = 'wide' | 'multi' | 'slow' | 'life';
const POWER_STYLE: Record<PowerType, { label: string; color: string }> = {
  wide: { label: 'W', color: '#38b6ff' },
  multi: { label: 'M', color: '#ffd23f' },
  slow: { label: 'S', color: '#3ddc97' },
  life: { label: '+', color: '#ff4d6d' },
};

interface Brick {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  steel: boolean;
  color: string;
  flash: number;
}

interface Ball {
  x: number;
  y: number;
  dx: number; // unit direction
  dy: number;
  stuck: boolean;
  offset: number; // x offset from paddle centre while stuck
}

interface Power {
  x: number;
  y: number;
  type: PowerType;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

class BrickBash implements Game {
  private ctx!: GameContext;
  private score = 0;
  private lives = 3;
  private level = 1;
  private speed = 330;
  private bricks: Brick[] = [];
  private balls: Ball[] = [];
  private powers: Power[] = [];
  private particles: Particle[] = [];
  private px = W / 2; // paddle centre
  private pw = PADDLE_W;
  private pointerX: number | null = null;
  private wideT = 0;
  private slowT = 0;
  private bannerT = 0;
  private shakeT = 0;
  private time = 0;
  private over = false;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.loadLevel(1);
  }

  private loadLevel(n: number): void {
    this.level = n;
    this.speed = Math.min(330 + (n - 1) * 25, 480);
    this.bricks = [];
    LEVELS[n - 1].forEach((row, r) => {
      [...row].forEach((ch, c) => {
        if (ch === '.') return;
        const steel = ch === '#';
        const hp = steel ? 1 : Number(ch);
        this.bricks.push({
          x: OX + c * (BW + GAP),
          y: OY + r * (BH + GAP),
          hp,
          maxHp: hp,
          steel,
          color: ROW_COLORS[r % ROW_COLORS.length],
          flash: 0,
        });
      });
    });
    this.powers = [];
    this.wideT = 0;
    this.slowT = 0;
    this.bannerT = 1.6;
    this.resetBall();
  }

  private resetBall(): void {
    this.balls = [{ x: this.px, y: PADDLE_Y - R, dx: 0, dy: -1, stuck: true, offset: 0 }];
  }

  private launch(): void {
    for (const b of this.balls) {
      if (!b.stuck) continue;
      const rel = clamp(b.offset / (this.pw / 2), -1, 1);
      const angle = ((rel * 40 + (Math.random() * 20 - 10)) * Math.PI) / 180;
      b.dx = Math.sin(angle);
      b.dy = -Math.cos(angle);
      b.stuck = false;
      this.ctx.sfx.play('bounce');
    }
    this.bannerT = Math.min(this.bannerT, 0.3);
  }

  private addScore(n: number): void {
    this.score += n;
    this.ctx.setScore(this.score);
  }

  update(dt: number): void {
    if (this.over) return;
    this.time += dt;
    this.wideT = Math.max(0, this.wideT - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    this.bannerT = Math.max(0, this.bannerT - dt);
    this.shakeT = Math.max(0, this.shakeT - dt);

    // Paddle
    const dir = (this.ctx.isDown('right') ? 1 : 0) - (this.ctx.isDown('left') ? 1 : 0);
    if (dir !== 0) {
      this.pointerX = null;
      this.px += dir * PADDLE_SPEED * dt;
    } else if (this.pointerX != null) {
      this.px += (this.pointerX - this.px) * Math.min(1, dt * 30);
    }
    const targetW = this.wideT > 0 ? WIDE_W : PADDLE_W;
    this.pw += (targetW - this.pw) * Math.min(1, dt * 10);
    this.px = clamp(this.px, this.pw / 2, W - this.pw / 2);

    // Balls
    const speed = this.speed * (this.slowT > 0 ? 0.65 : 1);
    for (const b of this.balls) {
      if (b.stuck) {
        b.offset = clamp(b.offset, -this.pw / 2 + R, this.pw / 2 - R);
        b.x = this.px + b.offset;
        b.y = PADDLE_Y - R;
      } else {
        this.moveBall(b, speed * dt);
      }
    }
    const before = this.balls.length;
    this.balls = this.balls.filter((b) => b.y - R <= H);
    if (before && !this.balls.length) this.loseLife();

    // Power-ups
    for (const p of this.powers) {
      p.y += 130 * dt;
      if (
        p.y + 8 >= PADDLE_Y &&
        p.y - 8 <= PADDLE_Y + PADDLE_H &&
        Math.abs(p.x - this.px) <= this.pw / 2 + 14
      ) {
        this.applyPower(p.type);
        p.y = H + 100;
      }
    }
    this.powers = this.powers.filter((p) => p.y < H + 20);

    // Effects
    for (const b of this.bricks) b.flash = Math.max(0, b.flash - dt);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 600 * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    // Level clear
    if (!this.over && !this.bricks.some((b) => !b.steel)) this.clearLevel();
  }

  /** Moves a ball `dist` units in small sub-steps so it can't tunnel through bricks. */
  private moveBall(b: Ball, dist: number): void {
    const steps = Math.max(1, Math.ceil(dist / (R * 0.75)));
    const step = dist / steps;
    for (let i = 0; i < steps; i++) {
      b.x += b.dx * step;
      b.y += b.dy * step;

      // Walls
      if (b.x < R) {
        b.x = R;
        b.dx = Math.abs(b.dx);
        this.ctx.sfx.play('blip');
      } else if (b.x > W - R) {
        b.x = W - R;
        b.dx = -Math.abs(b.dx);
        this.ctx.sfx.play('blip');
      }
      if (b.y < TOP + R) {
        b.y = TOP + R;
        b.dy = Math.abs(b.dy);
        this.ctx.sfx.play('blip');
      }

      // Paddle
      const left = this.px - this.pw / 2;
      if (
        b.dy > 0 &&
        b.y + R >= PADDLE_Y &&
        b.y - R <= PADDLE_Y + PADDLE_H &&
        b.x >= left - R &&
        b.x <= left + this.pw + R
      ) {
        const rel = clamp((b.x - this.px) / (this.pw / 2), -1, 1);
        const angle = (rel * 60 * Math.PI) / 180;
        b.dx = Math.sin(angle);
        b.dy = -Math.cos(angle);
        b.y = PADDLE_Y - R;
        this.ctx.sfx.play('bounce');
      }

      // Bricks (one hit per sub-step)
      for (let j = 0; j < this.bricks.length; j++) {
        const k = this.bricks[j];
        const cx = clamp(b.x, k.x, k.x + BW);
        const cy = clamp(b.y, k.y, k.y + BH);
        const ddx = b.x - cx;
        const ddy = b.y - cy;
        if (ddx * ddx + ddy * ddy >= R * R) continue;
        const ox = Math.min(b.x + R - k.x, k.x + BW - (b.x - R));
        const oy = Math.min(b.y + R - k.y, k.y + BH - (b.y - R));
        if (ox < oy) {
          const leftSide = b.x < k.x + BW / 2;
          b.dx = leftSide ? -Math.abs(b.dx) : Math.abs(b.dx);
          b.x = leftSide ? k.x - R : k.x + BW + R;
        } else {
          const above = b.y < k.y + BH / 2;
          b.dy = above ? -Math.abs(b.dy) : Math.abs(b.dy);
          b.y = above ? k.y - R : k.y + BH + R;
        }
        this.hitBrick(j);
        break;
      }

      // Keep the ball from settling into a near-horizontal path.
      if (Math.abs(b.dy) < 0.28) {
        b.dy = b.dy < 0 ? -0.28 : 0.28;
        const len = Math.hypot(b.dx, b.dy);
        b.dx /= len;
        b.dy /= len;
      }
    }
  }

  private hitBrick(index: number): void {
    const k = this.bricks[index];
    if (!this.ctx.reducedMotion) k.flash = 0.12;
    if (k.steel) {
      this.ctx.sfx.play('hit');
      return;
    }
    k.hp--;
    this.speed = Math.min(this.speed + 2, 600);
    if (k.hp > 0) {
      this.ctx.sfx.play('bounce');
      this.addScore(10);
      return;
    }
    this.ctx.sfx.play('brick');
    this.bricks.splice(index, 1);
    this.addScore(POINTS[k.maxHp]);
    const cx = k.x + BW / 2;
    const cy = k.y + BH / 2;
    if (!this.ctx.reducedMotion) {
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 60 + Math.random() * 160;
        this.particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s - 60,
          life: 0.4 + Math.random() * 0.3,
          color: k.color,
        });
      }
    }
    if (this.powers.length < 3 && Math.random() < 0.14) {
      const roll = Math.random();
      const type: PowerType = roll < 0.06 ? 'life' : roll < 0.4 ? 'wide' : roll < 0.72 ? 'multi' : 'slow';
      this.powers.push({ x: cx, y: cy, type });
    }
  }

  private applyPower(type: PowerType): void {
    this.ctx.sfx.play('powerup');
    this.addScore(100);
    if (type === 'wide') this.wideT = 15;
    else if (type === 'slow') this.slowT = 10;
    else if (type === 'life') this.lives = Math.min(MAX_LIVES, this.lives + 1);
    else if (type === 'multi') {
      if (this.balls.some((b) => b.stuck)) this.launch();
      const extra: Ball[] = [];
      for (const b of this.balls) {
        for (const turn of [-25, 25]) {
          if (this.balls.length + extra.length >= MAX_BALLS) break;
          const a = (turn * Math.PI) / 180;
          const dx = b.dx * Math.cos(a) - b.dy * Math.sin(a);
          const dy = b.dx * Math.sin(a) + b.dy * Math.cos(a);
          extra.push({ x: b.x, y: b.y, dx, dy: dy > 0 ? dy : Math.min(dy, -0.3), stuck: false, offset: 0 });
        }
      }
      for (const e of extra) {
        const len = Math.hypot(e.dx, e.dy);
        e.dx /= len;
        e.dy /= len;
      }
      this.balls.push(...extra);
    }
  }

  private loseLife(): void {
    this.lives--;
    this.ctx.sfx.play('explode');
    if (!this.ctx.reducedMotion) this.shakeT = 0.35;
    this.powers = [];
    this.wideT = 0;
    this.slowT = 0;
    if (this.lives <= 0) {
      this.over = true;
      this.ctx.gameOver(this.score, { won: false });
      return;
    }
    this.resetBall();
  }

  private clearLevel(): void {
    this.addScore(500 * this.level);
    if (this.level >= LEVELS.length) {
      this.addScore(this.lives * 1000);
      this.over = true;
      this.balls = [];
      this.ctx.gameOver(this.score, { won: true });
      return;
    }
    this.ctx.sfx.play('levelup');
    this.particles = [];
    this.loadLevel(this.level + 1);
  }

  handleInput(input: GameInput): void {
    if (input.kind === 'pointer') {
      if (input.phase !== 'up') this.pointerX = input.x;
      return;
    }
    if (input.kind !== 'press') return;
    if (input.action === 'left' || input.action === 'right') this.pointerX = null;
    if (input.action === 'a' || input.action === 'up') this.launch();
  }

  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#07060d';
    g.fillRect(0, 0, W, H);

    if (this.shakeT > 0) {
      const m = this.shakeT * 18;
      g.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }

    // HUD band
    g.font = '12px "Press Start 2P", monospace';
    g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    g.textAlign = 'left';
    g.fillText(`LEVEL ${this.level}`, 12, TOP / 2);
    g.textAlign = 'right';
    for (let i = 0; i < this.lives; i++) {
      g.fillStyle = COLOR;
      g.fillRect(W - 12 - (i + 1) * 26 + 4, TOP / 2 - 3, 20, 6);
    }
    // Active power-up timers
    g.textAlign = 'center';
    g.font = '8px "Press Start 2P", monospace';
    const timers: string[] = [];
    if (this.wideT > 0) timers.push(`W ${Math.ceil(this.wideT)}`);
    if (this.slowT > 0) timers.push(`S ${Math.ceil(this.slowT)}`);
    g.fillStyle = '#9aa0b4';
    g.fillText(timers.join('  '), W / 2, TOP / 2);

    // Walls
    g.strokeStyle = COLOR;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(1, H);
    g.lineTo(1, TOP - 1);
    g.lineTo(W - 1, TOP - 1);
    g.lineTo(W - 1, H);
    g.stroke();

    // Bricks
    for (const k of this.bricks) {
      if (k.steel) {
        g.fillStyle = '#5c6270';
        g.fillRect(k.x, k.y, BW, BH);
        g.fillStyle = '#8a91a3';
        g.fillRect(k.x, k.y, BW, 3);
        g.fillStyle = '#3a3e48';
        g.fillRect(k.x + 4, k.y + 7, 4, 4);
        g.fillRect(k.x + BW - 8, k.y + 7, 4, 4);
      } else {
        g.fillStyle = k.color;
        g.globalAlpha = 0.45 + 0.55 * (k.hp / k.maxHp);
        g.fillRect(k.x, k.y, BW, BH);
        g.globalAlpha = 1;
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(k.x, k.y, BW, 3);
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(k.x, k.y + BH - 3, BW, 3);
        // pips show hits remaining on tough bricks
        if (k.maxHp > 1) {
          g.fillStyle = '#07060d';
          for (let i = 0; i < k.hp; i++) g.fillRect(k.x + BW / 2 - (k.hp * 6) / 2 + i * 6 + 1, k.y + 8, 3, 3);
        }
      }
      if (k.flash > 0) {
        g.fillStyle = `rgba(255,255,255,${k.flash / 0.12})`;
        g.fillRect(k.x, k.y, BW, BH);
      }
    }

    // Power-ups
    g.font = '10px "Press Start 2P", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const p of this.powers) {
      const s = POWER_STYLE[p.type];
      g.fillStyle = s.color;
      g.beginPath();
      g.roundRect(p.x - 16, p.y - 8, 32, 16, 8);
      g.fill();
      g.fillStyle = '#07060d';
      g.fillText(s.label, p.x + 1, p.y + 1);
    }

    // Particles
    for (const p of this.particles) {
      g.globalAlpha = Math.min(1, p.life * 2.5);
      g.fillStyle = p.color;
      g.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    g.globalAlpha = 1;

    // Paddle
    g.shadowColor = COLOR;
    g.shadowBlur = 14;
    g.fillStyle = COLOR;
    g.fillRect(this.px - this.pw / 2, PADDLE_Y, this.pw, PADDLE_H);
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillRect(this.px - this.pw / 2, PADDLE_Y, this.pw, 3);

    // Balls
    g.fillStyle = '#fff';
    g.shadowColor = '#fff';
    g.shadowBlur = 10;
    for (const b of this.balls) {
      g.beginPath();
      g.arc(b.x, b.y, R, 0, Math.PI * 2);
      g.fill();
    }
    g.shadowBlur = 0;

    // Banner / launch hint
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (this.bannerT > 0) {
      g.font = '24px "Press Start 2P", monospace';
      g.fillStyle = COLOR;
      g.fillText(`LEVEL ${this.level}`, W / 2, 420);
    }
    if (!this.over && this.balls.some((b) => b.stuck)) {
      const blink = this.ctx.reducedMotion || Math.floor(this.time * 2) % 2 === 0;
      if (blink) {
        g.font = '10px "Press Start 2P", monospace';
        g.fillStyle = '#fff';
        g.fillText('SPACE OR TAP TO LAUNCH', W / 2, 470);
      }
    }
  }

  destroy(): void {
    this.balls = [];
    this.bricks = [];
    this.particles = [];
    this.powers = [];
  }
}

// Stateless lobby preview: a rack of bricks, a bouncing ball and a tracking paddle.
function preview(g: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  const tri = (u: number) => 1 - Math.abs((((u % 2) + 2) % 2) - 1);
  const cols = 10;
  const bw = (w - 24) / cols;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < cols; c++) {
      // a few deterministic gaps so it looks mid-game
      if ((r * 7 + c * 3) % 11 === 0 || (r === 4 && c % 3 === 1)) continue;
      g.fillStyle = ROW_COLORS[r];
      g.fillRect(12 + c * bw + 1, 22 + r * 13, bw - 2, 10);
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.fillRect(12 + c * bw + 1, 22 + r * 13, bw - 2, 2);
    }
  }
  const bx = 16 + tri(t * 0.55) * (w - 32);
  const by = 96 + tri(t * 0.8) * (h - 96 - 30);
  const pw = 54;
  const px = Math.max(pw / 2 + 4, Math.min(w - pw / 2 - 4, bx));
  g.shadowColor = COLOR;
  g.shadowBlur = 10;
  g.fillStyle = COLOR;
  g.fillRect(px - pw / 2, h - 22, pw, 7);
  g.shadowColor = '#fff';
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(bx, by, 4, 0, Math.PI * 2);
  g.fill();
  g.shadowBlur = 0;
}

export const brickBash: GameDef = {
  id: 'brickbash',
  title: 'Brick Bash',
  tagline: 'Six walls of bricks. Catch the power-ups.',
  color: COLOR,
  width: W,
  height: H,
  controls: {
    keys: 'Left/Right or A/D move · Space launches · P pauses',
    touch: 'Drag to move the paddle · Tap to launch',
  },
  touch: { pointer: true, tap: 'a' },
  create: () => new BrickBash(),
  preview,
};
