import type { Settings } from './types';
import { load, save } from './storage';

const KEY = 'settings.v1';
const prefersReduced =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const defaults: Settings = {
  sound: true,
  volume: 0.6,
  touchMode: 'swipe',
  scanlines: true,
  reducedMotion: prefersReduced,
};

let current: Settings = { ...defaults, ...load<Partial<Settings>>(KEY, {}) };
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  save(KEY, current);
  listeners.forEach((fn) => fn(current));
}

export function subscribe(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
