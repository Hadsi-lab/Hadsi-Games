import type { Game, GameContext, GameDef, GameInput } from '../core/types';

// '#' wall, '.' dot, 'o' power pellet, ' ' empty path, '-' pen door, 'P' pen interior.
const MAZE = [
  '#####################',
  '#.........#.........#',
  '#.###.###.#.###.###.#',
  '#o###.###.#.###.###o#',
  '#...................#',
  '#.###.#.#####.#.###.#',
  '#.....#...#...#.....#',
  '#####.### # ###.#####',
  '#####.#       #.#####',
  '#####.# ##-## #.#####',
  '     .  #PPP#  .     ',
  '#####.# ##### #.#####',
  '#####.#       #.#####',
  '#####.# ##### #.#####',
  '#.........#.........#',
  '#.###.###.#.###.###.#',
  '#o..#..... .....#..o#',
  '###.#.#.#####.#.#.###',
  '#.....#...#...#.....#',
  '#.#######.#.#######.#',
  '#...................#',
  '#####################',
];
const COLS = 21;
const ROWS = MAZE.length;
const T = 20;
const TOP = 40;
const W = COLS * T;
const H = TOP + ROWS * T;
const COLOR = '#ffe14d';
const WALL = '#3b5bff';
const START = { x: 10, y: 16 };
const DOOR_OUT = { x: 10, y: 8 };
const PEN = { x: 10, y: 10 };
const SCHEDULE = [7, 20, 7, 20, 5, 20, 5, Infinity]; // scatter, chase, scatter, ...

type Dir = { x: number; y: number };
const DIRS: Dir[] = [
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 0 },
];
const NONE: Dir = { x: 0, y: 0 };
const ACTION_DIR: Record<string, Dir> = { up: DIRS[0], left: DIRS[1], down: DIRS[2], right: DIRS[3] };

type HState = 'pen' | 'leaving' | 'active' | 'eyes' | 'entering';

interface Hunter {
  name: 'chaser' | 'ambusher' | 'flanker' | 'wanderer';
  color: string;
  corner: Dir;
  x: number;
  y: number;
  dir: Dir;
  state: HState;
  release: number;
  scared: boolean;
}

interface Mover {
  x: number;
  y: number;
  dir: Dir;
}

const wrapX = (x: number) => ((x % COLS) + COLS) % COLS;
const cell = (x: number, y: number) => (y < 0 || y >= ROWS ? '#' : MAZE[y][wrapX(x)]);

