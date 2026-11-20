import type { GameDef, UpcomingGame } from '../core/types';
import { brickBash } from './brickbash';

/** Playable games, in lobby order. */
export const games: GameDef[] = [brickBash];

/** Planned games, shown locked in the lobby. Build order matches this list. */
export const upcoming: UpcomingGame[] = [
  { id: 'stackfall', title: 'Stackfall', tagline: 'Stack falling blocks, clear lines.', color: '#00e5ff' },
  { id: 'klondike', title: 'Klondike', tagline: 'Classic patience, draw 1 or 3.', color: '#7cff6b' },
  { id: 'dotmaze', title: 'Dot Maze', tagline: 'Eat the dots, dodge four hunters.', color: '#ffe14d' },
  { id: 'hophome', title: 'Hop Home', tagline: 'Cross the road, ride the river.', color: '#5dff9d' },
  { id: 'starsiege', title: 'Star Siege', tagline: 'Hold the line against the fleet.', color: '#b26bff' },
  { id: 'rocksplitter', title: 'Rock Splitter', tagline: 'Thrust, turn and shatter rocks.', color: '#ff9f43' },
  { id: 'minefield', title: 'Mine Field', tagline: 'Clear the grid without a bang.', color: '#ff5e7e' },
  { id: 'doubles', title: 'Doubles', tagline: 'Slide and merge to 2048.', color: '#ffc04d' },
];
