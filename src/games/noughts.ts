import type { Game, GameContext, GameDef, GameInput } from '../core/types';

const W = 420;
const TOP = 40;
const CELL = 110;
const BX = (W - 3 * CELL) / 2;
const BY = 100;
const H = BY + 3 * CELL + 80;
const COLOR = '#ff6bd6';
const MARK_COLORS = ['', '#4dfff3', '#ff8fd8']; // 1 = X, 2 = O
const DRAW_TIME = 0.18;
const TARGET_WINS = 3;
const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

type Mode = 'easy' | 'medium' | 'hard' | 'two';

function winner(b: number[]): { p: number; line: number[] } | null {
  for (const l of LINES) if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[1]] === b[l[2]]) return { p: b[l[0]], line: l };
  return null;
}

/** Perfect play: score from `me`'s point of view, preferring faster wins. */
function minimax(b: number[], me: number, turn: number, depth: number): number {
  const w = winner(b);
  if (w) return w.p === me ? 10 - depth : depth - 10;
  if (b.every((v) => v)) return 0;
  let best = turn === me ? -Infinity : Infinity;
  for (let i = 0; i < 9; i++) {
    if (b[i]) continue;
    b[i] = turn;
    const s = minimax(b, me, 3 - turn, depth + 1);
    b[i] = 0;
    best = turn === me ? Math.max(best, s) : Math.min(best, s);
  }
  return best;
}

function perfectMove(b: number[], me: number): number {
  let best = -Infinity;
  let picks: number[] = [];
  for (let i = 0; i < 9; i++) {
    if (b[i]) continue;
    b[i] = me;
    const s = minimax(b, me, 3 - me, 1);
    b[i] = 0;
    if (s > best) {
      best = s;
      picks = [i];
    } else if (s === best) picks.push(i);
  }
  return picks[Math.floor(Math.random() * picks.length)];
}

function findLineMove(b: number[], p: number): number {
  for (const l of LINES) {
    const vals = l.map((i) => b[i]);
    if (vals.filter((v) => v === p).length === 2 && vals.includes(0)) return l[vals.indexOf(0)];
  }
  return -1;
}

export function cpuMove(b: number[], me: number, mode: Mode): number {
  const empty = b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  const random = () => empty[Math.floor(Math.random() * empty.length)];
  if (mode === 'hard') return perfectMove(b, me);
  const win = findLineMove(b, me);
  const block = findLineMove(b, 3 - me);
  if (mode === 'medium') {
    if (win >= 0) return win;
    if (block >= 0 && Math.random() < 0.85) return block;
    if (!b[4] && Math.random() < 0.6) return 4;
    return Math.random() < 0.5 ? perfectMove(b, me) : random();
  }
  // easy
  if (win >= 0 && Math.random() < 0.5) return win;
  if (block >= 0 && Math.random() < 0.3) return block;
  return random();
}

