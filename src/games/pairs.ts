import type { Game, GameContext, GameDef, GameInput } from '../core/types';

const W = 440;
const H = 560;
const TOP = 44;
const GAP = 8;
const COLOR = '#7c9bff';
const FLIP_TIME = 0.15;
const MISMATCH_TIME = 0.8;
const SIZES: Record<string, number> = { small: 4, large: 6 };
const SYMBOL_COLORS = ['#ff4d6d', '#ffe14d', '#4dfff3', '#7cff6b', '#c86bff', '#ff9f43', '#ff8fd8', '#4d7cff', '#f4f1ff'];
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

interface Card {
  id: number; // symbol id; two cards share each id
  face: number; // 0 = back showing, 1 = front showing
  up: boolean;
  matched: boolean;
}

class Pairs implements Game {
  private ctx!: GameContext;
  private n = 4;
  private cards: Card[] = [];
  private size = 80;
  private ox = 0;
  private oy = 0;
  private open: number[] = [];
  private mismatchT = 0;
  private moves = 0;
  private found = 0;
  private time = 0;
  private shown = -1;
  private started = false;
  private cursor = 0;
  private kb = false;
  private over = false;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.n = SIZES[ctx.mode ?? 'small'] ?? 4;
    const pairs = (this.n * this.n) / 2;
    const ids: number[] = [];
    for (let k = 0; k < pairs; k++) ids.push(k, k);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    this.cards = ids.map((id) => ({ id, face: 0, up: false, matched: false }));
    this.size = Math.floor(Math.min((W - 24 - GAP * (this.n - 1)) / this.n, (H - TOP - 20 - GAP * (this.n - 1)) / this.n));
    const span = this.n * this.size + (this.n - 1) * GAP;
    this.ox = Math.floor((W - span) / 2);
    this.oy = TOP + Math.floor((H - TOP - span) / 2);
    ctx.setScore(0);
  }

  private flipDownOpen(): void {
    for (const i of this.open) this.cards[i].up = false;
    this.open = [];
    this.mismatchT = 0;
  }

  private pick(i: number): void {
    const c = this.cards[i];
    if (!c || c.matched || c.up || this.over) return;
    if (this.mismatchT > 0) this.flipDownOpen();
    this.started = true;
    c.up = true;
    this.open.push(i);
    this.ctx.sfx.play('card');
    if (this.open.length < 2) return;
    this.moves++;
    const [a, b] = this.open.map((k) => this.cards[k]);
    if (a.id === b.id) {
      a.matched = b.matched = true;
      this.open = [];
      this.found++;
      this.ctx.sfx.play('eat');
      if (this.found === this.cards.length / 2) {
        this.over = true;
        this.ctx.gameOver(Math.max(1, Math.ceil(this.time)), { won: true });
      }
    } else {
      this.mismatchT = MISMATCH_TIME;
    }
  }

  update(dt: number): void {
    const step = this.ctx.reducedMotion ? 1 : dt / FLIP_TIME;
    for (const c of this.cards) {
      const target = c.up || c.matched ? 1 : 0;
      if (c.face < target) c.face = Math.min(target, c.face + step);
      else if (c.face > target) c.face = Math.max(target, c.face - step);
    }
    if (this.over) return;
    if (this.started) {
      this.time += dt;
      const s = Math.floor(this.time);
      if (s !== this.shown) {
        this.shown = s;
        this.ctx.setScore(s);
      }
    }
    if (this.mismatchT > 0) {
      this.mismatchT -= dt;
      if (this.mismatchT <= 0) this.flipDownOpen();
    }
  }

  handleInput(input: GameInput): void {
    if (this.over) return;
    if (input.kind === 'pointer') {
      this.kb = false;
      if (input.phase !== 'up') return;
      const span = this.size + GAP;
      const c = Math.floor((input.x - this.ox) / span);
      const r = Math.floor((input.y - this.oy) / span);
      const inCard = (input.x - this.ox) % span < this.size && (input.y - this.oy) % span < this.size;
      if (c >= 0 && r >= 0 && c < this.n && r < this.n && inCard) this.pick(r * this.n + c);
      return;
    }
    if (input.kind !== 'press') return;
    this.kb = true;
    const n = this.n;
    const r = Math.floor(this.cursor / n);
    const c = this.cursor % n;
    if (input.action === 'left') this.cursor = r * n + ((c + n - 1) % n);
    else if (input.action === 'right') this.cursor = r * n + ((c + 1) % n);
    else if (input.action === 'up') this.cursor = ((r + n - 1) % n) * n + c;
    else if (input.action === 'down') this.cursor = ((r + 1) % n) * n + c;
    else this.pick(this.cursor);
  }

  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#0a0a14';
    g.fillRect(0, 0, W, H);

    g.font = '10px "Press Start 2P", monospace';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.fillText(`MOVES ${this.moves}`, 12, TOP / 2);
    g.textAlign = 'center';
    g.fillText(fmtTime(this.time), W / 2, TOP / 2);
    g.textAlign = 'right';
    g.fillStyle = COLOR;
    g.fillText(`PAIRS ${this.found}/${this.cards.length / 2}`, W - 12, TOP / 2);

    const s = this.size;
    this.cards.forEach((card, i) => {
      const x = this.ox + (i % this.n) * (s + GAP);
      const y = this.oy + Math.floor(i / this.n) * (s + GAP);
      const sx = Math.abs(Math.cos(card.face * Math.PI));
      const front = card.face > 0.5;
      g.save();
      g.translate(x + s / 2, y + s / 2);
      g.scale(Math.max(0.02, sx), 1);
      if (front) {
        g.fillStyle = card.matched ? '#161a2e' : '#1f2440';
        g.beginPath();
        g.roundRect(-s / 2, -s / 2, s, s, 6);
        g.fill();
        g.strokeStyle = card.matched ? 'rgba(124,155,255,0.35)' : COLOR;
        g.lineWidth = 2;
        g.stroke();
        g.globalAlpha = card.matched ? 0.55 : 1;
        drawSymbol(g, card.id, s * 0.3);
        g.globalAlpha = 1;
      } else drawBack(g, s);
      g.restore();
    });

    if (this.kb && !this.over) {
      const x = this.ox + (this.cursor % this.n) * (s + GAP);
      const y = this.oy + Math.floor(this.cursor / this.n) * (s + GAP);
      g.strokeStyle = '#ffe14d';
      g.lineWidth = 3;
      g.strokeRect(x - 3, y - 3, s + 6, s + 6);
    }
  }

  destroy(): void {
    this.cards = [];
  }
}

