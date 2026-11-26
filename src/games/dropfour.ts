import type { Game, GameContext, GameDef, GameInput } from '../core/types';

const COLS = 7;
const ROWS = 6;
const CELL = 56;
const W = 448;
const BX = (W - COLS * CELL) / 2;
const TOP = 40;
const BY = 112;
const H = BY + ROWS * CELL + 64;
const COLOR = '#4dc3ff';
const P_COLORS = ['', '#ff4d6d', '#ffe14d'];
const ORDER = [3, 2, 4, 1, 5, 0, 6];
const TARGET_WINS = 3; // two-player match length
const DEPTH: Record<string, number> = { easy: 2, medium: 4, hard: 6 };

type Mode = 'easy' | 'medium' | 'hard' | 'two';

// ---------- pure board logic (also used by the AI) ----------
function dropRow(b: Int8Array, c: number): number {
  for (let r = ROWS - 1; r >= 0; r--) if (!b[r * COLS + c]) return r;
  return -1;
}

function winLine(b: Int8Array, r: number, c: number): number[] | null {
  const p = b[r * COLS + c];
  if (!p) return null;
  for (const [dr, dc] of [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ]) {
    const line = [r * COLS + c];
    for (const s of [1, -1]) {
      let rr = r + dr * s;
      let cc = c + dc * s;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && b[rr * COLS + cc] === p) {
        line.push(rr * COLS + cc);
        rr += dr * s;
        cc += dc * s;
      }
    }
    if (line.length >= 4) return line;
  }
  return null;
}

function evaluate(b: Int8Array, me: number): number {
  const opp = 3 - me;
  let score = 0;
  for (let r = 0; r < ROWS; r++) {
    if (b[r * COLS + 3] === me) score += 3;
    else if (b[r * COLS + 3] === opp) score -= 3;
  }
  const windows: [number, number][] = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      for (const [dr, dc] of windows) {
        const er = r + dr * 3;
        const ec = c + dc * 3;
        if (er < 0 || er >= ROWS || ec < 0 || ec >= COLS) continue;
        let mine = 0;
        let theirs = 0;
        for (let k = 0; k < 4; k++) {
          const v = b[(r + dr * k) * COLS + c + dc * k];
          if (v === me) mine++;
          else if (v === opp) theirs++;
        }
        if (mine && theirs) continue;
        if (mine === 3) score += 5;
        else if (mine === 2) score += 2;
        else if (theirs === 3) score -= 4;
        else if (theirs === 2) score -= 1;
      }
  return score;
}

