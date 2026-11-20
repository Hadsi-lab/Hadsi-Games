# CLAUDE.md: Arcade

Context for Claude Code. Read README.md first; it documents the architecture and the `Game` / `GameDef` interfaces.

## Commands
- `npm install`
- `npm run dev`: dev server
- `npm run build`: runs `tsc` and then `vite build`. It must pass with zero errors before a game counts as done.

## State
- Done: the lobby, the runner (`ui/gameScreen.ts`), input, audio, high scores, settings, Brick Bash, Stackfall, Klondike and Dot Maze. The framework was rebuilt from the README spec because the original `src/` was never committed.
- Serpentine (`games/snake.ts`) was never committed and is skipped for now.
- Next: the games in `games/registry.ts` → `upcoming`, built in this order: Hop Home, Star Siege, Rock Splitter, Mine Field, Doubles.
- After all of them: a polish pass covering transitions, mobile layout checks and an accessibility audit.
- Deploy: `.github/workflows/pages.yml` builds and publishes `dist/` to GitHub Pages on every push to `main`.

## Rules for every new game
- Create one file, `src/games/<id>.ts`, that exports a `GameDef`. Add it to `games` and remove its entry from `upcoming`.
- Implement `init / update(dt) / render / handleInput / destroy`. Make all motion frame-rate independent (scale by `dt`, or use a fixed-step accumulator; brickbash.ts sub-steps ball movement).
- Draw only on the canvas, in logical units (`def.width × def.height`). Never touch the DOM. The runner owns the start, pause, game over and initials screens.
- Call `ctx.setScore` as the score changes. Call `ctx.gameOver(score, { won })` once at the end.
- Write a `preview(g, t, w, h)` lobby animation at 320×200 that's cheap to draw and has no state.
- Respect `ctx.reducedMotion`: no screen shake, flashing or particle bursts when it's on.
- Use `ctx.sfx.play(...)` presets, adding new ones to `core/audio.ts` if needed. Never use audio files.
- Every game needs keyboard controls (arrows/WASD plus Space or X) and touch controls: swipe and/or `dpad`, `buttons`, or `pointer`.
- Use original names and artwork only. No trademarked names, characters or sprites.

## Per-game notes
- Brick Bash: several levels, power-ups (wide paddle, multi-ball, slow ball). Touch: `pointer` drags the paddle, tap launches.
- Stackfall: 7-bag randomiser, ghost piece, hold (b), next preview, line-clear scoring by level, DAS/ARR key repeat handled inside the game (input filters OS repeat).
- Klondike: `pointer` drag and drop, undo stack, auto-complete once all cards are face up, draw 1 / draw 3 as `modes`, time-based score (`lowerIsBetter`, `formatScore` → m:ss), a separate table per mode.
- Dot Maze: 4 hunters, each with its own targeting (direct chase, ambush ahead, flank, wander when close), power pellets, scatter/chase timer.
- Hop Home: lanes of traffic, river logs and turtles, 5 home dens, a timer.
- Star Siege: a descending formation, destructible shields, an occasional bonus ship.
- Rock Splitter: rotate, thrust and fire. Rocks split large → medium → small, the screen wraps, and there's a hyperspace jump on b.
- Mine Field: Beginner / Intermediate / Expert `modes`, a safe first click, chording, long-press to flag on touch, time-based score per mode.
- Doubles: swipe or arrows, merge animation (skipped when reduced motion is on), a keep-playing prompt after 2048.

## Style
- The lobby and settings use the Modernist system (`src/modernist.css`): Archivo, #f3f2f2 / #201e1d / #ec3013, 0 radius, 2px rules, flush-left labels, Lucide icons.
- Game screens use the retro cabinet in `styles.css` (`.game-screen`): dark ground, Press Start 2P, a neon `--game` colour per game.
- Don't edit `modernist.css`. Put overrides in `styles.css`.

## Workflow
Build one game at a time. After each one: run `npm run build`, play it on desktop and in mobile emulation, check that pause, game over and initials work, and that the score appears in the lobby. Then commit.
