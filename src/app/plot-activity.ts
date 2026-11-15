import { useSyncExternalStore } from 'react';

/**
 * What the pen plotter is doing, in a few words, or null when no plotter is connected.
 * The plot dialog sets it and the stats panel's Pen Plot button shows it with a lamp.
 */
let text: string | null = null;
const listeners = new Set<() => void>();

export function setPlotActivity(next: string | null): void {
  if (next === text) return;
  text = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const usePlotActivity = () => useSyncExternalStore(subscribe, () => text);
