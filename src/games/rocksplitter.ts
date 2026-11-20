import type { Game, GameContext, GameDef, GameInput } from '../core/types';

const W = 520;
const H = 600;
const TOP = 36;
const COLOR = '#ff9f43';
const SHIP_R = 10;
const TURN = 4.2;
const THRUST = 280;
const MAX_SPEED = 380;
const BULLET_SPEED = 500;
const BULLET_LIFE = 0.85;
const MAX_BULLETS = 5;
const FIRE_COOLDOWN = 0.16;
const ROCK_R = [0, 13, 25, 46];
const ROCK_POINTS = [0, 100, 50, 20];

interface Vec {
  x: number;
  y: number;
}
interface Rock extends Vec {
  vx: number;
  vy: number;
  size: number;
  r: number;
  angle: number;
  spin: number;
  shape: number[];
}
interface Bullet extends Vec {
  vx: number;
  vy: number;
  life: number;
}
interface Spark extends Vec {
  vx: number;
  vy: number;
  life: number;
  len: number;
  a: number;
}

const wrap = (p: Vec) => {
  if (p.x < 0) p.x += W;
  if (p.x >= W) p.x -= W;
  if (p.y < TOP) p.y += H - TOP;
  if (p.y >= H) p.y -= H - TOP;
};

/** Shortest distance on the wrapped playfield. */
const wrapDist = (a: Vec, b: Vec) => {
  let dx = Math.abs(a.x - b.x);
  let dy = Math.abs(a.y - b.y);
  dx = Math.min(dx, W - dx);
  dy = Math.min(dy, H - TOP - dy);
  return Math.hypot(dx, dy);
};

function makeShape(seed: number): number[] {
  const n = 11;
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    out.push(0.72 + (s / 233280) * 0.42);
  }
  return out;
}

