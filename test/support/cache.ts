import { vi } from 'vitest';

/** A browser cache that survives module reloads within a test. */
export function browserCache() {
  const stores = new Map<string, Map<string, Response>>();
  vi.stubGlobal('caches', {
    open: async (name: string) => {
      let entries = stores.get(name);
      if (!entries) stores.set(name, entries = new Map());
      return {
        match: async (key: string) => entries.get(key)?.clone(),
        put: async (key: string, value: Response) => { entries.set(key, value.clone()); },
        keys: async () => [...entries.keys()],
        delete: async (key: string) => entries.delete(key),
      };
    },
  });
  return stores;
}
