import { load, save } from './storage';

export interface ScoreEntry {
  initials: string;
  score: number;
  date: string;
}

const MAX = 10;

function key(gameId: string, mode?: string) {
  return `scores.${gameId}${mode ? '.' + mode : ''}`;
}

export function getScores(gameId: string, mode?: string): ScoreEntry[] {
  return load<ScoreEntry[]>(key(gameId, mode), []);
}

export function qualifies(
  gameId: string,
  mode: string | undefined,
  score: number,
  lowerIsBetter = false,
): boolean {
  if (score <= 0) return false;
  const list = getScores(gameId, mode);
  if (list.length < MAX) return true;
  const worst = list[list.length - 1].score;
  return lowerIsBetter ? score < worst : score > worst;
}

/** Inserts a score and returns its 0-based rank. */
export function addScore(
  gameId: string,
  mode: string | undefined,
  entry: ScoreEntry,
  lowerIsBetter = false,
): number {
  const list = getScores(gameId, mode);
  list.push(entry);
  list.sort((a, b) => (lowerIsBetter ? a.score - b.score : b.score - a.score));
  const trimmed = list.slice(0, MAX);
  save(key(gameId, mode), trimmed);
  return trimmed.indexOf(entry);
}

export function bestScore(gameId: string, mode?: string): number | null {
  const list = getScores(gameId, mode);
  return list.length ? list[0].score : null;
}