class DotMaze implements Game {
  private ctx!: GameContext;
  private dots: Set<number> = new Set();
  private power: Set<number> = new Set();
  private player: Mover & { want: Dir } = { ...START, dir: NONE, want: NONE };
  private hunters: Hunter[] = [];
  private score = 0;
  private lives = 3;
  private level = 1;
  private phase = 0;
  private phaseT = 0;
  private scaredT = 0;
  private chain = 0;
  private readyT = 0;
  private deathT = 0;
  private clearT = 0;
  private popups: { x: number; y: number; text: string; t: number }[] = [];
  private time = 0;
  private over = false;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.resetDots();
    this.resetActors();
  }

  private resetDots(): void {
    this.dots.clear();
    this.power.clear();
    MAZE.forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (c === '.') this.dots.add(y * COLS + x);
        if (c === 'o') this.power.add(y * COLS + x);
      }),
    );
  }

  private resetActors(): void {
    this.player = { ...START, dir: NONE, want: { x: -1, y: 0 } };
    const mk = (name: Hunter['name'], color: string, corner: Dir, x: number, y: number, state: HState, release: number): Hunter => ({
      name,
      color,
      corner,
      x,
      y,
      dir: { x: -1, y: 0 },
      state,
      release,
      scared: false,
    });
    this.hunters = [
      mk('chaser', '#ff4d6d', { x: COLS - 2, y: -2 }, DOOR_OUT.x, DOOR_OUT.y, 'active', 0),
      mk('ambusher', '#ff8fd8', { x: 1, y: -2 }, PEN.x, PEN.y, 'pen', 1),
      mk('flanker', '#4dfff3', { x: COLS - 1, y: ROWS + 1 }, PEN.x - 1, PEN.y, 'pen', 5),
      mk('wanderer', '#ffa64d', { x: 0, y: ROWS + 1 }, PEN.x + 1, PEN.y, 'pen', 9),
    ];
    this.phase = 0;
    this.phaseT = 0;
    this.scaredT = 0;
    this.readyT = 1.6;
  }

  // ---------- helpers ----------
  private open(x: number, y: number, h?: Hunter): boolean {
    const c = cell(x, y);
    if (c === '#') return false;
    if (c === '-' || c === 'P') return !!h && (h.state === 'eyes' || h.state === 'entering' || h.state === 'leaving');
    return true;
  }

  private speeds() {
    const l = Math.min(this.level - 1, 6);
    return {
      player: 7.2 + l * 0.25,
      hunter: 6.6 + l * 0.35,
      scared: 4.2,
      eyes: 14,
      tunnel: 4,
    };
  }

  private addScore(n: number): void {
    const before = this.score;
    this.score += n;
    this.ctx.setScore(this.score);
    if (before < 10000 && this.score >= 10000) {
      this.lives++;
      this.ctx.sfx.play('powerup');
    }
  }

  private chasing(): boolean {
    return this.phase % 2 === 1;
  }

  /**
   * Moves an entity along the grid by `dist` tiles. At each tile centre `decide` picks the
   * next direction (or NONE to stop).
   */
  private step(m: Mover, dist: number, decide: (cx: number, cy: number) => Dir, canEnter: (x: number, y: number) => boolean): void {
    let guard = 0;
    while (dist > 1e-6 && guard++ < 8) {
      const atCentre = Math.abs(m.x - Math.round(m.x)) < 1e-6 && Math.abs(m.y - Math.round(m.y)) < 1e-6;
      if (atCentre && (m.dir.x || m.dir.y) && !canEnter(Math.round(m.x) + m.dir.x, Math.round(m.y) + m.dir.y)) {
        m.dir = NONE;
      }
      if (m.dir.x === 0 && m.dir.y === 0) {
        const d = decide(Math.round(m.x), Math.round(m.y));
        if (d.x === 0 && d.y === 0) return;
        m.dir = d;
      }
      const pos = m.dir.x !== 0 ? m.x : m.y;
      const sign = m.dir.x + m.dir.y;
      const next = sign > 0 ? Math.floor(pos + 1e-6) + 1 : Math.ceil(pos - 1e-6) - 1;
      const remaining = Math.abs(next - pos);
      if (dist < remaining) {
        if (m.dir.x !== 0) m.x += m.dir.x * dist;
        else m.y += m.dir.y * dist;
        return;
      }
      if (m.dir.x !== 0) m.x = next;
      else m.y = next;
      dist -= remaining;
      if (m.x < -0.5) m.x += COLS;
      if (m.x > COLS - 0.5) m.x -= COLS;
      const d = decide(Math.round(m.x), Math.round(m.y));
      m.dir = d;
      if (!d.x && !d.y) return;
    }
  }

  // ---------- update ----------
  update(dt: number): void {
    if (this.over) return;
    this.time += dt;
    for (const p of this.popups) p.t -= dt;
    this.popups = this.popups.filter((p) => p.t > 0);

    if (this.readyT > 0) {
      this.readyT -= dt;
      return;
    }
    if (this.deathT > 0) {
      this.deathT -= dt;
      if (this.deathT <= 0) {
        if (this.lives <= 0) {
          this.over = true;
          this.ctx.gameOver(this.score);
        } else this.resetActors();
      }
      return;
    }
    if (this.clearT > 0) {
      this.clearT -= dt;
      if (this.clearT <= 0) {
        this.level++;
        this.resetDots();
        this.resetActors();
      }
      return;
    }

    // Mode timers
    if (this.scaredT > 0) {
      this.scaredT -= dt;
      if (this.scaredT <= 0) this.hunters.forEach((h) => (h.scared = false));
    } else {
      this.phaseT += dt;
      if (this.phaseT >= SCHEDULE[this.phase]) {
        this.phaseT = 0;
        this.phase = Math.min(this.phase + 1, SCHEDULE.length - 1);
        this.reverseActive();
      }
    }

    const sp = this.speeds();
    this.movePlayer(sp.player * dt);
    this.eat();
    for (const h of this.hunters) this.moveHunter(h, dt, sp);
    this.collide();
  }

  private reverseActive(): void {
    for (const h of this.hunters) if (h.state === 'active') h.dir = { x: -h.dir.x, y: -h.dir.y };
  }

  private movePlayer(dist: number): void {
    const p = this.player;
    // Reverse instantly mid-tile.
    if (p.want.x === -p.dir.x && p.want.y === -p.dir.y && (p.want.x || p.want.y)) p.dir = p.want;
    this.step(p, dist, (cx, cy) => {
      if (this.open(cx + p.want.x, cy + p.want.y)) return p.want;
      if (this.open(cx + p.dir.x, cy + p.dir.y)) return p.dir;
      return NONE;
    }, (x, y) => this.open(x, y));
  }

  private eat(): void {
    const p = this.player;
    const key = Math.round(p.y) * COLS + wrapX(Math.round(p.x));
    if (Math.abs(p.x - Math.round(p.x)) > 0.35 || Math.abs(p.y - Math.round(p.y)) > 0.35) return;
    if (this.dots.delete(key)) {
      this.addScore(10);
      this.ctx.sfx.play('chomp');
    } else if (this.power.delete(key)) {
      this.addScore(50);
      this.ctx.sfx.play('power');
      this.scaredT = Math.max(2, 7 - (this.level - 1));
      this.chain = 0;
      for (const h of this.hunters) {
        if (h.state === 'eyes' || h.state === 'entering') continue;
        h.scared = true;
        if (h.state === 'active') h.dir = { x: -h.dir.x, y: -h.dir.y };
      }
    } else return;
    if (!this.dots.size && !this.power.size) {
      this.clearT = 2;
      this.ctx.sfx.play('levelup');
    }
  }

  private target(h: Hunter): Dir {
    if (h.state === 'eyes') return DOOR_OUT;
    if (!this.chasing()) return h.corner;
    const p = { x: Math.round(this.player.x), y: Math.round(this.player.y) };
    const pd = this.player.dir;
    switch (h.name) {
      case 'chaser':
        return p;
      case 'ambusher':
        return { x: p.x + pd.x * 4, y: p.y + pd.y * 4 };
      case 'flanker': {
        const red = this.hunters[0];
        const v = { x: p.x + pd.x * 2, y: p.y + pd.y * 2 };
        return { x: v.x * 2 - Math.round(red.x), y: v.y * 2 - Math.round(red.y) };
      }
      case 'wanderer':
        return Math.hypot(h.x - p.x, h.y - p.y) > 8 ? p : h.corner;
    }
  }

  private moveHunter(h: Hunter, dt: number, sp: ReturnType<DotMaze['speeds']>): void {
    switch (h.state) {
      case 'pen':
        h.release -= dt;
        h.y = PEN.y + (this.ctx.reducedMotion ? 0 : Math.sin(this.time * 6 + h.x) * 0.15);
        if (h.release <= 0) {
          h.y = PEN.y;
          h.state = 'leaving';
        }
        return;
      case 'leaving': {
        const d = sp.hunter * 0.6 * dt;
        if (Math.abs(h.x - PEN.x) > 0.01) h.x += Math.sign(PEN.x - h.x) * Math.min(d, Math.abs(PEN.x - h.x));
        else {
          h.x = PEN.x;
          h.y -= d;
          if (h.y <= DOOR_OUT.y) {
            h.y = DOOR_OUT.y;
            h.state = 'active';
            h.dir = { x: -1, y: 0 };
          }
        }
        return;
      }
      case 'entering':
        h.y += sp.eyes * 0.5 * dt;
        if (h.y >= PEN.y) {
          h.y = PEN.y;
          h.scared = false;
          h.state = 'leaving';
        }
        return;
    }

    const inTunnel = cell(Math.round(h.x), Math.round(h.y)) === ' ' && Math.round(h.y) === 10 && (h.x < 5 || h.x > 15);
    const speed = h.state === 'eyes' ? sp.eyes : h.scared ? sp.scared : inTunnel ? sp.tunnel : sp.hunter;
    this.step(h, speed * dt, (cx, cy) => {
      if (h.state === 'eyes' && cx === DOOR_OUT.x && cy === DOOR_OUT.y) {
        h.state = 'entering';
        return NONE;
      }
      const options = DIRS.filter(
        (d) => !(d.x === -h.dir.x && d.y === -h.dir.y) && this.open(cx + d.x, cy + d.y, h) && !(cell(cx + d.x, cy + d.y) === '-' && h.state !== 'eyes'),
      );
      if (!options.length) return { x: -h.dir.x, y: -h.dir.y };
      if (h.scared && h.state === 'active') return options[Math.floor(Math.random() * options.length)];
      const t = this.target(h);
      let best = options[0];
      let bestD = Infinity;
      for (const d of options) {
        const dd = (cx + d.x - t.x) ** 2 + (cy + d.y - t.y) ** 2;
        if (dd < bestD) {
          bestD = dd;
          best = d;
        }
      }
      return best;
    }, (x, y) => this.open(x, y, h) && (cell(x, y) !== '-' || h.state === 'eyes'));
  }

  private collide(): void {
    const p = this.player;
    for (const h of this.hunters) {
      if (h.state !== 'active') continue;
      let dx = Math.abs(h.x - p.x);
      dx = Math.min(dx, COLS - dx);
      if (dx * dx + (h.y - p.y) ** 2 > 0.6 * 0.6) continue;
      if (h.scared) {
        const pts = 200 * 2 ** Math.min(this.chain, 3);
        this.chain++;
        this.addScore(pts);
        this.popups.push({ x: h.x, y: h.y, text: String(pts), t: 1 });
        h.state = 'eyes';
        h.scared = false;
        this.ctx.sfx.play('ghost');
      } else {
        this.lives--;
        this.deathT = 1.5;
        this.ctx.sfx.play('lose');
        return;
      }
    }
  }

  handleInput(input: GameInput): void {
    if (input.kind !== 'press') return;
    const d = ACTION_DIR[input.action];
    if (d) this.player.want = d;
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
    for (let i = 0; i < Math.min(this.lives, 6); i++) drawPlayer(g, W - 18 - i * 22, TOP / 2, 7, { x: 1, y: 0 }, 0);

    g.save();
    g.translate(0, TOP);
    drawWalls(g);

    // Dots
    g.fillStyle = '#ffd9b0';
    for (const k of this.dots) {
      const x = (k % COLS) * T + T / 2;
      const y = Math.floor(k / COLS) * T + T / 2;
      g.fillRect(x - 2, y - 2, 4, 4);
    }
    const pulse = this.ctx.reducedMotion ? 1 : 0.75 + 0.25 * Math.sin(this.time * 8);
    g.fillStyle = '#ffd9b0';
    for (const k of this.power) {
      const x = (k % COLS) * T + T / 2;
      const y = Math.floor(k / COLS) * T + T / 2;
      g.beginPath();
      g.arc(x, y, 6 * pulse, 0, Math.PI * 2);
      g.fill();
    }

    // Player
    const p = this.player;
    if (this.deathT > 0) {
      const k = 1 - this.deathT / 1.5;
      if (!this.ctx.reducedMotion) {
        g.globalAlpha = 1 - k;
        drawPlayer(g, p.x * T + T / 2, p.y * T + T / 2, 8 * (1 - k * 0.7), p.dir, k * Math.PI * 4);
        g.globalAlpha = 1;
      } else if (k < 0.5) drawPlayer(g, p.x * T + T / 2, p.y * T + T / 2, 8, p.dir, 0);
    } else {
      drawPlayer(g, p.x * T + T / 2, p.y * T + T / 2, 8, p.dir.x || p.dir.y ? p.dir : p.want, 0);
    }

    // Hunters
    if (this.deathT <= 0 && this.clearT <= 0) {
      const ending = this.scaredT > 0 && this.scaredT < 2;
      const blink = ending && !this.ctx.reducedMotion && Math.floor(this.time * 6) % 2 === 0;
      for (const h of this.hunters) {
        const hx = h.x * T + T / 2;
        const hy = h.y * T + T / 2;
        if (h.state === 'eyes' || h.state === 'entering') drawEyes(g, hx, hy, h.dir);
        else if (h.scared) drawHunter(g, hx, hy, blink ? '#f4f1ff' : ending && this.ctx.reducedMotion ? '#7f8cff' : '#3048ff', NONE, true);
        else drawHunter(g, hx, hy, h.color, h.dir, false);
      }
    }

    // Popups
    g.font = '8px "Press Start 2P", monospace';
    g.textAlign = 'center';
    g.fillStyle = '#4dfff3';
    for (const pp of this.popups) g.fillText(pp.text, pp.x * T + T / 2, pp.y * T + T / 2);

    // Messages
    g.font = '12px "Press Start 2P", monospace';
    if (this.readyT > 0) {
      g.fillStyle = COLOR;
      g.fillText('READY!', W / 2, 12 * T + T / 2);
    } else if (this.clearT > 0) {
      g.fillStyle = COLOR;
      g.fillText('CLEAR!', W / 2, 12 * T + T / 2);
    }
    g.restore();
  }

  destroy(): void {
    this.hunters = [];
  }
}

