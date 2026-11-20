import type { Game, GameContext, GameDef, GameInput } from '../core/types';

const W = 480;
const H = 600;
const TOP = 36;
const COLOR = '#b26bff';
const PLAYER_Y = 556;
const PLAYER_W = 30;
const PLAYER_SPEED = 260;
const BULLET_SPEED = 520;
const ENEMY_BULLET_SPEED = 230;
const FIRE_COOLDOWN = 0.32;
const ROWS = 5;
const COLS = 10;
const AW = 26;
const AH = 18;
const SX = 38;
const SY = 32;
const STEP_X = 8;
const STEP_Y = 16;
const SHIELD_Y = 470;
const CELL = 4;
const SHIELD_SHAPE = [
  '...#####...',
  '..#######..',
  '.#########.',
  '###########',
  '###########',
  '###########',
  '###.....###',
  '##.......##',
];

// Original two-frame pixel designs, 8×8. Row 0 = top.
const SPRITES: Record<'a' | 'b' | 'c', [string[], string[]]> = {
  // diamond probe
  a: [
    ['...##...', '..#..#..', '.#.##.#.', '#.####.#', '.#.##.#.', '..#..#..', '.#....#.', '#......#'],
    ['...##...', '..#..#..', '.#.##.#.', '#.####.#', '.#.##.#.', '..#..#..', '..#..#..', '.#....#.'],
  ],
  // finned orb
  b: [
    ['...##...', '.##..##.', '#.####.#', '##.##.##', '########', '.#.##.#.', '#......#', '.#....#.'],
    ['...##...', '.##..##.', '#.####.#', '##.##.##', '########', '.#.##.#.', '.#....#.', '#......#'],
  ],
  // saucer bug
  c: [
    ['........', '..####..', '.#.##.#.', '########', '#.#..#.#', '...##...', '..#..#..', '.#....#.'],
    ['........', '..####..', '.#.##.#.', '########', '#.#..#.#', '...##...', '.#....#.', '..#..#..'],
  ],
};
const ROW_KIND: ('a' | 'b' | 'c')[] = ['a', 'b', 'b', 'c', 'c'];
const KIND_POINTS = { a: 30, b: 20, c: 10 };
const KIND_COLOR = { a: '#ff5ec4', b: '#4dfff3', c: '#7cff6b' };

interface Alien {
  r: number;
  c: number;
  kind: 'a' | 'b' | 'c';
  alive: boolean;
}
interface Bullet {
  x: number;
  y: number;
  vy: number;
}
interface Shield {
  x: number;
  cells: boolean[][];
}
interface Boom {
  x: number;
  y: number;
  t: number;
  color: string;
}

