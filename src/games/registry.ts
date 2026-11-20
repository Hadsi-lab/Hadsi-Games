import type { GameDef, UpcomingGame } from '../core/types';
import { brickBash } from './brickbash';
import { stackfall } from './stackfall';
import { klondike } from './klondike';
import { dotMaze } from './dotmaze';

/** Playable games, in lobby order. */
export const games: GameDef[] = [brickBash, stackfall, klondike, dotMaze];

/** Planned games, shown locked in the lobby. Build order matches this list. */
export const upcoming: UpcomingGame[] = [
  { id: 'hophome', title: 'Hop Home', tagline: 'Cross the road, ride the river.', color: '#5dff9d' },
  { id: 'starsiege', title: 'Star Siege', tagline: 'Hold the line against the fleet.', color: '#b26bff' },
  { id: 'rocksplitter', title: 'Rock Splitter', tagline: 'Thrust, turn and shatter rocks.', color: '#ff9f43' },
  { id: 'minefield', title: 'Mine Field', tagline: 'Clear the grid without a bang.', color: '#ff5e7e' },
  { id: 'doubles', title: 'Doubles', tagline: 'Slide and merge to 2048.', color: '#ffc04d' },
];
