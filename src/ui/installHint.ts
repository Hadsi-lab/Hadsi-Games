import { icon } from './icons';

/** Explains Share → Add to Home Screen for iPhone and iPad, where browsers can't prompt. */
export function showIosInstallHint(): void {
  const returnFocus = document.activeElement as HTMLElement | null;
  const backdrop = document.createElement('div');
  backdrop.className = 'mn-backdrop';
  backdrop.innerHTML = `
    <div class="mn-dialog" role="dialog" aria-modal="true" aria-labelledby="install-title">
      <header class="mn-dialog__head">
        <h2 id="install-title" class="mn-h2">Install Arcade</h2>
        <button type="button" class="mn-icon-btn" data-close aria-label="Close">${icon('x')}</button>
      </header>
      <ol class="install-steps">
        <li>Tap the <b>Share</b> button in Safari's toolbar ${icon('share', 18)}</li>
        <li>Scroll down and choose <b>Add to Home Screen</b></li>
        <li>Tap <b>Add</b>. Arcade opens full screen from its joystick icon, and works offline.</li>
      </ol>
      <footer class="mn-dialog__foot">
        <button type="button" class="mn-btn mn-btn--primary" data-close>Got it</button>
      </footer>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    returnFocus?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || (e.target as HTMLElement).closest('[data-close]')) close();
  });
  backdrop.querySelector<HTMLElement>('.mn-btn')?.focus();
}
