/** A stable pseudo-random number in [0, 1) for a list of integers. */
export function hash(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const v of values) {
    h = Math.imul(h ^ (v | 0), 0x01000193);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h ^= h >>> 12;
    h = Math.imul(h ^ (h >>> 7), 0x297a2d39);
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
}

/** Smooth variation in [0, 1) across unit cells; use absolute coordinates for map-fixed patches. */
export function patch(x: number, y: number, seed: number, salt: number): number {
  const i = Math.floor(x), j = Math.floor(y);
  const u = x - i, v = y - j;
  const a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v);
  const lo = hash(i, j, seed, salt) * (1 - a) + hash(i + 1, j, seed, salt) * a;
  const hi = hash(i, j + 1, seed, salt) * (1 - a) + hash(i + 1, j + 1, seed, salt) * a;
  return lo * (1 - b) + hi * b;
}

/** A small seeded generator, for sequences. */
export function sequence(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
