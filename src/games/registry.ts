import type { GameDef, UpcomingGame } from '../core/types';
import { brickBash } from './brickbash';
import { stackfall } from './stackfall';
import { klondike } from './klondike';
import { dotMaze } from './dotmaze';
import { hopHome } from './hophome';
import { starSiege } from './starsiege';
import { rockSplitter } from './rocksplitter';

/** Playable games, in lobby order. */
export const games: GameDef[] = [brickBash, stackfall, klondike, dotMaze, hopHome, starSiege, rockSplitter];

/** Planned games, shown locked in the lobby. Build order matches this list. */
export const upcoming: UpcomingGame[] = [
  { id: 'minefield', title: 'Mine Field', tagline: 'Clear the grid without a bang.', color: '#ff5e7e' },
  { id: 'doubles', title: 'Doubles', tagline: 'Slide and merge to 2048.', color: '#ffc04d' },
];