class RockSplitter implements Game {
  private ctx!: GameContext;
  private ship = { x: W / 2, y: (H + TOP) / 2, vx: 0, vy: 0, a: -Math.PI / 2 };
  private rocks: Rock[] = [];
  private bullets: Bullet[] = [];
  private sparks: Spark[] = [];
  private score = 0;
  private lives = 3;
  private wave = 0;
  private nextLife = 10000;
  private cooldown = 0;
  private dead = 0; // respawn timer
  private waitT = 0;
  private invuln = 0;
  private hyperCd = 0;
  private waveT = 0;
  private thrusting = false;
  private thrustSfx = 0;
  private time = 0;
  private over = false;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.nextWave();
    this.invuln = 2;
  }

  private nextWave(): void {
    this.wave++;
    const n = Math.min(3 + this.wave, 11);
    for (let i = 0; i < n; i++) {
      // Spawn along the edges, away from the ship.
      let p: Vec;
      do {
        p = Math.random() < 0.5 ? { x: Math.random() * W, y: TOP } : { x: 0, y: TOP + Math.random() * (H - TOP) };
      } while (wrapDist(p, this.ship) < 150);
      this.rocks.push(this.makeRock(p.x, p.y, 3));
    }
    this.waveT = 1.2;
  }

  private makeRock(x: number, y: number, size: number, base?: Vec): Rock {
    const a = Math.random() * Math.PI * 2;
    const speed = (30 + Math.random() * 40) * (1 + (3 - size) * 0.45) * (1 + Math.min(this.wave, 8) * 0.05);
    return {
      x,
      y,
      vx: Math.cos(a) * speed + (base ? base.x * 0.3 : 0),
      vy: Math.sin(a) * speed + (base ? base.y * 0.3 : 0),
      size,
      r: ROCK_R[size],
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 1.2,
      shape: makeShape(Math.floor(Math.random() * 100000)),
    };
  }

  private addScore(n: number): void {
    this.score += n;
    this.ctx.setScore(this.score);
    if (this.score >= this.nextLife) {
      this.nextLife += 10000;
      this.lives++;
      this.ctx.sfx.play('powerup');
    }
  }

  private burst(x: number, y: number, n: number, color = '#fff'): void {
    if (this.ctx.reducedMotion) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 40 + Math.random() * 140;
      this.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4 + Math.random() * 0.5, len: 2 + Math.random() * 6, a });
    }
    void color;
  }

  update(dt: number): void {
    if (this.over) return;
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.hyperCd = Math.max(0, this.hyperCd - dt);
    this.waveT = Math.max(0, this.waveT - dt);

    // Ship
    const s = this.ship;
    this.thrusting = false;
    if (this.dead > 0) {
      this.dead -= dt;
      if (this.dead <= 0) {
        // Respawn in the centre once it is clear (give up waiting after a few seconds).
        const centre = { x: W / 2, y: (H + TOP) / 2 };
        const blocked = this.rocks.some((r) => wrapDist(r, centre) < r.r + 70);
        if (blocked && this.waitT < 3) {
          this.dead = 0.25;
          this.waitT += 0.25;
        } else {
          Object.assign(s, { ...centre, vx: 0, vy: 0, a: -Math.PI / 2 });
          this.invuln = 2;
          this.dead = 0;
          this.waitT = 0;
        }
      }
    } else {
      const turn = (this.ctx.isDown('right') ? 1 : 0) - (this.ctx.isDown('left') ? 1 : 0);
      s.a += turn * TURN * dt;
      if (this.ctx.isDown('up')) {
        this.thrusting = true;
        s.vx += Math.cos(s.a) * THRUST * dt;
        s.vy += Math.sin(s.a) * THRUST * dt;
        this.thrustSfx -= dt;
        if (this.thrustSfx <= 0) {
          this.thrustSfx = 0.12;
          this.ctx.sfx.play('thrust');
        }
      }
      const drag = Math.exp(-0.45 * dt);
      s.vx *= drag;
      s.vy *= drag;
      const sp = Math.hypot(s.vx, s.vy);
      if (sp > MAX_SPEED) {
        s.vx *= MAX_SPEED / sp;
        s.vy *= MAX_SPEED / sp;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      wrap(s);
      if (this.ctx.isDown('a')) this.fire();
    }

    // Rocks
    for (const r of this.rocks) {
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.angle += r.spin * dt;
      wrap(r);
    }

    // Bullets
    this.bullets = this.bullets.filter((b) => {
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      wrap(b);
      if (b.life <= 0) return false;
      for (let i = 0; i < this.rocks.length; i++) {
        const r = this.rocks[i];
        if (wrapDist(b, r) < r.r) {
          this.splitRock(i, { x: b.vx, y: b.vy });
          return false;
        }
      }
      return true;
    });

    // Ship vs rocks
    if (this.dead <= 0 && this.invuln <= 0) {
      for (let i = 0; i < this.rocks.length; i++) {
        const r = this.rocks[i];
        if (wrapDist(s, r) < r.r * 0.9 + SHIP_R) {
          this.splitRock(i, { x: s.vx, y: s.vy });
          this.shipDie();
          break;
        }
      }
    }

    // Sparks
    for (const p of this.sparks) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.sparks = this.sparks.filter((p) => p.life > 0);

    if (!this.rocks.length && !this.over) this.nextWave();
  }

  private splitRock(i: number, impulse: Vec): void {
    const r = this.rocks[i];
    this.rocks.splice(i, 1);
    this.addScore(ROCK_POINTS[r.size]);
    this.burst(r.x, r.y, 6 + r.size * 3);
    this.ctx.sfx.noise({ duration: 0.15 + r.size * 0.12, volume: 0.25 + r.size * 0.08, filter: 600 + (3 - r.size) * 900 });
    if (r.size > 1) {
      for (let k = 0; k < 2; k++) this.rocks.push(this.makeRock(r.x, r.y, r.size - 1, { x: impulse.x * 0.2 + r.vx, y: impulse.y * 0.2 + r.vy }));
    }
  }

  private shipDie(): void {
    this.lives--;
    this.burst(this.ship.x, this.ship.y, 24);
    this.ctx.sfx.play('explode');
    this.bullets = [];
    if (this.lives <= 0) {
      this.over = true;
      this.ctx.gameOver(this.score);
      return;
    }
    this.dead = 1.6;
  }

  private fire(): void {
    if (this.cooldown > 0 || this.dead > 0 || this.bullets.length >= MAX_BULLETS) return;
    const s = this.ship;
    this.bullets.push({
      x: s.x + Math.cos(s.a) * 14,
      y: s.y + Math.sin(s.a) * 14,
      vx: Math.cos(s.a) * BULLET_SPEED + s.vx * 0.5,
      vy: Math.sin(s.a) * BULLET_SPEED + s.vy * 0.5,
      life: BULLET_LIFE,
    });
    this.cooldown = FIRE_COOLDOWN;
    this.ctx.sfx.play('shoot');
  }

  private hyperspace(): void {
    if (this.dead > 0 || this.hyperCd > 0) return;
    this.hyperCd = 1.2;
    this.burst(this.ship.x, this.ship.y, 8);
    this.ship.x = 30 + Math.random() * (W - 60);
    this.ship.y = TOP + 30 + Math.random() * (H - TOP - 60);
    this.ship.vx = 0;
    this.ship.vy = 0;
    this.invuln = Math.max(this.invuln, 0.3);
    this.ctx.sfx.play('warp');
  }

  handleInput(input: GameInput): void {
    if (input.kind !== 'press') return;
    if (input.action === 'a') this.fire();
    else if (input.action === 'b' || input.action === 'down') this.hyperspace();
  }

  // ---------- render ----------
  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#05040b';
    g.fillRect(0, 0, W, H);

    // HUD
    g.font = '10px "Press Start 2P", monospace';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.fillText(`WAVE ${this.wave}`, 10, TOP / 2);
    for (let i = 0; i < Math.min(this.lives, 8); i++) drawShip(g, W - 18 - i * 20, TOP / 2, -Math.PI / 2, 0.7, false);
    g.fillStyle = 'rgba(255,159,67,0.4)';
    g.fillRect(0, TOP - 1, W, 1);

    g.save();
    g.beginPath();
    g.rect(0, TOP, W, H - TOP);
    g.clip();

    // Rocks (drawn at wrapped offsets so they appear on both edges)
    g.strokeStyle = '#e8e4ff';
    g.lineWidth = 2;
    for (const r of this.rocks) {
      for (const ox of [-W, 0, W]) {
        if (r.x + ox + r.r * 1.2 < 0 || r.x + ox - r.r * 1.2 > W) continue;
        for (const oy of [-(H - TOP), 0, H - TOP]) {
          if (r.y + oy + r.r * 1.2 < TOP || r.y + oy - r.r * 1.2 > H) continue;
          drawRock(g, r.x + ox, r.y + oy, r);
        }
      }
    }

    // Bullets
    g.fillStyle = COLOR;
    for (const b of this.bullets) g.fillRect(b.x - 2, b.y - 2, 4, 4);

    // Sparks
    g.strokeStyle = COLOR;
    g.lineWidth = 1.5;
    for (const p of this.sparks) {
      g.globalAlpha = Math.min(1, p.life * 2);
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(p.x - Math.cos(p.a) * p.len, p.y - Math.sin(p.a) * p.len);
      g.stroke();
    }
    g.globalAlpha = 1;

    // Ship
    if (this.dead <= 0 && !this.over) {
      const blink = this.invuln > 0 && !this.ctx.reducedMotion && Math.floor(this.time * 10) % 2 === 0;
      if (!blink) {
        g.globalAlpha = this.invuln > 0 && this.ctx.reducedMotion ? 0.5 : 1;
        const flame = this.thrusting && (this.ctx.reducedMotion || Math.floor(this.time * 20) % 2 === 0);
        drawShip(g, this.ship.x, this.ship.y, this.ship.a, 1, flame);
        g.globalAlpha = 1;
      }
    }
    g.restore();

    if (this.waveT > 0 && this.wave > 0) {
      g.font = '16px "Press Start 2P", monospace';
      g.textAlign = 'center';
      g.fillStyle = COLOR;
      g.fillText(`WAVE ${this.wave}`, W / 2, H / 2 - 60);
    }
  }

  destroy(): void {
    this.rocks = [];
  }
}

