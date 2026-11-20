import type { Game, GameContext, GameDef, GameInput } from '../core/types';

const W = 560;
const H = 760;
const CW = 70;
const CH = 98;
const GAP = 8;
const M = (W - (7 * CW + 6 * GAP)) / 2;
const TOP_Y = 52;
const TAB_Y = TOP_Y + CH + 18;
const DOWN_OFF = 10;
const UP_OFF = 26;
const COLOR = '#7cff6b';
const SUITS = ['♠', '♥', '♦', '♣']; // spade, heart, diamond, club
const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

interface Card {
  s: number;
  r: number;
  up: boolean;
}

type PileRef =
  | { type: 'stock' }
  | { type: 'waste' }
  | { type: 'found'; i: number }
  | { type: 'tab'; i: number };

interface State {
  stock: Card[];
  waste: Card[];
  found: Card[][];
  tab: Card[][];
}

interface Drag {
  src: PileRef;
  index: number;
  cards: Card[];
  ox: number;
  oy: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  moved: boolean;
}

const red = (c: Card) => c.s === 1 || c.s === 2;
const colX = (c: number) => M + c * (CW + GAP);
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

class Klondike implements Game {
  private ctx!: GameContext;
  private st: State = { stock: [], waste: [], found: [[], [], [], []], tab: [] };
  private undo: string[] = [];
  private drawN = 1;
  private time = 0;
  private shown = -1;
  private moves = 0;
  private drag: Drag | null = null;
  private auto = false;
  private autoT = 0;
  private won = false;
  // Keyboard cursor
  private cur = { row: 1, col: 0, depth: 0 };
  private held: { src: PileRef; index: number } | null = null;
  private kbActive = false;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.drawN = ctx.mode === 'draw3' ? 3 : 1;
    const deck: Card[] = [];
    for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) deck.push({ s, r, up: false });
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    for (let i = 0; i < 7; i++) {
      const pile = deck.splice(0, i + 1);
      pile[pile.length - 1].up = true;
      this.st.tab.push(pile);
    }
    this.st.stock = deck;
    this.ctx.setScore(0);
  }

  // ---------- rules ----------
  private pile(ref: PileRef): Card[] {
    switch (ref.type) {
      case 'stock':
        return this.st.stock;
      case 'waste':
        return this.st.waste;
      case 'found':
        return this.st.found[ref.i];
      case 'tab':
        return this.st.tab[ref.i];
    }
  }

  private snapshot(): void {
    this.undo.push(JSON.stringify(this.st));
    if (this.undo.length > 500) this.undo.shift();
  }

  private doUndo(): void {
    const prev = this.undo.pop();
    if (!prev || this.won) return;
    this.st = JSON.parse(prev);
    this.drag = null;
    this.held = null;
    this.auto = false;
    this.ctx.sfx.play('pause');
  }

  private drawStock(): void {
    const { stock, waste } = this.st;
    if (!stock.length && !waste.length) return;
    this.snapshot();
    if (!stock.length) {
      this.st.stock = waste.reverse().map((c) => ({ ...c, up: false }));
      this.st.waste = [];
    } else {
      for (let i = 0; i < this.drawN && stock.length; i++) {
        const c = stock.pop()!;
        c.up = true;
        waste.push(c);
      }
    }
    this.moves++;
    this.ctx.sfx.play('card');
  }

  private canPlace(cards: Card[], dst: PileRef): boolean {
    const first = cards[0];
    if (dst.type === 'found') {
      if (cards.length !== 1) return false;
      const f = this.st.found[dst.i];
      const top = f[f.length - 1];
      return top ? top.s === first.s && first.r === top.r + 1 : first.r === 1;
    }
    if (dst.type === 'tab') {
      const t = this.st.tab[dst.i];
      const top = t[t.length - 1];
      return top ? top.up && red(top) !== red(first) && first.r === top.r - 1 : first.r === 13;
    }
    return false;
  }

  /** Cards that can be picked up from a pile starting at `index`, or null. */
  private pickable(src: PileRef, index: number): Card[] | null {
    const p = this.pile(src);
    if (index < 0 || index >= p.length) return null;
    if (src.type === 'stock') return null;
    if (src.type !== 'tab' && index !== p.length - 1) return null;
    if (!p[index].up) return null;
    return p.slice(index);
  }

  private move(src: PileRef, index: number, dst: PileRef): boolean {
    const cards = this.pickable(src, index);
    if (!cards || !this.canPlace(cards, dst)) return false;
    if (src.type === dst.type && 'i' in src && 'i' in dst && src.i === dst.i) return false;
    this.snapshot();
    this.pile(src).splice(index);
    this.pile(dst).push(...cards);
    if (src.type === 'tab') {
      const t = this.st.tab[src.i];
      if (t.length && !t[t.length - 1].up) t[t.length - 1].up = true;
    }
    this.moves++;
    this.ctx.sfx.play(dst.type === 'found' ? 'eat' : 'card');
    this.checkEnd();
    return true;
  }

  /** Tap / click: send to a foundation if possible, otherwise to the first legal tableau pile. */
  private autoMove(src: PileRef, index: number): boolean {
    const cards = this.pickable(src, index);
    if (!cards) return false;
    if (cards.length === 1 && src.type !== 'found') {
      for (let i = 0; i < 4; i++) if (this.move(src, index, { type: 'found', i })) return true;
    }
    for (let i = 0; i < 7; i++) {
      if (src.type === 'tab' && src.i === i) continue;
      // Don't shuffle a king from one empty-bottomed pile to another.
      if (cards[0].r === 13 && src.type === 'tab' && index === 0 && !this.st.tab[i].length) continue;
      if (this.move(src, index, { type: 'tab', i })) return true;
    }
    return false;
  }

  private checkEnd(): void {
    if (this.st.found.every((f) => f.length === 13)) {
      this.won = true;
      this.auto = false;
      this.ctx.gameOver(Math.max(1, Math.ceil(this.time)), { won: true });
      return;
    }
    if (
      !this.auto &&
      !this.st.stock.length &&
      !this.st.waste.length &&
      this.st.tab.every((t) => t.every((c) => c.up))
    ) {
      this.auto = true;
      this.autoT = 0;
    }
  }

  private autoStep(): void {
    // Move the lowest card that can go to a foundation.
    let best: { src: PileRef; index: number; r: number } | null = null;
    this.st.tab.forEach((t, i) => {
      const c = t[t.length - 1];
      if (c && (!best || c.r < best.r)) best = { src: { type: 'tab', i }, index: t.length - 1, r: c.r };
    });
    if (!best) return;
    const b = best as { src: PileRef; index: number };
    for (let i = 0; i < 4; i++) if (this.move(b.src, b.index, { type: 'found', i })) return;
    this.auto = false; // shouldn't happen once all cards are up, but never loop forever
  }

  // ---------- geometry ----------
  private tabYs(i: number): number[] {
    const t = this.st.tab[i];
    let total = 0;
    for (let k = 0; k < t.length - 1; k++) total += t[k].up ? UP_OFF : DOWN_OFF;
    const room = H - 8 - CH - TAB_Y;
    const scale = total > room ? room / total : 1;
    const ys: number[] = [];
    let y = TAB_Y;
    for (let k = 0; k < t.length; k++) {
      ys.push(y);
      y += (t[k].up ? UP_OFF : DOWN_OFF) * scale;
    }
    return ys;
  }

  private wasteXs(): number[] {
    const n = this.st.waste.length;
    const show = Math.min(n, this.drawN === 3 ? 3 : 1);
    return Array.from({ length: show }, (_, k) => colX(1) + k * 18);
  }

  private pileRect(ref: PileRef): { x: number; y: number; w: number; h: number } {
    if (ref.type === 'stock') return { x: colX(0), y: TOP_Y, w: CW, h: CH };
    if (ref.type === 'waste') {
      const xs = this.wasteXs();
      return { x: xs.length ? xs[xs.length - 1] : colX(1), y: TOP_Y, w: CW, h: CH };
    }
    if (ref.type === 'found') return { x: colX(3 + ref.i), y: TOP_Y, w: CW, h: CH };
    const ys = this.tabYs(ref.i);
    const last = ys.length ? ys[ys.length - 1] : TAB_Y;
    return { x: colX(ref.i), y: TAB_Y, w: CW, h: last - TAB_Y + CH };
  }

  private hit(x: number, y: number): { src: PileRef; index: number } | null {
    const inR = (rx: number, ry: number, rw: number, rh: number) => x >= rx && x < rx + rw && y >= ry && y < ry + rh;
    if (inR(colX(0), TOP_Y, CW, CH)) return { src: { type: 'stock' }, index: this.st.stock.length - 1 };
    const wx = this.wasteXs();
    if (wx.length && inR(wx[wx.length - 1], TOP_Y, CW, CH))
      return { src: { type: 'waste' }, index: this.st.waste.length - 1 };
    for (let i = 0; i < 4; i++)
      if (inR(colX(3 + i), TOP_Y, CW, CH)) return { src: { type: 'found', i }, index: this.st.found[i].length - 1 };
    for (let i = 0; i < 7; i++) {
      const ys = this.tabYs(i);
      for (let k = ys.length - 1; k >= 0; k--) {
        if (inR(colX(i), ys[k], CW, CH)) return { src: { type: 'tab', i }, index: k };
      }
      if (!ys.length && inR(colX(i), TAB_Y, CW, CH)) return { src: { type: 'tab', i }, index: -1 };
    }
    return null;
  }

  // ---------- loop ----------
  update(dt: number): void {
    if (this.won) return;
    this.time += dt;
    const s = Math.floor(this.time);
    if (s !== this.shown) {
      this.shown = s;
      this.ctx.setScore(s);
    }
    if (this.auto && !this.drag) {
      this.autoT -= dt;
      if (this.autoT <= 0) {
        this.autoT = 0.08;
        this.autoStep();
      }
    }
  }

  handleInput(input: GameInput): void {
    if (this.won) return;
    if (input.kind === 'pointer') return this.pointer(input.phase, input.x, input.y);
    if (input.kind !== 'press') return;
    if (input.action === 'b') return this.doUndo();
    this.kbActive = true;
    this.keyboard(input.action);
  }

  private pointer(phase: 'down' | 'move' | 'up', x: number, y: number): void {
    if (phase === 'down') {
      this.kbActive = false;
      this.held = null;
      const h = this.hit(x, y);
      if (!h || this.auto) return;
      if (h.src.type === 'stock') {
        this.drawStock();
        return;
      }
      const cards = this.pickable(h.src, h.index);
      if (!cards) return;
      const r = h.src.type === 'tab' ? { x: colX(h.src.i), y: this.tabYs(h.src.i)[h.index] } : this.pileRect(h.src);
      this.drag = { src: h.src, index: h.index, cards, ox: x - r.x, oy: y - r.y, x, y, sx: x, sy: y, moved: false };
    } else if (phase === 'move') {
      if (!this.drag) return;
      this.drag.x = x;
      this.drag.y = y;
      if (Math.hypot(x - this.drag.sx, y - this.drag.sy) > 6) this.drag.moved = true;
    } else {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (!d.moved) {
        if (!this.autoMove(d.src, d.index)) this.ctx.sfx.play('blip');
        return;
      }
      // Drop on the pile with the biggest overlap.
      const cx = d.x - d.ox;
      const cy = d.y - d.oy;
      let best: PileRef | null = null;
      let bestArea = 0;
      const targets: PileRef[] = [
        ...[0, 1, 2, 3].map((i) => ({ type: 'found', i }) as PileRef),
        ...[0, 1, 2, 3, 4, 5, 6].map((i) => ({ type: 'tab', i }) as PileRef),
      ];
      for (const t of targets) {
        const r = this.pileRect(t);
        // For tableau piles, the drop zone is the last card.
        const ry = t.type === 'tab' ? r.y + r.h - CH : r.y;
        const ow = Math.min(cx + CW, r.x + CW) - Math.max(cx, r.x);
        const oh = Math.min(cy + CH, ry + CH) - Math.max(cy, ry);
        const area = ow > 0 && oh > 0 ? ow * oh : 0;
        if (area > bestArea) {
          bestArea = area;
          best = t;
        }
      }
      if (!best || !this.move(d.src, d.index, best)) this.ctx.sfx.play('blip');
    }
  }

  // Keyboard: two rows of slots. Top: stock, waste, 4 foundations. Bottom: 7 tableau piles.
  private static TOP_COLS = [0, 1, 3, 4, 5, 6];

  private curRef(): PileRef {
    if (this.cur.row === 0) {
      const c = Klondike.TOP_COLS[this.cur.col];
      if (c === 0) return { type: 'stock' };
      if (c === 1) return { type: 'waste' };
      return { type: 'found', i: c - 3 };
    }
    return { type: 'tab', i: this.cur.col };
  }

  private firstUp(i: number): number {
    const t = this.st.tab[i];
    const k = t.findIndex((c) => c.up);
    return k < 0 ? Math.max(0, t.length - 1) : k;
  }

  private keyboard(action: string): void {
    const c = this.cur;
    switch (action) {
      case 'left':
      case 'right': {
        const d = action === 'left' ? -1 : 1;
        const n = c.row === 0 ? Klondike.TOP_COLS.length : 7;
        c.col = (c.col + d + n) % n;
        if (c.row === 1) c.depth = Math.max(0, this.st.tab[c.col].length - 1);
        this.ctx.sfx.play('move');
        break;
      }
      case 'up':
        if (c.row === 1 && !this.held && c.depth > this.firstUp(c.col)) c.depth--;
        else if (c.row === 1) {
          const x = c.col;
          c.row = 0;
          c.col = Klondike.TOP_COLS.reduce((bi, v, i) => (Math.abs(v - x) < Math.abs(Klondike.TOP_COLS[bi] - x) ? i : bi), 0);
        }
        this.ctx.sfx.play('move');
        break;
      case 'down':
        if (c.row === 0) {
          c.col = Klondike.TOP_COLS[c.col];
          c.row = 1;
          c.depth = Math.max(0, this.st.tab[c.col].length - 1);
        } else if (!this.held && c.depth < this.st.tab[c.col].length - 1) c.depth++;
        this.ctx.sfx.play('move');
        break;
      case 'a': {
        const ref = this.curRef();
        if (this.held) {
          const h = this.held;
          this.held = null;
          const same = JSON.stringify(h.src) === JSON.stringify(ref);
          if (same) {
            if (!this.autoMove(h.src, h.index)) this.ctx.sfx.play('blip');
          } else if (!this.move(h.src, h.index, ref)) this.ctx.sfx.play('blip');
          if (c.row === 1) c.depth = Math.max(0, this.st.tab[c.col].length - 1);
          return;
        }
        if (ref.type === 'stock') return this.drawStock();
        const p = this.pile(ref);
        const index = ref.type === 'tab' ? Math.min(c.depth, p.length - 1) : p.length - 1;
        if (this.pickable(ref, index)) {
          this.held = { src: ref, index };
          this.ctx.sfx.play('select');
        } else this.ctx.sfx.play('blip');
        break;
      }
    }
  }

  // ---------- rendering ----------
  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#062014';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(124,255,107,0.04)';
    for (let y = 0; y < H; y += 8) g.fillRect(0, y, W, 1);

    // Header
    g.font = '10px "Press Start 2P", monospace';
    g.textBaseline = 'middle';
    g.fillStyle = COLOR;
    g.textAlign = 'left';
    g.fillText(this.drawN === 3 ? 'DRAW 3' : 'DRAW 1', M, 24);
    g.textAlign = 'center';
    g.fillStyle = '#cfe9c9';
    g.fillText(fmtTime(this.time), W / 2, 24);
    g.textAlign = 'right';
    g.fillText(`MOVES ${this.moves}`, W - M, 24);

    const dragging = this.drag?.moved ? this.drag : null;
    const hidden = (ref: PileRef, k: number) =>
      !!dragging && JSON.stringify(dragging.src) === JSON.stringify(ref) && k >= dragging.index;

    // Stock
    if (this.st.stock.length) drawBack(g, colX(0), TOP_Y);
    else {
      drawSlot(g, colX(0), TOP_Y);
      if (this.st.waste.length) {
        g.strokeStyle = 'rgba(124,255,107,0.5)';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(colX(0) + CW / 2, TOP_Y + CH / 2, 16, 0.3, Math.PI * 1.8);
        g.stroke();
      }
    }

    // Waste
    const wx = this.wasteXs();
    const wn = this.st.waste.length;
    if (!wn) drawSlot(g, colX(1), TOP_Y);
    wx.forEach((x, k) => {
      const idx = wn - wx.length + k;
      if (!hidden({ type: 'waste' }, idx)) drawCard(g, this.st.waste[idx], x, TOP_Y);
    });

    // Foundations
    for (let i = 0; i < 4; i++) {
      const f = this.st.found[i];
      const x = colX(3 + i);
      drawSlot(g, x, TOP_Y, SUITS[i]);
      if (f.length) {
        const showIdx = hidden({ type: 'found', i }, f.length - 1) ? f.length - 2 : f.length - 1;
        if (showIdx >= 0) drawCard(g, f[showIdx], x, TOP_Y);
      }
    }

    // Tableau
    for (let i = 0; i < 7; i++) {
      const t = this.st.tab[i];
      const ys = this.tabYs(i);
      if (!t.length) drawSlot(g, colX(i), TAB_Y, 'K');
      t.forEach((c, k) => {
        if (hidden({ type: 'tab', i }, k)) return;
        const lift = this.held && this.held.src.type === 'tab' && this.held.src.i === i && k >= this.held.index ? -8 : 0;
        if (c.up) drawCard(g, c, colX(i), ys[k] + lift);
        else drawBack(g, colX(i), ys[k]);
      });
    }

    // Keyboard cursor
    if (this.kbActive && !this.won) {
      const ref = this.curRef();
      let r = this.pileRect(ref);
      if (ref.type === 'tab') {
        const ys = this.tabYs(ref.i);
        const k = Math.min(this.cur.depth, ys.length - 1);
        r = ys.length ? { x: r.x, y: ys[k], w: CW, h: ys[ys.length - 1] - ys[k] + CH } : r;
      }
      g.strokeStyle = this.held ? '#ffe14d' : COLOR;
      g.lineWidth = 3;
      g.strokeRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
    }
    // Held selection outline
    if (this.held && this.held.src.type !== 'tab') {
      const r = this.pileRect(this.held.src);
      g.strokeStyle = '#ffe14d';
      g.lineWidth = 2;
      g.strokeRect(r.x - 2, r.y - 10, r.w + 4, r.h + 4);
    }

    // Dragged cards
    if (dragging) {
      const x = dragging.x - dragging.ox;
      const y = dragging.y - dragging.oy;
      g.shadowColor = 'rgba(0,0,0,0.6)';
      g.shadowBlur = 12;
      dragging.cards.forEach((c, k) => drawCard(g, c, x, y + k * UP_OFF));
      g.shadowBlur = 0;
    }

    if (this.auto) {
      g.textAlign = 'center';
      g.fillStyle = COLOR;
      g.font = '10px "Press Start 2P", monospace';
      g.fillText('AUTO-COMPLETE', W / 2, H - 16);
    }
  }

  destroy(): void {
    this.undo = [];
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function drawSlot(g: CanvasRenderingContext2D, x: number, y: number, label?: string) {
  roundRect(g, x + 1, y + 1, CW - 2, CH - 2, 6);
  g.strokeStyle = 'rgba(124,255,107,0.35)';
  g.lineWidth = 2;
  g.stroke();
  if (label) {
    g.fillStyle = 'rgba(124,255,107,0.3)';
    g.font = '28px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, x + CW / 2, y + CH / 2);
  }
}

function drawBack(g: CanvasRenderingContext2D, x: number, y: number) {
  roundRect(g, x, y, CW, CH, 6);
  g.fillStyle = '#123d24';
  g.fill();
  g.strokeStyle = COLOR;
  g.lineWidth = 2;
  g.stroke();
  g.save();
  g.clip();
  g.strokeStyle = 'rgba(124,255,107,0.35)';
  g.lineWidth = 1;
  for (let k = -CH; k < CW + CH; k += 10) {
    g.beginPath();
    g.moveTo(x + k, y);
    g.lineTo(x + k + CH, y + CH);
    g.moveTo(x + k + CH, y);
    g.lineTo(x + k, y + CH);
    g.stroke();
  }
  g.restore();
}

function drawCard(g: CanvasRenderingContext2D, c: Card, x: number, y: number) {
  roundRect(g, x, y, CW, CH, 6);
  g.fillStyle = '#f7f5ee';
  g.fill();
  g.strokeStyle = '#1a1a1a';
  g.lineWidth = 1;
  g.stroke();
  const col = red(c) ? '#d8263b' : '#1b1b24';
  g.fillStyle = col;
  g.textBaseline = 'top';
  g.textAlign = 'left';
  g.font = 'bold 17px Archivo, sans-serif';
  g.fillText(RANKS[c.r], x + 6, y + 6);
  g.font = '16px sans-serif';
  g.fillText(SUITS[c.s], x + 6, y + 25);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (c.r > 10) {
    g.font = 'bold 34px Archivo, sans-serif';
    g.fillText(RANKS[c.r], x + CW / 2 + 6, y + CH / 2 + 10);
    g.font = '18px sans-serif';
    g.fillText(SUITS[c.s], x + CW - 14, y + CH - 16);
  } else {
    g.font = '36px sans-serif';
    g.fillText(SUITS[c.s], x + CW / 2 + 6, y + CH / 2 + 12);
  }
}

function preview(g: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  g.fillStyle = '#062014';
  g.fillRect(0, 0, w, h);
  g.save();
  const s = 0.62;
  g.scale(s, s);
  const cards: Card[] = [
    { s: 0, r: 13, up: true },
    { s: 1, r: 12, up: true },
    { s: 3, r: 11, up: true },
    { s: 2, r: 10, up: true },
  ];
  // Four tableau piles of backs with a face-up run on the second.
  for (let i = 0; i < 6; i++) {
    const x = 18 + i * (CW + 14);
    for (let k = 0; k < i % 3; k++) drawBack(g, x, 120 + k * DOWN_OFF);
    if (i === 1) cards.forEach((c, k) => drawCard(g, c, x, 120 + 2 * DOWN_OFF + k * UP_OFF));
    else drawCard(g, { s: (i * 3) % 4, r: ((i * 5) % 13) + 1, up: true }, x, 120 + (i % 3) * DOWN_OFF);
  }
  // Foundations along the top
  for (let i = 0; i < 4; i++) drawCard(g, { s: i, r: 1 + ((i * 2 + Math.floor(t)) % 5), up: true }, 18 + (i + 2) * (CW + 14), 10);
  drawBack(g, 18, 10);
  // A card gliding from the waste to a foundation
  const p = (t * 0.5) % 1;
  const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  const fx = 18 + (CW + 14) + ease * (5 * (CW + 14) - (CW + 14));
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 10;
  drawCard(g, { s: 1, r: 9, up: true }, fx, 10 + Math.sin(p * Math.PI) * -6);
  g.restore();
  g.shadowBlur = 0;
  void h;
}

export const klondike: GameDef = {
  id: 'klondike',
  title: 'Klondike',
  tagline: 'Classic patience, draw 1 or 3.',
  color: COLOR,
  width: W,
  height: H,
  controls: {
    keys: 'Mouse: drag, or click to auto-move · Keys: arrows select, Space pick/drop, X undo',
    touch: 'Drag cards, or tap to auto-move · Tap the deck to draw · UNDO button',
  },
  touch: { pointer: true, buttons: ['b'], labels: { b: 'UNDO' } },
  modes: [
    { id: 'draw1', label: 'Draw 1' },
    { id: 'draw3', label: 'Draw 3' },
  ],
  lowerIsBetter: true,
  formatScore: (n) => fmtTime(n),
  create: () => new Klondike(),
  preview,
};
