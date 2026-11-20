import type { Action, GameDef, GameInput } from './types';
import { getSettings } from './settings';

const KEYMAP: Record<string, Action> = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Space: 'a', KeyZ: 'a',
  KeyX: 'b', KeyC: 'b', ShiftLeft: 'b', ShiftRight: 'b',
};

export function keyToAction(code: string): Action | undefined {
  return KEYMAP[code];
}

/**
 * Turns keyboard, swipe, on-screen buttons and pointer events into GameInput.
 * `enabled()` gates delivery so input only reaches the game while it is playing.
 */
export class InputManager {
  private held = new Set<Action>();
  private cleanup: Array<() => void> = [];

  constructor(
    private def: GameDef,
    private canvas: HTMLCanvasElement,
    private emit: (input: GameInput) => void,
    private enabled: () => boolean,
  ) {
    this.bindCanvas();
  }

  isDown = (action: Action): boolean => this.held.has(action);

  /** Called by the runner for keydown/keyup it doesn't consume itself. */
  key(e: KeyboardEvent, down: boolean): boolean {
    const action = keyToAction(e.code);
    if (!action) return false;
    e.preventDefault();
    if (e.repeat) return true;
    if (down) this.press(action);
    else this.release(action);
    return true;
  }

  press(action: Action): void {
    if (!this.enabled()) return;
    if (this.held.has(action)) return;
    this.held.add(action);
    this.emit({ kind: 'press', action });
  }

  release(action: Action): void {
    if (!this.held.has(action)) return;
    this.held.delete(action);
    if (this.enabled()) this.emit({ kind: 'release', action });
  }

  releaseAll(): void {
    [...this.held].forEach((a) => this.release(a));
    this.held.clear();
  }

  swipeEnabled(): boolean {
    const t = this.def.touch;
    if (!t.swipe) return false;
    return !t.dpad || getSettings().touchMode === 'swipe';
  }

  private toLogical(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * this.def.width,
      y: ((e.clientY - r.top) / r.height) * this.def.height,
    };
  }

  private bindCanvas(): void {
    const c = this.canvas;
    let start: { x: number; y: number; t: number; id: number } | null = null;

    const down = (e: PointerEvent) => {
      if (!this.enabled()) return;
      e.preventDefault();
      c.setPointerCapture?.(e.pointerId);
      start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      if (this.def.touch.pointer)
        this.emit({ kind: 'pointer', phase: 'down', button: e.button, pointerType: e.pointerType, ...this.toLogical(e) });
    };
    const move = (e: PointerEvent) => {
      if (!this.enabled() || !this.def.touch.pointer) return;
      // Mouse hover also moves; touch only while pressed.
      if (e.pointerType !== 'mouse' && !start) return;
      this.emit({ kind: 'pointer', phase: 'move', pointerType: e.pointerType, ...this.toLogical(e) });
    };
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const s = start;
      start = null;
      if (!this.enabled()) return;
      if (this.def.touch.pointer)
        this.emit({ kind: 'pointer', phase: 'up', button: e.button, pointerType: e.pointerType, ...this.toLogical(e) });
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      const dist = Math.hypot(dx, dy);
      if (this.swipeEnabled() && dist > 30) {
        const dir: Action = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
        this.emit({ kind: 'press', action: dir });
        this.emit({ kind: 'release', action: dir });
      } else if (this.def.touch.tap && dist < 14 && performance.now() - s.t < 300) {
        const a = this.def.touch.tap;
        this.emit({ kind: 'press', action: a });
        this.emit({ kind: 'release', action: a });
      }
    };
    const cancel = () => (start = null);
    const noMenu = (e: Event) => e.preventDefault();
    c.addEventListener('contextmenu', noMenu);
    this.cleanup.push(() => c.removeEventListener('contextmenu', noMenu));

    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', cancel);
    this.cleanup.push(() => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', cancel);
    });
  }

  /** Wires an on-screen control element to an action. */
  bindButton(el: HTMLElement, action: Action): void {
    const down = (e: PointerEvent) => {
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      el.classList.add('is-active');
      this.press(action);
    };
    const up = (e: PointerEvent) => {
      e.preventDefault();
      el.classList.remove('is-active');
      this.release(action);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.cleanup.push(() => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    });
  }

  destroy(): void {
    this.cleanup.forEach((fn) => fn());
    this.cleanup = [];
    this.held.clear();
  }
}
