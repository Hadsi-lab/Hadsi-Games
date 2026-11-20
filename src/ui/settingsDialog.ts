import { getSettings, updateSettings } from '../core/settings';
import { sfx } from '../core/audio';
import { icon } from './icons';

let open: HTMLElement | null = null;

export function openSettings(onClose?: () => void): void {
  if (open) return;
  const returnFocus = document.activeElement as HTMLElement | null;
  const s = getSettings();
  const backdrop = document.createElement('div');
  backdrop.className = 'mn-backdrop';
  backdrop.innerHTML = `
    <div class="mn-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header class="mn-dialog__head">
        <h2 id="settings-title" class="mn-h2">Settings</h2>
        <button type="button" class="mn-icon-btn" data-close aria-label="Close settings">${icon('x')}</button>
      </header>
      <div class="mn-field-list">
        <label class="mn-field">
          <span class="mn-label">Sound</span>
          <input type="checkbox" class="mn-switch" name="sound" ${s.sound ? 'checked' : ''} />
        </label>
        <label class="mn-field">
          <span class="mn-label">Volume</span>
          <input type="range" class="mn-range" name="volume" min="0" max="1" step="0.05" value="${s.volume}" />
        </label>
        <fieldset class="mn-field">
          <legend class="mn-label">Touch controls</legend>
          <div class="mn-segmented">
            <label><input type="radio" name="touchMode" value="swipe" ${s.touchMode === 'swipe' ? 'checked' : ''} /><span>Swipe</span></label>
            <label><input type="radio" name="touchMode" value="dpad" ${s.touchMode === 'dpad' ? 'checked' : ''} /><span>D-pad</span></label>
          </div>
        </fieldset>
        <label class="mn-field">
          <span class="mn-label">CRT scanlines</span>
          <input type="checkbox" class="mn-switch" name="scanlines" ${s.scanlines ? 'checked' : ''} />
        </label>
        <label class="mn-field">
          <span class="mn-label">Reduced motion</span>
          <input type="checkbox" class="mn-switch" name="reducedMotion" ${s.reducedMotion ? 'checked' : ''} />
        </label>
      </div>
      <footer class="mn-dialog__foot">
        <button type="button" class="mn-btn mn-btn--primary" data-close>Done</button>
      </footer>
    </div>`;
  document.body.appendChild(backdrop);
  open = backdrop;
  const dialog = backdrop.querySelector<HTMLElement>('.mn-dialog')!;

  dialog.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'sound' || t.name === 'scanlines' || t.name === 'reducedMotion') {
      updateSettings({ [t.name]: t.checked });
      if (t.name === 'sound' && t.checked) sfx.play('select');
    } else if (t.name === 'touchMode') {
      updateSettings({ touchMode: t.value as 'swipe' | 'dpad' });
    } else if (t.name === 'volume') {
      sfx.play('blip');
    }
  });
  dialog.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'volume') updateSettings({ volume: Number(t.value) });
  });

  const focusables = () =>
    [...dialog.querySelectorAll<HTMLElement>('button, input')].filter((el) => !el.hasAttribute('disabled'));

  const close = () => {
    dialog.removeEventListener('keydown', onKey);
    backdrop.remove();
    open = null;
    returnFocus?.focus?.();
    onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      const list = focusables();
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  dialog.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || (e.target as HTMLElement).closest('[data-close]')) close();
  });
  focusables()[0]?.focus();
}

export function settingsOpen(): boolean {
  return open != null;
}
