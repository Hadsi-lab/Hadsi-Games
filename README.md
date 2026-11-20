# Arcade

A retro arcade in the browser for desktop and mobile. It has a lobby, games that plug in through one shared interface, local top-10 high scores and synthesised sound effects. Built with Vite, TypeScript and HTML5 Canvas, with no game engine and no backend.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build to dist/
```

## Status

| # | Game | Status |
| --- | --- | --- |
| 01 | Serpentine (snake-style) | Not in repo (skipped) |
| 02 | Brick Bash (brick breaker) | Playable |
| 03 | Stackfall (falling blocks) | Playable |
| 04 | Klondike (solitaire) | Planned |
| 05 | Dot Maze (maze chaser) | Planned |
| 06 | Hop Home (road crosser) | Planned |
| 07 | Star Siege (space shooter) | Planned |
| 08 | Rock Splitter (asteroid blaster) | Planned |
| 09 | Mine Field (minesweeper) | Planned |
| 10 | Doubles (2048-style) | Planned |

## Structure

```
src/
  main.ts              hash router (#/ lobby, #/play/<id>), global settings hookup
  modernist.css        vendored Modernist design-system tokens and components
  styles.css           app layer: lobby, settings, retro game screen, CRT effect
  core/
    types.ts           Game, GameDef, GameContext, GameInput, Settings
    loop.ts            requestAnimationFrame loop, delta time clamped to 100 ms
    input.ts           keyboard, swipe, on-screen buttons, pointer -> GameInput
    audio.ts           Web Audio synth with named presets
    storage.ts         namespaced localStorage helpers
    settings.ts        persisted settings with subscribe()
    highscores.ts      top-10 tables
  ui/
    icons.ts           inlined Lucide icons
    lobby.ts           card grid with animated previews
    gameScreen.ts      runner: HUD, canvas scaling, start/pause/game over, initials
    settingsDialog.ts  sound, volume, touch scheme, scanlines, reduced motion
    modes.ts           per-game mode selection
  games/
    registry.ts        list of playable games
    brickbash.ts
    stackfall.ts
```

## Adding a game

1. Create `src/games/<name>.ts`. Implement `Game`:

   ```ts
   interface Game {
     init(ctx: GameContext): void;      // set up state; ctx.mode is the picked mode
     update(dt: number): void;          // dt in seconds; only called while playing
     render(g: CanvasRenderingContext2D): void; // draw in logical units (def.width × def.height)
     handleInput(input: GameInput): void;
     destroy(): void;
   }
   ```

2. Export a `GameDef` with id, title, colour, logical size, control text, touch layout, optional `modes`, a `create()` factory and a `preview()` function for the lobby card.
3. Add it to `games` in `registry.ts` and remove its entry from `upcoming`.

The runner handles everything around the game: the start screen, pause (P / Esc, plus automatic pause when the tab loses focus), game over, initials entry, top-10 display, canvas scaling for high-DPI screens, and touch controls. A game only calls `ctx.setScore(n)` and, at the end, `ctx.gameOver(score, { won })`.

### Input

`GameInput` is one of:

- `{ kind: 'press' | 'release', action }`, where `action` is `up | down | left | right | a | b`
- `{ kind: 'pointer', phase: 'down' | 'move' | 'up', x, y }` in logical canvas units (enable with `touch.pointer`)

| Action | Keys | Touch |
| --- | --- | --- |
| up/down/left/right | Arrows, WASD | swipe or D-pad |
| a | Space, Z | on-screen A, or a tap if `touch.tap = 'a'` |
| b | X, C, Shift | on-screen B |
| pause | P, Esc | HUD pause button |

Key repeat is filtered out. Use `ctx.isDown(action)` for held input. If a game supports both swipe and a D-pad, the player chooses between them in Settings.

### Scores and modes

Each mode in `GameDef.modes` has its own top-10 table. For time-based games, set `lowerIsBetter: true` and `formatScore`. A run then qualifies only when the player wins.

### Sound

Call `ctx.sfx.play('eat' | 'hit' | 'shoot' | 'explode' | 'line' | ...)` for a preset, or `ctx.sfx.tone({...})` / `ctx.sfx.noise(...)` for a custom sound. Audio unlocks on the first user gesture.

## Deploy

`.github/workflows/pages.yml` builds the site and publishes `dist/` to GitHub Pages on every push to `main` (or run it by hand from the Actions tab). In the repo, set Settings → Pages → Source to **GitHub Actions** once. `vite.config.ts` uses a relative `base`, so the build works at `https://<owner>.github.io/<repo>/` (the repo part is case-sensitive: https://hadsi-lab.github.io/Hadsi-Games/).

## Storage

Every key in localStorage is prefixed with `arcade.`:

- `settings.v1`: sound, volume, touchMode, scanlines, reducedMotion
- `scores.<game>[.<mode>]`: top-10 `{ initials, score, date }`
- `mode.<game>`: the last mode picked
- `initials`: the last initials entered

## Accessibility

- Every control is keyboard reachable, with a visible 2px focus ring. Use the arrow keys to move through the lobby grid.
- The Reduced motion setting stops lobby previews, CRT flicker and transitions. It defaults to the OS preference.
- The settings dialog traps focus and closes with Esc.
- Touch targets are at least 44px.