class Noughts implements Game {
  private ctx!: GameContext;
  private mode: Mode = 'medium';
  private board: number[] = Array(9).fill(0);
  private drawn: number[] = Array(9).fill(0); // stroke animation progress
  private turn = 1;
  private starter = 1;
  private cursor = 4;
  private kb = false;
  private cpuT = 0;
  private result: { text: string; t: number; line: number[] | null } | null = null;
  private wins = [0, 0, 0];
  private draws = 0;
  private points = 0;
  private over = false;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.mode = (ctx.mode as Mode) ?? 'medium';
    this.newRound();
  }

  private vsCpu(): boolean {
    return this.mode !== 'two';
  }

  private cpuTurn(): boolean {
    return this.vsCpu() && this.turn === 2;
  }

  private newRound(): void {
    this.board = Array(9).fill(0);
    this.drawn = Array(9).fill(0);
    this.turn = this.starter;
    this.starter = 3 - this.starter;
    this.result = null;
    this.cpuT = 0.55;
  }

  private place(i: number): void {
    if (this.board[i] || this.result || this.over) {
      if (!this.result) this.ctx.sfx.play('blip');
      return;
    }
    this.board[i] = this.turn;
    this.drawn[i] = this.ctx.reducedMotion ? 1 : 0;
    this.ctx.sfx.play(this.turn === 1 ? 'select' : 'rotate');
    const w = winner(this.board);
    if (w) this.endRound(w.p, w.line);
    else if (this.board.every((v) => v)) this.endRound(0, null);
    else {
      this.turn = 3 - this.turn;
      this.cpuT = 0.5;
    }
  }

  private endRound(p: number, line: number[] | null): void {
    if (p) this.wins[p]++;
    else this.draws++;
    let text: string;
    if (this.vsCpu()) {
      if (p === 1) {
        this.points += 3;
        text = 'YOU WIN! +3';
        this.ctx.sfx.play('levelup');
      } else if (p === 2) {
        text = 'CPU WINS';
        this.ctx.sfx.play('hit');
      } else {
        this.points += 1;
        text = 'DRAW +1';
        this.ctx.sfx.play('eat');
      }
      this.ctx.setScore(this.points);
    } else {
      text = p ? `${p === 1 ? 'X' : 'O'} WINS` : 'DRAW';
      this.ctx.sfx.play(p ? 'levelup' : 'eat');
    }
    this.result = { text, t: 1.6, line };
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
    for (let i = 0; i < 9; i++) if (this.board[i] && this.drawn[i] < 1) this.drawn[i] = Math.min(1, this.drawn[i] + dt / DRAW_TIME);
    if (this.result) {
      this.result.t -= dt;
      if (this.result.t <= 0) this.afterResult();
      return;
    }
    if (this.cpuTurn()) {
      this.cpuT -= dt;
      if (this.cpuT <= 0) this.place(cpuMove([...this.board], 2, this.mode));
    }
  }

  handleInput(input: GameInput): void {
    if (this.over || this.cpuTurn() || this.result) return;
    if (input.kind === 'pointer') {
      this.kb = false;
      if (input.phase !== 'up') return;
      const c = Math.floor((input.x - BX) / CELL);
      const r = Math.floor((input.y - BY) / CELL);
      if (c >= 0 && c < 3 && r >= 0 && r < 3) this.place(r * 3 + c);
      return;
    }
    if (input.kind !== 'press') return;
    this.kb = true;
    const r = Math.floor(this.cursor / 3);
    const c = this.cursor % 3;
    if (input.action === 'left') this.cursor = r * 3 + ((c + 2) % 3);
    else if (input.action === 'right') this.cursor = r * 3 + ((c + 1) % 3);
    else if (input.action === 'up') this.cursor = ((r + 2) % 3) * 3 + c;
    else if (input.action === 'down') this.cursor = ((r + 1) % 3) * 3 + c;
    else if (input.action === 'a' || input.action === 'b') this.place(this.cursor);
  }

  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#0b0712';
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
      g.fillStyle = MARK_COLORS[1];
      g.fillText(`X ${this.wins[1]}`, 12, TOP / 2);
      g.textAlign = 'center';
      g.fillStyle = '#9a96ad';
      g.fillText(`FIRST TO ${TARGET_WINS}`, W / 2, TOP / 2);
      g.textAlign = 'right';
      g.fillStyle = MARK_COLORS[2];
      g.fillText(`O ${this.wins[2]}`, W - 12, TOP / 2);
    }

    // Grid
    g.strokeStyle = COLOR;
    g.lineWidth = 4;
    g.lineCap = 'round';
    g.beginPath();
    for (let k = 1; k < 3; k++) {
      g.moveTo(BX + k * CELL, BY + 8);
      g.lineTo(BX + k * CELL, BY + 3 * CELL - 8);
      g.moveTo(BX + 8, BY + k * CELL);
      g.lineTo(BX + 3 * CELL - 8, BY + k * CELL);
    }
    g.stroke();

    // Marks
    for (let i = 0; i < 9; i++) {
      const v = this.board[i];
      if (!v) continue;
      const cx = BX + (i % 3) * CELL + CELL / 2;
      const cy = BY + Math.floor(i / 3) * CELL + CELL / 2;
      drawMark(g, v, cx, cy, CELL * 0.3, this.drawn[i]);
    }

    // Cursor
    if (this.kb && !this.result && !this.cpuTurn() && !this.over) {
      const x = BX + (this.cursor % 3) * CELL;
      const y = BY + Math.floor(this.cursor / 3) * CELL;
      g.strokeStyle = '#ffe14d';
      g.lineWidth = 2;
      g.lineCap = 'butt';
      g.strokeRect(x + 6, y + 6, CELL - 12, CELL - 12);
      if (!this.board[this.cursor]) {
        g.globalAlpha = 0.3;
        drawMark(g, this.turn, x + CELL / 2, y + CELL / 2, CELL * 0.3, 1);
        g.globalAlpha = 1;
      }
    }

    // Result
    const statusY = BY + 3 * CELL + 44;
    g.textAlign = 'center';
    if (this.result) {
      if (this.result.line) {
        const [a, , c] = this.result.line;
        g.strokeStyle = '#fff';
        g.lineWidth = 6;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(BX + (a % 3) * CELL + CELL / 2, BY + Math.floor(a / 3) * CELL + CELL / 2);
        g.lineTo(BX + (c % 3) * CELL + CELL / 2, BY + Math.floor(c / 3) * CELL + CELL / 2);
        g.stroke();
      }
      g.font = '14px "Press Start 2P", monospace';
      g.fillStyle = '#fff';
      g.fillText(this.result.text, W / 2, statusY);
    } else if (!this.over) {
      g.font = '10px "Press Start 2P", monospace';
      g.fillStyle = MARK_COLORS[this.turn];
      const who = this.vsCpu() ? (this.turn === 1 ? 'YOUR TURN (X)' : 'CPU THINKING…') : `${this.turn === 1 ? 'X' : 'O'} TO PLAY`;
      g.fillText(who, W / 2, statusY);
    }
    g.lineCap = 'butt';
  }

  destroy(): void {
    this.board = [];
  }
}

