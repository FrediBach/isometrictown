import { createContext, use } from 'react';
import type { Settings } from '../settings';

export type Change = <K extends keyof Settings>(key: K, value: Settings[K], fromSlider?: boolean) => void;

/** The current settings and the one function every control uses to change them. */
export const SettingsContext = createContext<{ set: Settings; change: Change } | null>(null);

export function useSettings() {
  const ctx = use(SettingsContext);
  if (!ctx) throw new Error('useSettings needs a SettingsContext provider');
  return ctx;
}
