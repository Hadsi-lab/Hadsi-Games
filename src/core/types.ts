export type Action = 'up' | 'down' | 'left' | 'right' | 'a' | 'b';

export type GameInput =
  | { kind: 'press' | 'release'; action: Action }
  | {
      kind: 'pointer';
      phase: 'down' | 'move' | 'up';
      x: number;
      y: number;
      /** Mouse button for down/up (0 primary, 1 middle, 2 secondary). */
      button?: number;
      pointerType?: string;
    };

export type SfxName =
  | 'blip' | 'select' | 'eat' | 'hit' | 'bounce' | 'brick' | 'shoot' | 'explode'
  | 'line' | 'powerup' | 'lose' | 'win' | 'levelup' | 'start' | 'pause'
  | 'move' | 'rotate' | 'drop' | 'card' | 'flag' | 'reveal' | 'merge' | 'hop'
  | 'splash' | 'thrust' | 'warp' | 'chomp' | 'power' | 'ghost' | 'tick';

export interface ToneOpts {
  freq: number;
  to?: number;
  duration?: number;
  type?: OscillatorType;
  volume?: number;
  delay?: number;
}

export interface NoiseOpts {
  duration?: number;
  volume?: number;
  filter?: number;
  delay?: number;
}

export interface Sfx {
  play(name: SfxName): void;
  tone(opts: ToneOpts): void;
  noise(opts?: NoiseOpts): void;
}

export interface GameContext {
  /** The mode picked on the start screen, if the game has modes. */
  mode?: string;
  reducedMotion: boolean;
  sfx: Sfx;
  setScore(score: number): void;
  gameOver(score: number, opts?: { won?: boolean }): void;
  isDown(action: Action): boolean;
}

export interface Game {
  init(ctx: GameContext): void;
  update(dt: number): void;
  render(g: CanvasRenderingContext2D): void;
  handleInput(input: GameInput): void;
  destroy(): void;
}

export interface GameMode {
  id: string;
  label: string;
}

export interface TouchLayout {
  /** Swipes on the canvas emit direction presses. */
  swipe?: boolean;
  /** On-screen D-pad. */
  dpad?: boolean;
  /** On-screen action buttons. */
  buttons?: Array<'a' | 'b'>;
  /** Labels for the on-screen buttons. */
  labels?: Partial<Record<'a' | 'b', string>>;
  /** Forward pointer events (logical coordinates) to the game. */
  pointer?: boolean;
  /** A short tap on the canvas presses this action. */
  tap?: Action;
}

export interface GameDef {
  id: string;
  title: string;
  tagline: string;
  /** Neon accent colour for the game screen. */
  color: string;
  width: number;
  height: number;
  controls: { keys: string; touch: string };
  touch: TouchLayout;
  modes?: GameMode[];
  lowerIsBetter?: boolean;
  formatScore?(score: number): string;
  create(): Game;
  /** Stateless lobby animation drawn at w × h (320 × 200). */
  preview(g: CanvasRenderingContext2D, t: number, w: number, h: number): void;
}

export interface UpcomingGame {
  id: string;
  title: string;
  tagline: string;
  color: string;
}

export interface Settings {
  sound: boolean;
  volume: number;
  touchMode: 'swipe' | 'dpad';
  scanlines: boolean;
  reducedMotion: boolean;
}