function drawMark(g: CanvasRenderingContext2D, v: number, cx: number, cy: number, r: number, k: number): void {
  g.strokeStyle = MARK_COLORS[v];
  g.lineWidth = 10;
  g.lineCap = 'round';
  g.beginPath();
  if (v === 1) {
    const k1 = Math.min(1, k * 2);
    const k2 = Math.max(0, k * 2 - 1);
    g.moveTo(cx - r, cy - r);
    g.lineTo(cx - r + 2 * r * k1, cy - r + 2 * r * k1);
    if (k2 > 0) {
      g.moveTo(cx + r, cy - r);
      g.lineTo(cx + r - 2 * r * k2, cy - r + 2 * r * k2);
    }
  } else {
    g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
  }
  g.stroke();
}

function preview(g: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  const s = 52;
  const bx = (w - 3 * s) / 2;
  const by = (h - 3 * s) / 2;
  g.strokeStyle = COLOR;
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.beginPath();
  for (let k = 1; k < 3; k++) {
    g.moveTo(bx + k * s, by + 4);
    g.lineTo(bx + k * s, by + 3 * s - 4);
    g.moveTo(bx + 4, by + k * s);
    g.lineTo(bx + 3 * s - 4, by + k * s);
  }
  g.stroke();
  const moves = [4, 0, 2, 6, 3, 5, 1];
  const shown = Math.floor(t * 1.5) % (moves.length + 3);
  moves.slice(0, Math.min(shown, moves.length)).forEach((cell, i) => {
    const prog = i === shown - 1 ? Math.min(1, (t * 1.5) % 1 * 3) : 1;
    drawMark(g, i % 2 ? 2 : 1, bx + (cell % 3) * s + s / 2, by + Math.floor(cell / 3) * s + s / 2, s * 0.28, prog);
  });
  g.lineCap = 'butt';
}

export const noughts: GameDef = {
  id: 'noughts',
  title: 'Noughts & Crosses',
  tagline: 'Three in a row. Hard mode never loses.',
  color: COLOR,
  width: W,
  height: H,
  controls: {
    keys: 'Arrows pick a square · Space places · Win 3 pts, draw 1, a loss ends the run',
    touch: 'Tap a square · Win 3 pts, draw 1, a loss ends the run',
  },
  touch: { pointer: true },
  modes: [
    { id: 'easy', label: 'Easy' },
    { id: 'medium', label: 'Medium' },
    { id: 'hard', label: 'Hard' },
    { id: 'two', label: '2 Players' },
  ],
  create: () => new Noughts(),
  preview,
};
