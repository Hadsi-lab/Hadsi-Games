import type { Game, GameContext, GameDef, GameInput } from '../core/types';

const W = 400;
const H = 600;
const GROUND = H - 48;
const COLOR = '#9dff4d';
const BIRD_X = 110;
const R = 12;
const GRAVITY = 1500;
const FLAP = -430;
const MAX_FALL = 680;
const GATE_W = 62;
const SPACING = 230;

interface Gate {
  x: number;
  gapY: number;
  gap: number;
  passed: boolean;
}

class Wingbeat implements Game {
  private ctx!: GameContext;
  private y = H * 0.42;
  private vy = 0;
  private flapT = 0;
  private gates: Gate[] = [];
  private scroll = 0;
  private score = 0;
  private time = 0;
  private flying = false;
  private dead = false;

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  private speed(): number {
    return Math.min(230, 150 + this.score * 2.5);
  }

  private gapSize(): number {
    return Math.max(128, 172 - this.score * 2);
  }

  private spawnGate(x: number): void {
    const prev = this.gates[this.gates.length - 1];
    const gap = this.gapSize();
    const min = 70 + gap / 2;
    const max = GROUND - 50 - gap / 2;
    let gy = min + Math.random() * (max - min);
    if (prev) gy = Math.max(prev.gapY - 200, Math.min(prev.gapY + 200, gy));
    this.gates.push({ x, gapY: gy, gap, passed: false });
  }

  private flap(): void {
    if (this.dead) return;
    if (!this.flying) {
      this.flying = true;
      this.spawnGate(W + 60);
    }
    this.vy = FLAP;
    this.flapT = 0.18;
    this.ctx.sfx.play('hop');
  }

  update(dt: number): void {
    this.time += dt;
    this.flapT = Math.max(0, this.flapT - dt);
    if (this.dead) return;
    if (!this.flying) {
      // Hover until the first flap.
      this.y = H * 0.42 + (this.ctx.reducedMotion ? 0 : Math.sin(this.time * 3) * 8);
      this.scroll += 60 * dt;
      return;
    }

    this.vy = Math.min(MAX_FALL, this.vy + GRAVITY * dt);
    this.y += this.vy * dt;
    if (this.y < R) {
      this.y = R;
      this.vy = 0;
    }

    const sp = this.speed();
    this.scroll += sp * dt;
    for (const g of this.gates) {
      g.x -= sp * dt;
      if (!g.passed && g.x + GATE_W < BIRD_X - R) {
        g.passed = true;
        this.score++;
        this.ctx.setScore(this.score);
        this.ctx.sfx.play('eat');
      }
    }
    this.gates = this.gates.filter((g) => g.x + GATE_W > -10);
    const last = this.gates[this.gates.length - 1];
    if (!last || last.x < W + 60 - SPACING) this.spawnGate((last?.x ?? W) + SPACING);

    // Collisions
    if (this.y + R >= GROUND) {
      this.y = GROUND - R;
      return this.crash();
    }
    for (const g of this.gates) {
      if (BIRD_X + R < g.x || BIRD_X - R > g.x + GATE_W) continue;
      const top = g.gapY - g.gap / 2;
      const bottom = g.gapY + g.gap / 2;
      // Circle vs the two pillar rectangles.
      for (const [ry1, ry2] of [
        [-1000, top],
        [bottom, GROUND],
      ]) {
        const cx = Math.max(g.x, Math.min(BIRD_X, g.x + GATE_W));
        const cy = Math.max(ry1, Math.min(this.y, ry2));
        if ((BIRD_X - cx) ** 2 + (this.y - cy) ** 2 < (R - 2) ** 2) return this.crash();
      }
    }
  }

  private crash(): void {
    this.dead = true;
    this.ctx.sfx.play('explode');
    this.ctx.gameOver(this.score);
  }

  handleInput(input: GameInput): void {
    if (input.kind === 'press' && (input.action === 'a' || input.action === 'up' || input.action === 'b')) this.flap();
    // Flap on touch-down (not release) so it feels immediate.
    else if (input.kind === 'pointer' && input.phase === 'down') this.flap();
  }

  render(g: CanvasRenderingContext2D): void {
    // Sky
    const sky = g.createLinearGradient(0, 0, 0, GROUND);
    sky.addColorStop(0, '#0a0620');
    sky.addColorStop(1, '#1d0f3a');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    // Parallax skyline (static with reduced motion)
    const par = this.ctx.reducedMotion ? 0 : this.scroll;
    drawSkyline(g, par * 0.25, GROUND, '#24164a', 70, 37);
    drawSkyline(g, par * 0.5, GROUND, '#301d5e', 40, 59);

    // Gates
    for (const gt of this.gates) drawGate(g, gt.x, gt.gapY, gt.gap);

    // Ground
    g.fillStyle = '#120a24';
    g.fillRect(0, GROUND, W, H - GROUND);
    g.fillStyle = COLOR;
    g.fillRect(0, GROUND, W, 3);
    g.fillStyle = 'rgba(157,255,77,0.25)';
    const off = (this.ctx.reducedMotion && !this.flying ? 0 : this.scroll) % 32;
    for (let x = -off; x < W; x += 32) g.fillRect(x, GROUND + 14, 16, 3);

    // Bird
    drawBot(g, BIRD_X, this.y, this.dead ? 1.2 : Math.max(-0.5, Math.min(1.1, this.vy / 600)), this.flapT > 0 || (!this.flying && Math.sin(this.time * 10) > 0), this.dead);

    // Big score
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '28px "Press Start 2P", monospace';
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillText(String(this.score), W / 2 + 3, 63);
    g.fillStyle = '#fff';
    g.fillText(String(this.score), W / 2, 60);

    if (!this.flying && !this.dead) {
      g.font = '10px "Press Start 2P", monospace';
      g.fillStyle = COLOR;
      g.fillText('TAP OR SPACE TO FLAP', W / 2, H * 0.62);
    }
  }

