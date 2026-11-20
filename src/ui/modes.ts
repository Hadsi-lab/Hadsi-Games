import type { GameDef } from '../core/types';
import { load, save } from '../core/storage';
import { esc } from './icons';

export function getMode(def: GameDef): string | undefined {
  if (!def.modes?.length) return undefined;
  const saved = load<string | null>(`mode.${def.id}`, null);
  return def.modes.some((m) => m.id === saved) ? saved! : def.modes[0].id;
}

export function setMode(def: GameDef, id: string): void {
  save(`mode.${def.id}`, id);
}

/** Segmented mode picker for the start screen. */
export function renderModePicker(def: GameDef, onChange: (id: string) => void): HTMLElement | null {
  if (!def.modes?.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'gs-modes';
  wrap.setAttribute('role', 'radiogroup');
  wrap.setAttribute('aria-label', 'Mode');
  const draw = () => {
    const current = getMode(def);
    wrap.innerHTML = def.modes!
      .map(
        (m) =>
          `<button type="button" role="radio" aria-checked="${m.id === current}" data-mode="${esc(m.id)}">${esc(m.label)}</button>`,
      )
      .join('');
  };
  wrap.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]');
    if (!btn) return;
    setMode(def, btn.dataset.mode!);
    draw();
    onChange(btn.dataset.mode!);
    wrap.querySelector<HTMLButtonElement>(`[data-mode="${btn.dataset.mode}"]`)?.focus();
  });
  draw();
  return wrap;
}