function drawWalls(g: CanvasRenderingContext2D): void {
  g.fillStyle = '#0c0f33';
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) if (MAZE[y][x] === '#') g.fillRect(x * T, y * T, T, T);
  g.strokeStyle = WALL;
  g.lineWidth = 2;
  g.beginPath();
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (MAZE[y][x] !== '#') continue;
      const isWall = (xx: number, yy: number) => xx < 0 || xx >= COLS || yy < 0 || yy >= ROWS || MAZE[yy][xx] === '#';
      const X = x * T;
      const Y = y * T;
      // Edges facing open space, inset slightly.
      if (!isWall(x, y - 1) && y > 0) {
        g.moveTo(X, Y + 1);
        g.lineTo(X + T, Y + 1);
      }
      if (!isWall(x, y + 1) && y < ROWS - 1) {
        g.moveTo(X, Y + T - 1);
        g.lineTo(X + T, Y + T - 1);
      }
      if (!isWall(x - 1, y) && x > 0) {
        g.moveTo(X + 1, Y);
        g.lineTo(X + 1, Y + T);
      }
      if (!isWall(x + 1, y) && x < COLS - 1) {
        g.moveTo(X + T - 1, Y);
        g.lineTo(X + T - 1, Y + T);
      }
    }
  }
  g.stroke();
  // Door
  g.fillStyle = '#ff8fd8';
  g.fillRect(10 * T, 9 * T + T / 2 - 2, T, 4);
}