  destroy(): void {
    this.gates = [];
  }
}

function drawSkyline(g: CanvasRenderingContext2D, offset: number, base: number, color: string, maxH: number, seed: number): void {
  g.fillStyle = color;
  const bw = 34;
  const start = Math.floor(offset / bw);
  for (let i = start; i < start + W / bw + 2; i++) {
    const h = 20 + (((i * seed) % 97) / 97) * maxH;
    g.fillRect(i * bw - offset, base - h, bw - 4, h);
  }
}

function drawGate(g: CanvasRenderingContext2D, x: number, gapY: number, gap: number): void {
  const top = gapY - gap / 2;
  const bottom = gapY + gap / 2;
  g.fillStyle = '#3b1f6e';
  g.fillRect(x, 0, GATE_W, top);
  g.fillRect(x, bottom, GATE_W, GROUND - bottom);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(x + 8, 0, 6, top);
  g.fillRect(x + 8, bottom, 6, GROUND - bottom);
  // Glowing caps
  g.fillStyle = COLOR;
  g.fillRect(x - 5, top - 14, GATE_W + 10, 14);
  g.fillRect(x - 5, bottom, GATE_W + 10, 14);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(x - 5, top - 4, GATE_W + 10, 4);
  g.fillRect(x - 5, bottom + 10, GATE_W + 10, 4);
}

/** The flyer: a round neon drone with a single flapping fin. */
function drawBot(g: CanvasRenderingContext2D, x: number, y: number, tilt: number, wingUp: boolean, dead: boolean): void {
  g.save();
  g.translate(x, y);
  g.rotate(tilt * 0.6);
  // Fin
  g.fillStyle = '#4dfff3';
  g.beginPath();
  g.moveTo(-4, 0);
  g.lineTo(-18, wingUp ? -14 : 10);
  g.lineTo(-2, wingUp ? -4 : 6);
  g.closePath();
  g.fill();
  // Body
  g.fillStyle = dead ? '#ff4d6d' : COLOR;
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.fill();
  // Visor
  g.fillStyle = '#120a24';
  g.beginPath();
  g.roundRect(1, -6, 11, 8, 3);
  g.fill();
  g.fillStyle = dead ? '#ff4d6d' : '#4dfff3';
  g.fillRect(7, -4, 3, 3);
  // Beak-like antenna
  g.fillStyle = '#ffe14d';
  g.fillRect(R - 1, 2, 6, 3);
  g.restore();
}

function preview(g: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  const s = h / H;
  g.save();
  g.scale(s, s);
  const vw = w / s;
  const sky = g.createLinearGradient(0, 0, 0, GROUND);
  sky.addColorStop(0, '#0a0620');
  sky.addColorStop(1, '#1d0f3a');
  g.fillStyle = sky;
  g.fillRect(0, 0, vw, H);
  const scroll = t * 160;
  drawSkyline(g, scroll * 0.3, GROUND, '#24164a', 70, 37);
  const span = SPACING;
  const first = Math.floor(scroll / span);
  for (let i = first; i < first + Math.ceil(vw / span) + 2; i++) {
    const gy = 200 + (((i * 73) % 100) / 100) * 220;
    drawGate(g, i * span - scroll + 200, gy, 170);
  }
  g.fillStyle = '#120a24';
  g.fillRect(0, GROUND, vw, H - GROUND);
  g.fillStyle = COLOR;
  g.fillRect(0, GROUND, vw, 3);
  // Bot follows the gap centres smoothly.
  const bx = 160;
  const u = (scroll + bx - 200 + GATE_W / 2) / span;
  const i0 = Math.floor(u);
  const f = u - i0;
  const gy0 = 200 + (((i0 * 73) % 100) / 100) * 220;
  const gy1 = 200 + ((((i0 + 1) * 73) % 100) / 100) * 220;
  const ease = f < 0.5 ? 0 : (f - 0.5) * 2;
  const by = gy0 + (gy1 - gy0) * ease * ease * (3 - 2 * ease);
  drawBot(g, bx, by, 0, Math.sin(t * 12) > 0, false);
  g.restore();
}

export const wingbeat: GameDef = {
  id: 'wingbeat',
  title: 'Wingbeat',
  tagline: 'One button. Thread every gate.',
  color: COLOR,
  width: W,
  height: H,
  controls: {
    keys: 'Space, Up or X to flap · Fly through the gaps',
    touch: 'Tap anywhere to flap · Fly through the gaps',
  },
  touch: { pointer: true },
  create: () => new Wingbeat(),
  preview,
};
