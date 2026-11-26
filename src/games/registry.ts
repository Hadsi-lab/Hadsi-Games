import type { GameDef, UpcomingGame } from '../core/types';
import { serpentine } from './snake';
import { brickBash } from './brickbash';
import { stackfall } from './stackfall';
import { klondike } from './klondike';
import { dotMaze } from './dotmaze';
import { hopHome } from './hophome';
import { starSiege } from './starsiege';
import { rockSplitter } from './rocksplitter';
import { mineField } from './minefield';
import { doubles } from './doubles';
import { dropFour } from './dropfour';

/** Playable games, in lobby order. */
export const games: GameDef[] = [serpentine, brickBash, stackfall, klondike, dotMaze, hopHome, starSiege, rockSplitter, mineField, doubles, dropFour];

/** Planned games, shown locked in the lobby. Build order matches this list. */
export const upcoming: UpcomingGame[] = [
];