/** The player: a round "bot" with a visor that faces where it is heading. */
function drawPlayer(g: CanvasRenderingContext2D, x: number, y: number, r: number, dir: Dir, spin: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(spin);
  g.fillStyle = COLOR;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  const a = Math.atan2(dir.y, dir.x || (dir.y ? 0 : 1));
  g.rotate(a);
  g.fillStyle = '#1b1430';
  g.fillRect(r * 0.15, -r * 0.55, r * 0.55, r * 1.1);
  g.fillStyle = '#4dfff3';
  g.fillRect(r * 0.35, -r * 0.35, r * 0.2, r * 0.25);
  g.fillRect(r * 0.35, r * 0.1, r * 0.2, r * 0.25);
  g.restore();
}

/** Hunters: hexagonal drones with an antenna. */
function drawHunter(g: CanvasRenderingContext2D, x: number, y: number, color: string, dir: Dir, scared: boolean): void {
  const r = 9;
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
  g.fillRect(x - 1, y - r - 4, 2, 4);
  g.fillRect(x - 2, y - r - 6, 4, 2);
  if (scared) {
    g.fillStyle = '#ffd9b0';
    g.fillRect(x - 4, y - 2, 2, 2);
    g.fillRect(x + 2, y - 2, 2, 2);
    g.fillRect(x - 4, y + 3, 8, 1);
  } else drawEyes(g, x, y, dir);
}