function negamax(b: Int8Array, depth: number, alpha: number, beta: number, me: number, filled: number): number {
  if (filled === ROWS * COLS) return 0;
  if (depth === 0) return evaluate(b, me);
  let best = -Infinity;
  for (const c of ORDER) {
    const r = dropRow(b, c);
    if (r < 0) continue;
    b[r * COLS + c] = me;
    const score = winLine(b, r, c) ? 100000 + depth : -negamax(b, depth - 1, -beta, -alpha, 3 - me, filled + 1);
    b[r * COLS + c] = 0;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export function bestMove(b: Int8Array, me: number, depth: number): number {
  const filled = b.reduce((n, v) => n + (v ? 1 : 0), 0);
  let best = -Infinity;
  let picks: number[] = [];
  for (const c of ORDER) {
    const r = dropRow(b, c);
    if (r < 0) continue;
    b[r * COLS + c] = me;
    const score = winLine(b, r, c) ? 100000 + depth : -negamax(b, depth - 1, -Infinity, Infinity, 3 - me, filled + 1);
    b[r * COLS + c] = 0;
    if (score > best) {
      best = score;
      picks = [c];
    } else if (score === best) picks.push(c);
  }
  return picks[Math.floor(Math.random() * picks.length)] ?? -1;
}

// ---------- game ----------
class DropFour implements Game {
  private ctx!: GameContext;
  private mode: Mode = 'medium';
  private board = new Int8Array(ROWS * COLS);
  private turn = 1;
  private starter = 1;
  private col = 3;
  private falling: { c: number; r: number; y: number; vy: number; p: number } | null = null;
  private cpuT = 0;
  private result: { text: string; t: number; line: number[] | null } | null = null;
  private wins = [0, 0, 0];
  private draws = 0;
  private points = 0;
  private time = 0;
  private over = false;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.mode = (ctx.mode as Mode) ?? 'medium';
    this.newRound();
  }

  private vsCpu(): boolean {
    return this.mode !== 'two';
  }

  private newRound(): void {
    this.board = new Int8Array(ROWS * COLS);
    this.turn = this.starter;
    this.starter = 3 - this.starter;
    this.result = null;
    this.cpuT = 0.5;
  }

  private cpuTurn(): boolean {
    return this.vsCpu() && this.turn === 2;
  }

  private play(c: number): void {
    if (this.falling || this.result || this.over) return;
    const r = dropRow(this.board, c);
    if (r < 0) {
      this.ctx.sfx.play('blip');
      return;
    }
    this.ctx.sfx.play('drop');
    if (this.ctx.reducedMotion) this.land(c, r, this.turn);
    else this.falling = { c, r, y: BY - CELL / 2, vy: 0, p: this.turn };
  }

  private land(c: number, r: number, p: number): void {
    this.board[r * COLS + c] = p;
    this.falling = null;
    const line = winLine(this.board, r, c);
    const filled = this.board.every((v) => v);
    if (line) this.endRound(p, line);
    else if (filled) this.endRound(0, null);
    else {
      this.turn = 3 - this.turn;
      this.cpuT = 0.45;
    }
  }

  private endRound(winner: number, line: number[] | null): void {
    let text: string;
    if (winner) this.wins[winner]++;
    else this.draws++;
    if (this.vsCpu()) {
      if (winner === 1) {
        this.points += 3;
        text = 'YOU WIN! +3';
        this.ctx.sfx.play('levelup');
      } else if (winner === 2) {
        text = 'CPU WINS';
        this.ctx.sfx.play('hit');
      } else {
        this.points += 1;
        text = 'DRAW +1';
        this.ctx.sfx.play('select');
      }
      this.ctx.setScore(this.points);
    } else {
      text = winner ? `PLAYER ${winner} WINS` : 'DRAW';
      this.ctx.sfx.play(winner ? 'levelup' : 'select');
    }
    this.result = { text, t: 1.8, line };
  }

  private afterResult(): void {
    if (this.vsCpu()) {
      if (this.wins[2] > 0) {
        this.over = true;
        this.ctx.gameOver(this.points, { won: false });
        return;
      }
    } else {
      const w = this.wins[1] >= TARGET_WINS ? 1 : this.wins[2] >= TARGET_WINS ? 2 : 0;
      if (w) {
        this.over = true;
        const score = this.wins[w] * 3 + this.draws;
        this.ctx.setScore(score);
        this.ctx.gameOver(score, { won: true });
        return;
      }
    }
    this.newRound();
  }

  update(dt: number): void {
    if (this.over) return;
    this.time += dt;
    if (this.result) {
      this.result.t -= dt;
      if (this.result.t <= 0) this.afterResult();
      return;
    }
    if (this.falling) {
      const f = this.falling;
      f.vy += 2600 * dt;
      f.y += f.vy * dt;
      const target = BY + f.r * CELL + CELL / 2;
      if (f.y >= target) this.land(f.c, f.r, f.p);
      return;
    }
    if (this.cpuTurn()) {
      this.cpuT -= dt;
      if (this.cpuT <= 0) {
        const legal = ORDER.filter((k) => dropRow(this.board, k) >= 0);
        const c =
          this.mode === 'easy' && Math.random() < 0.35
            ? legal[Math.floor(Math.random() * legal.length)]
            : bestMove(this.board, 2, DEPTH[this.mode] ?? 4);
        this.col = c;
        this.play(c);
      }
    }
  }

  handleInput(input: GameInput): void {
    if (this.over || this.cpuTurn()) return;
    if (input.kind === 'pointer') {
      const c = Math.floor((input.x - BX) / CELL);
      if (c < 0 || c >= COLS) return;
      this.col = c;
      if (input.phase === 'up' && input.y > BY - CELL) this.play(c);
      return;
    }
    if (input.kind !== 'press') return;
    if (input.action === 'left') this.col = (this.col + COLS - 1) % COLS;
    else if (input.action === 'right') this.col = (this.col + 1) % COLS;
    else if (input.action === 'a' || input.action === 'down') this.play(this.col);
    if (input.action === 'left' || input.action === 'right') this.ctx.sfx.play('move');
  }

  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#07070f';
    g.fillRect(0, 0, W, H);

    // HUD
    g.font = '10px "Press Start 2P", monospace';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    if (this.vsCpu()) {
      g.fillStyle = '#fff';
      g.fillText(`WINS ${this.wins[1]}  DRAWS ${this.draws}`, 12, TOP / 2);
      g.textAlign = 'right';
      g.fillStyle = '#9a96ad';
      g.fillText(this.mode.toUpperCase(), W - 12, TOP / 2);
    } else {
      g.fillStyle = P_COLORS[1];
      g.fillText(`P1 ${this.wins[1]}`, 12, TOP / 2);
      g.textAlign = 'center';
      g.fillStyle = '#9a96ad';
      g.fillText(`FIRST TO ${TARGET_WINS}`, W / 2, TOP / 2);
      g.textAlign = 'right';
      g.fillStyle = P_COLORS[2];
      g.fillText(`P2 ${this.wins[2]}`, W - 12, TOP / 2);
    }

    // Hover piece
    if (!this.result && !this.falling && !this.over) {
      const x = BX + this.col * CELL + CELL / 2;
      g.globalAlpha = this.cpuTurn() ? 0.4 : 1;
      drawDisc(g, x, BY - CELL / 2 - 4, P_COLORS[this.turn]);
      g.globalAlpha = 1;
    }
    if (this.falling) drawDisc(g, BX + this.falling.c * CELL + CELL / 2, this.falling.y, P_COLORS[this.falling.p]);

    // Board with holes
    g.fillStyle = '#123a7a';
    g.beginPath();
    g.roundRect(BX - 6, BY - 6, COLS * CELL + 12, ROWS * CELL + 12, 10);
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const x = BX + c * CELL + CELL / 2;
        const y = BY + r * CELL + CELL / 2;
        g.moveTo(x + CELL * 0.4, y);
        g.arc(x, y, CELL * 0.4, 0, Math.PI * 2, true);
      }
    g.fill('evenodd');
    // Placed discs (drawn after so they sit in the holes)
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const v = this.board[r * COLS + c];
        if (v) drawDisc(g, BX + c * CELL + CELL / 2, BY + r * CELL + CELL / 2, P_COLORS[v]);
      }
    g.strokeStyle = COLOR;
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(BX - 6, BY - 6, COLS * CELL + 12, ROWS * CELL + 12, 10);
    g.stroke();

    // Result
    if (this.result) {
      if (this.result.line) {
        g.strokeStyle = '#fff';
        g.lineWidth = 4;
        for (const i of this.result.line) {
          g.beginPath();
          g.arc(BX + (i % COLS) * CELL + CELL / 2, BY + Math.floor(i / COLS) * CELL + CELL / 2, CELL * 0.4, 0, Math.PI * 2);
          g.stroke();
        }
      }
      g.textAlign = 'center';
      g.font = '14px "Press Start 2P", monospace';
      g.fillStyle = '#fff';
      g.fillText(this.result.text, W / 2, BY + ROWS * CELL + 36);
    } else if (!this.over) {
      g.textAlign = 'center';
      g.font = '10px "Press Start 2P", monospace';
      g.fillStyle = P_COLORS[this.turn];
      const who = this.vsCpu() ? (this.turn === 1 ? 'YOUR TURN' : 'CPU THINKING…') : `PLAYER ${this.turn}`;
      g.fillText(who, W / 2, BY + ROWS * CELL + 36);
    }
  }

  destroy(): void {
    this.board = new Int8Array(0);
  }
}