function drawRock(g: CanvasRenderingContext2D, x: number, y: number, r: Rock): void {
  const n = r.shape.length;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = r.angle + (i / n) * Math.PI * 2;
    const rr = r.r * r.shape[i];
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.stroke();
}

function drawShip(g: CanvasRenderingContext2D, x: number, y: number, a: number, s: number, flame: boolean): void {
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.scale(s, s);
  g.strokeStyle = COLOR;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(14, 0);
  g.lineTo(-10, -9);
  g.lineTo(-5, 0);
  g.lineTo(-10, 9);
  g.closePath();
  g.stroke();
  if (flame) {
    g.strokeStyle = '#ffe14d';
    g.beginPath();
    g.moveTo(-7, -4);
    g.lineTo(-17, 0);
    g.lineTo(-7, 4);
    g.stroke();
  }
  g.restore();
}

function preview(g: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  g.strokeStyle = '#e8e4ff';
  g.lineWidth = 1.5;
  const seeds = [11, 23, 37, 41, 59, 67];
  seeds.forEach((sd, i) => {
    const size = 1 + (i % 3);
    const r = ROCK_R[size] * 0.7;
    const vx = Math.cos(sd) * 25;
    const vy = Math.sin(sd) * 25;
    const x = ((((sd * 7 + vx * t) % (w + 2 * r)) + (w + 2 * r)) % (w + 2 * r)) - r;
    const y = ((((sd * 13 + vy * t) % (h + 2 * r)) + (h + 2 * r)) % (h + 2 * r)) - r;
    drawRock(g, x, y, { x, y, vx, vy, size, r, angle: t * 0.3 * (i % 2 ? 1 : -1), spin: 0, shape: makeShape(sd * 1000) });
  });
  const a = t * 1.2;
  drawShip(g, w / 2, h / 2, a, 1, Math.floor(t * 4) % 3 === 0);
  g.fillStyle = COLOR;
  for (let k = 0; k < 3; k++) {
    const d = 18 + (((t * 160) + k * 50) % 150);
    const ba = a - (d - 18) / 160 * 1.2;
    g.fillRect(w / 2 + Math.cos(ba) * d - 2, h / 2 + Math.sin(ba) * d - 2, 3, 3);
  }
}

export const rockSplitter: GameDef = {
  id: 'rocksplitter',
  title: 'Rock Splitter',
  tagline: 'Thrust, turn and shatter rocks.',
  color: COLOR,
  width: W,
  height: H,
  controls: {
    keys: 'Left/Right rotate · Up thrusts · Space fires · X hyperspace jump',
    touch: 'D-pad: Left/Right rotate, Up thrusts · FIRE and JUMP buttons',
  },
  touch: { dpad: true, buttons: ['a', 'b'], labels: { a: 'FIRE', b: 'JUMP' } },
  create: () => new RockSplitter(),
  preview,
};