function drawEyes(g: CanvasRenderingContext2D, x: number, y: number, dir: Dir): void {
  g.fillStyle = '#fff';
  g.fillRect(x - 6, y - 4, 5, 5);
  g.fillRect(x + 1, y - 4, 5, 5);
  g.fillStyle = '#1b1430';
  g.fillRect(x - 5 + dir.x * 1.5, y - 3 + dir.y * 1.5, 2, 2);
  g.fillRect(x + 2 + dir.x * 1.5, y - 3 + dir.y * 1.5, 2, 2);
}

function preview(g: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  const y = h / 2;
  g.strokeStyle = WALL;
  g.lineWidth = 2;
  g.strokeRect(-4, y - 24, w + 8, 48);
  g.strokeRect(20, y - 70, w - 40, 26);
  g.strokeRect(20, y + 44, w - 40, 26);
  const span = w + 120;
  const px = ((t * 70) % span) - 40;
  g.fillStyle = '#ffd9b0';
  for (let x = 12; x < w; x += 20) {
    if (x < px && x > px - span) continue;
    if (x === 172) {
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
    } else g.fillRect(x - 2, y - 2, 4, 4);
  }
  drawPlayer(g, px, y, 9, { x: 1, y: 0 }, 0);
  const colors = ['#ff4d6d', '#ff8fd8', '#4dfff3', '#ffa64d'];
  colors.forEach((c, i) => drawHunter(g, px - 50 - i * 26, y, c, { x: 1, y: 0 }, false));
}

export const dotMaze: GameDef = {
  id: 'dotmaze',
  title: 'Dot Maze',
  tagline: 'Eat the dots, dodge four hunters.',
  color: COLOR,
  width: W,
  height: H,
  controls: {
    keys: 'Arrows or WASD steer · Power pellets turn the hunters · P pauses',
    touch: 'Swipe or D-pad to steer',
  },
  touch: { swipe: true, dpad: true },
  create: () => new DotMaze(),
  preview,
};