class StarSiege implements Game {
  private ctx!: GameContext;
  private aliens: Alien[] = [];
  private fx = 0; // formation offset
  private fy = 0;
  private fdir = 1;
  private stepT = 0;
  private frame = 0;
  private pendingDrop = false;
  private px = W / 2;
  private pointerX: number | null = null;
  private bullets: Bullet[] = [];
  private enemyBullets: Bullet[] = [];
  private shields: Shield[] = [];
  private booms: Boom[] = [];
  private cooldown = 0;
  private enemyFireT = 1.5;
  private ufo: { x: number; dir: number; points: number } | null = null;
  private ufoT = 20;
  private score = 0;
  private lives = 3;
  private wave = 1;
  private respawnT = 0;
  private waveT = 0;
  private time = 0;
  private extraGiven = false;
  private over = false;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.newWave();
  }

  private newWave(): void {
    this.aliens = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) this.aliens.push({ r, c, kind: ROW_KIND[r], alive: true });
    this.fx = (W - ((COLS - 1) * SX + AW)) / 2;
    this.fy = TOP + 60 + Math.min(this.wave - 1, 5) * 14;
    this.fdir = 1;
    this.stepT = 0;
    this.bullets = [];
    this.enemyBullets = [];
    this.shields = [72, 184, 296, 408].map((cx) => ({
      x: cx - (SHIELD_SHAPE[0].length * CELL) / 2,
      cells: SHIELD_SHAPE.map((row) => [...row].map((ch) => ch === '#')),
    }));
    this.waveT = 1.4;
  }

  private alive(): Alien[] {
    return this.aliens.filter((a) => a.alive);
  }

  private alienPos(a: Alien) {
    return { x: this.fx + a.c * SX, y: this.fy + a.r * SY };
  }

  private addScore(n: number): void {
    this.score += n;
    this.ctx.setScore(this.score);
    if (!this.extraGiven && this.score >= 1500) {
      this.extraGiven = true;
      this.lives++;
      this.ctx.sfx.play('powerup');
    }
  }

  private boom(x: number, y: number, color: string): void {
    if (this.ctx.reducedMotion) return;
    this.booms.push({ x, y, t: 0.35, color });
  }

  update(dt: number): void {
    if (this.over) return;
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    for (const b of this.booms) b.t -= dt;
    this.booms = this.booms.filter((b) => b.t > 0);

    if (this.waveT > 0) {
      this.waveT -= dt;
      return;
    }

    // Player
    if (this.respawnT > 0) {
      this.respawnT -= dt;
    } else {
      const dir = (this.ctx.isDown('right') ? 1 : 0) - (this.ctx.isDown('left') ? 1 : 0);
      if (dir) {
        this.pointerX = null;
        this.px += dir * PLAYER_SPEED * dt;
      } else if (this.pointerX != null) {
        const d = this.pointerX - this.px;
        this.px += Math.sign(d) * Math.min(Math.abs(d), PLAYER_SPEED * 1.6 * dt);
      }
      this.px = Math.max(PLAYER_W / 2 + 4, Math.min(W - PLAYER_W / 2 - 4, this.px));
      if (this.ctx.isDown('a')) this.fire();
    }

    this.stepFormation(dt);
    if (this.over) return;
    this.moveBullets(dt);
    if (this.over) return;
    this.enemyFire(dt);
    this.updateUfo(dt);

    if (!this.alive().length) {
      this.wave++;
      this.addScore(100 * Math.min(this.wave, 10));
      this.ctx.sfx.play('levelup');
      this.newWave();
    }
  }

  private fire(): void {
    if (this.cooldown > 0 || this.bullets.length >= 2 || this.respawnT > 0) return;
    this.bullets.push({ x: this.px, y: PLAYER_Y - 10, vy: -BULLET_SPEED });
    this.cooldown = FIRE_COOLDOWN;
    this.ctx.sfx.play('shoot');
  }

  private stepFormation(dt: number): void {
    const alive = this.alive();
    const interval = Math.max(0.04, 0.06 + 0.7 * (alive.length / (ROWS * COLS)) - (this.wave - 1) * 0.03);
    this.stepT += dt;
    while (this.stepT >= interval) {
      this.stepT -= interval;
      this.frame ^= 1;
      if (this.pendingDrop) {
        this.fy += STEP_Y;
        this.fdir = -this.fdir;
        this.pendingDrop = false;
      } else {
        this.fx += STEP_X * this.fdir;
        const xs = alive.map((a) => this.alienPos(a).x);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs) + AW;
        if ((this.fdir > 0 && maxX + STEP_X > W - 6) || (this.fdir < 0 && minX - STEP_X < 6)) this.pendingDrop = true;
      }
      this.ctx.sfx.tone({ freq: this.frame ? 90 : 70, duration: 0.05, type: 'square', volume: 0.12 });
    }
    // Aliens chew through shields, and reaching the ground ends the game.
    for (const a of alive) {
      const p = this.alienPos(a);
      if (p.y + AH >= SHIELD_Y) for (const s of this.shields) this.eraseRect(s, p.x, p.y, AW, AH);
      if (p.y + AH >= PLAYER_Y - 8) {
        this.lives = 0;
        this.over = true;
        this.ctx.sfx.play('explode');
        this.ctx.gameOver(this.score);
        return;
      }
    }
  }

  private eraseRect(s: Shield, x: number, y: number, w: number, h: number): void {
    s.cells.forEach((row, r) =>
      row.forEach((on, c) => {
        if (!on) return;
        const cx = s.x + c * CELL;
        const cy = SHIELD_Y + r * CELL;
        if (cx + CELL > x && cx < x + w && cy + CELL > y && cy < y + h) row[c] = false;
      }),
    );
  }

  /** Returns true if the point hits a live shield cell (and chips it). */
  private hitShield(x: number, y: number): boolean {
    for (const s of this.shields) {
      const c = Math.floor((x - s.x) / CELL);
      const r = Math.floor((y - SHIELD_Y) / CELL);
      if (r < 0 || r >= s.cells.length || c < 0 || c >= s.cells[0].length || !s.cells[r][c]) continue;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < s.cells.length && cc >= 0 && cc < s.cells[0].length && (dr === 0 || dc === 0 || Math.random() < 0.5))
            s.cells[rr][cc] = false;
        }
      return true;
    }
    return false;
  }

  private moveBullets(dt: number): void {
    // Player bullets (sub-stepped so they can't skip over an alien)
    this.bullets = this.bullets.filter((b) => {
      const steps = 3;
      for (let i = 0; i < steps; i++) {
        b.y += (b.vy * dt) / steps;
        if (b.y < TOP) return false;
        if (this.hitShield(b.x, b.y)) return false;
        for (const a of this.aliens) {
          if (!a.alive) continue;
          const p = this.alienPos(a);
          if (b.x >= p.x && b.x <= p.x + AW && b.y >= p.y && b.y <= p.y + AH) {
            a.alive = false;
            this.addScore(KIND_POINTS[a.kind]);
            this.boom(p.x + AW / 2, p.y + AH / 2, KIND_COLOR[a.kind]);
            this.ctx.sfx.play('hit');
            return false;
          }
        }
        if (this.ufo && Math.abs(b.x - this.ufo.x) < 20 && Math.abs(b.y - (TOP + 22)) < 10) {
          this.addScore(this.ufo.points);
          this.boom(this.ufo.x, TOP + 22, '#ff4d6d');
          this.ctx.sfx.play('explode');
          this.ufo = null;
          return false;
        }
        for (const e of this.enemyBullets) {
          if (Math.abs(e.x - b.x) < 4 && Math.abs(e.y - b.y) < 8) {
            e.y = H + 100;
            return false;
          }
        }
      }
      return true;
    });

    // Enemy bullets
    this.enemyBullets = this.enemyBullets.filter((b) => {
      b.y += b.vy * dt;
      if (b.y > H) return false;
      if (this.hitShield(b.x, b.y)) return false;
      if (this.respawnT <= 0 && Math.abs(b.x - this.px) < PLAYER_W / 2 && b.y > PLAYER_Y - 8 && b.y < PLAYER_Y + 12) {
        this.playerHit();
        return false;
      }
      return true;
    });
  }

  private playerHit(): void {
    if (this.over) return;
    this.lives--;
    this.boom(this.px, PLAYER_Y, COLOR);
    this.ctx.sfx.play('explode');
    this.enemyBullets = [];
    if (this.lives <= 0) {
      this.over = true;
      this.ctx.gameOver(this.score);
      return;
    }
    this.respawnT = 1.4;
  }

  private enemyFire(dt: number): void {
    this.enemyFireT -= dt;
    if (this.enemyFireT > 0 || this.respawnT > 0) return;
    this.enemyFireT = Math.max(0.25, 1.1 - this.wave * 0.1) * (0.5 + Math.random());
    if (this.enemyBullets.length >= 3 + this.wave) return;
    // Bottom-most alien of a random column; bias toward the player's column half the time.
    const alive = this.alive();
    const cols = [...new Set(alive.map((a) => a.c))];
    let col = cols[Math.floor(Math.random() * cols.length)];
    if (Math.random() < 0.5) {
      col = cols.reduce((best, c) =>
        Math.abs(this.fx + c * SX + AW / 2 - this.px) < Math.abs(this.fx + best * SX + AW / 2 - this.px) ? c : best,
      );
    }
    const shooter = alive.filter((a) => a.c === col).sort((a, b) => b.r - a.r)[0];
    if (!shooter) return;
    const p = this.alienPos(shooter);
    this.enemyBullets.push({ x: p.x + AW / 2, y: p.y + AH, vy: ENEMY_BULLET_SPEED + this.wave * 10 });
  }

  private updateUfo(dt: number): void {
    if (this.ufo) {
      this.ufo.x += this.ufo.dir * 110 * dt;
      if (this.ufo.x < -30 || this.ufo.x > W + 30) this.ufo = null;
      return;
    }
    this.ufoT -= dt;
    if (this.ufoT <= 0) {
      this.ufoT = 18 + Math.random() * 12;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.ufo = { x: dir > 0 ? -25 : W + 25, dir, points: [50, 100, 150, 300][Math.floor(Math.random() * 4)] };
      this.ctx.sfx.play('warp');
    }
  }

  handleInput(input: GameInput): void {
    if (input.kind === 'pointer') {
      if (input.phase !== 'up') this.pointerX = input.x;
      return;
    }
    if (input.kind !== 'press') return;
    if (input.action === 'left' || input.action === 'right') this.pointerX = null;
    if (input.action === 'a' || input.action === 'up') this.fire();
  }

  // ---------- render ----------
  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#05040b';
    g.fillRect(0, 0, W, H);
    // Stars (deterministic)
    for (let i = 0; i < 60; i++) {
      const x = (i * 97) % W;
      const y = (i * 53 + (this.ctx.reducedMotion ? 0 : this.time * (5 + (i % 3) * 4))) % H;
      g.fillStyle = i % 5 ? 'rgba(255,255,255,0.25)' : 'rgba(178,107,255,0.6)';
      g.fillRect(x, y, 2, 2);
    }

    // HUD
    g.font = '10px "Press Start 2P", monospace';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.fillText(`WAVE ${this.wave}`, 10, TOP / 2);
    for (let i = 0; i < Math.min(this.lives, 6); i++) drawShip(g, W - 22 - i * 30, TOP / 2 + 2, 0.6);
    g.fillStyle = COLOR;
    g.fillRect(0, PLAYER_Y + 20, W, 2);

    // UFO
    if (this.ufo) drawUfo(g, this.ufo.x, TOP + 22);

    // Aliens
    for (const a of this.aliens) {
      if (!a.alive) continue;
      const p = this.alienPos(a);
      drawSprite(g, SPRITES[a.kind][this.frame], p.x + 1, p.y, 3, 2.25, KIND_COLOR[a.kind]);
    }

    // Shields
    g.fillStyle = COLOR;
    for (const s of this.shields)
      s.cells.forEach((row, r) => row.forEach((on, c) => on && g.fillRect(s.x + c * CELL, SHIELD_Y + r * CELL, CELL, CELL)));

    // Bullets
    g.fillStyle = '#fff';
    for (const b of this.bullets) g.fillRect(b.x - 1, b.y - 8, 2, 10);
    g.fillStyle = '#ffe14d';
    for (const b of this.enemyBullets) {
      const wig = Math.floor(b.y / 6) % 2 ? 2 : -2;
      g.fillRect(b.x - 1 + wig, b.y - 8, 2, 4);
      g.fillRect(b.x - 1 - wig, b.y - 4, 2, 4);
      g.fillRect(b.x - 1 + wig, b.y, 2, 3);
    }

    // Player
    if (this.respawnT <= 0 && !this.over) drawShip(g, this.px, PLAYER_Y, 1);

    // Explosions
    for (const b of this.booms) {
      const k = 1 - b.t / 0.35;
      g.strokeStyle = b.color;
      g.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i;
        const r1 = 4 + k * 10;
        const r2 = r1 + 5;
        g.beginPath();
        g.moveTo(b.x + Math.cos(a) * r1, b.y + Math.sin(a) * r1);
        g.lineTo(b.x + Math.cos(a) * r2, b.y + Math.sin(a) * r2);
        g.stroke();
      }
    }

    if (this.waveT > 0) {
      g.font = '16px "Press Start 2P", monospace';
      g.textAlign = 'center';
      g.fillStyle = COLOR;
      g.fillText(`WAVE ${this.wave}`, W / 2, 380);
    }
  }

  destroy(): void {
    this.aliens = [];
  }
}

