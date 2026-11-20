import { mountLobby } from './ui/lobby';
import { mountGameScreen } from './ui/gameScreen';
import { games } from './games/registry';
import { getSettings, subscribe } from './core/settings';

const app = document.getElementById('app')!;
let unmount: (() => void) | null = null;
let lastGame: string | null = null;

function applyGlobalSettings() {
  const s = getSettings();
  document.documentElement.classList.toggle('reduced-motion', s.reducedMotion);
}
subscribe(applyGlobalSettings);
applyGlobalSettings();

function route() {
  unmount?.();
  unmount = null;
  const m = location.hash.match(/^#\/play\/([\w-]+)/);
  const def = m && games.find((g) => g.id === m[1]);
  if (def) {
    lastGame = def.id;
    document.title = `${def.title} · Arcade`;
    document.documentElement.classList.add('in-game');
    unmount = mountGameScreen(app, def, () => (location.hash = '#/'));
  } else {
    if (location.hash && location.hash !== '#/') history.replaceState(null, '', '#/');
    document.title = 'Arcade';
    document.documentElement.classList.remove('in-game');
    unmount = mountLobby(app);
    if (lastGame) app.querySelector<HTMLElement>(`a[href="#/play/${lastGame}"]`)?.focus();
  }
}

window.addEventListener('hashchange', route);
route();