function drawBack(g: CanvasRenderingContext2D, s: number): void {
  g.fillStyle = '#2a2f66';
  g.beginPath();
  g.roundRect(-s / 2, -s / 2, s, s, 6);
  g.fill();
  g.strokeStyle = COLOR;
  g.lineWidth = 2;
  g.stroke();
  g.strokeStyle = 'rgba(124,155,255,0.45)';
  g.lineWidth = 1.5;
  const r = s * 0.28;
  g.beginPath();
  g.moveTo(0, -r);
  g.lineTo(r, 0);
  g.lineTo(0, r);
  g.lineTo(-r, 0);
  g.closePath();
  g.stroke();
  g.beginPath();
  g.arc(0, 0, r * 0.35, 0, Math.PI * 2);
  g.stroke();
}

/** 9 shapes; ids 9–17 reuse the shapes in a different colour. */
function drawSymbol(g: CanvasRenderingContext2D, id: number, r: number): void {
  const shape = id % 9;
  g.fillStyle = SYMBOL_COLORS[(shape + (id >= 9 ? 4 : 0)) % 9];
  g.strokeStyle = g.fillStyle;
  g.lineWidth = r * 0.3;
  g.beginPath();
  switch (shape) {
    case 0:
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
      break;
    case 1:
      g.fillRect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7);
      break;
    case 2:
      g.moveTo(0, -r);
      g.lineTo(r, r * 0.8);
      g.lineTo(-r, r * 0.8);
      g.closePath();
      g.fill();
      break;
    case 3:
      g.moveTo(0, -r);
      g.lineTo(r * 0.75, 0);
      g.lineTo(0, r);
      g.lineTo(-r * 0.75, 0);
      g.closePath();
      g.fill();
      break;
    case 4:
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.45 : r;
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      break;
    case 5:
      g.arc(0, 0, r * 0.8, 0, Math.PI * 2);
      g.stroke();
      break;
    case 6:
      g.fillRect(-r, -r * 0.3, r * 2, r * 0.6);
      g.fillRect(-r * 0.3, -r, r * 0.6, r * 2);
      break;
    case 7:
      for (let i = 0; i < 6; i++) g.lineTo(Math.cos((Math.PI / 3) * i) * r, Math.sin((Math.PI / 3) * i) * r);
      g.closePath();
      g.fill();
      break;
    case 8:
      g.moveTo(0, r * 0.9);
      g.bezierCurveTo(-r * 1.4, -r * 0.1, -r * 0.6, -r * 1.2, 0, -r * 0.4);
      g.bezierCurveTo(r * 0.6, -r * 1.2, r * 1.4, -r * 0.1, 0, r * 0.9);
      g.fill();
      break;
  }
}

function preview(g: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  const n = 4;
  const s = 38;
  const gap = 6;
  const span = n * s + (n - 1) * gap;
  const ox = (w - span) / 2;
  const oy = (h - span) / 2;
  const ids = [0, 4, 2, 7, 3, 0, 5, 2, 6, 1, 4, 7, 1, 5, 3, 6];
  const matched = new Set([2, 7, 9, 12]); // a few solved cards
  const phase = (t * 0.7) % 2; // a pair flips up then down
  const flipping = [0, 5];
  ids.forEach((id, i) => {
    const x = ox + (i % n) * (s + gap) + s / 2;
    const y = oy + Math.floor(i / n) * (s + gap) + s / 2;
    let face = matched.has(i) ? 1 : 0;
    if (flipping.includes(i)) face = phase < 1 ? Math.min(1, phase * 4) : Math.max(0, 1 - (phase - 1.5) * 4);
    g.save();
    g.translate(x, y);
    g.scale(Math.max(0.02, Math.abs(Math.cos(face * Math.PI))), 1);
    if (face > 0.5) {
      g.fillStyle = '#1f2440';
      g.fillRect(-s / 2, -s / 2, s, s);
      drawSymbol(g, id, s * 0.3);
    } else drawBack(g, s);
    g.restore();
  });
}

export const pairs: GameDef = {
  id: 'pairs',
  title: 'Pairs',
  tagline: 'Flip two cards, remember, match them all.',
  color: COLOR,
  width: W,
  height: H,
  controls: {
    keys: 'Click a card, or arrows + Space · Match every pair as fast as you can',
    touch: 'Tap two cards to flip them · Match every pair as fast as you can',
  },
  touch: { pointer: true },
  modes: [
    { id: 'small', label: '4 × 4' },
    { id: 'large', label: '6 × 6' },
  ],
  lowerIsBetter: true,
  formatScore: (n) => fmtTime(n),
  create: () => new Pairs(),
  preview,
};