function drawSprite(g: CanvasRenderingContext2D, rows: string[], x: number, y: number, sx: number, sy: number, color: string): void {
  g.fillStyle = color;
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] === '#') g.fillRect(x + c * sx, y + r * sy, sx, sy);
  });
}

function drawShip(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.fillStyle = COLOR;
  g.beginPath();
  g.moveTo(0, -12);
  g.lineTo(6, -2);
  g.lineTo(15, 4);
  g.lineTo(15, 10);
  g.lineTo(-15, 10);
  g.lineTo(-15, 4);
  g.lineTo(-6, -2);
  g.closePath();
  g.fill();
  g.fillStyle = '#4dfff3';
  g.fillRect(-2, -6, 4, 6);
  g.restore();
}

function drawUfo(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.fillStyle = '#ff4d6d';
  g.beginPath();
  g.ellipse(x, y + 2, 20, 6, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffb3c1';
  g.beginPath();
  g.ellipse(x, y - 3, 9, 6, 0, Math.PI, 0);
  g.fill();
  g.fillStyle = '#ffe14d';
  for (let i = -2; i <= 2; i++) g.fillRect(x + i * 7 - 1, y + 1, 2, 2);
}

function preview(g: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  const frame = Math.floor(t * 2) % 2;
  const sway = Math.sin(t * 0.8) * 30;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 7; c++) {
      const kind = ROW_KIND[r * 2] ?? 'c';
      drawSprite(g, SPRITES[kind][frame], 50 + c * 32 + sway, 22 + r * 26, 2.5, 2, KIND_COLOR[kind]);
    }
  }
  g.fillStyle = COLOR;
  for (const cx of [60, 160, 260]) for (let i = 0; i < 6; i++) g.fillRect(cx - 18 + i * 6, h - 52, 6, 10);
  const px = w / 2 + Math.sin(t * 1.3) * 90;
  drawShip(g, px, h - 18, 0.9);
  const by = h - 30 - ((t * 220) % (h - 40));
  g.fillStyle = '#fff';
  g.fillRect(px - 1, by, 2, 8);
}

export const starSiege: GameDef = {
  id: 'starsiege',
  title: 'Star Siege',
  tagline: 'Hold the line against the fleet.',
  color: COLOR,
  width: W,
  height: H,
  controls: {
    keys: 'Left/Right move · Space fires (hold to auto-fire) · P pauses',
    touch: 'Drag to move · FIRE button (hold to auto-fire)',
  },
  touch: { pointer: true, buttons: ['a'], labels: { a: 'FIRE' } },
  create: () => new StarSiege(),
  preview,
};