function drawDisc(g: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, CELL * 0.4, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(x, y, CELL * 0.27, 0, Math.PI * 2);
  g.stroke();
}

function preview(g: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  const s = 26;
  const bx = (w - COLS * s) / 2;
  const by = h - ROWS * s - 12;
  const layout = ['.......', '.......', '...2...', '..21...', '.1122..', '2121121'];
  const cycle = t % 3;
  g.fillStyle = '#123a7a';
  g.fillRect(bx - 4, by - 4, COLS * s + 8, ROWS * s + 8);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const ch = layout[r][c];
      g.fillStyle = ch === '.' ? '#07070f' : P_COLORS[Number(ch)];
      g.beginPath();
      g.arc(bx + c * s + s / 2, by + r * s + s / 2, s * 0.38, 0, Math.PI * 2);
      g.fill();
    }
  // A red disc dropping into column 4 (row 3) on a loop
  const target = by + 3 * s + s / 2;
  const y = Math.min(target, by - s + (cycle * cycle) * 220);
  if (cycle < 2.4) {
    g.fillStyle = P_COLORS[1];
    g.beginPath();
    g.arc(bx + 4 * s + s / 2, y, s * 0.38, 0, Math.PI * 2);
    g.fill();
  }
}

export const dropFour: GameDef = {
  id: 'dropfour',
  title: 'Drop Four',
  tagline: 'Line up four before the CPU does.',
  color: COLOR,
  width: W,
  height: H,
  controls: {
    keys: 'Left/Right pick a column · Space or Down drops · Win 3 pts, draw 1, a loss ends the run',
    touch: 'Tap a column to drop · Win 3 pts, draw 1, a loss ends the run',
  },
  touch: { pointer: true },
  modes: [
    { id: 'easy', label: 'Easy' },
    { id: 'medium', label: 'Medium' },
    { id: 'hard', label: 'Hard' },
    { id: 'two', label: '2 Players' },
  ],
  create: () => new DropFour(),
  preview,
};
