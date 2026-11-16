import { hash } from './rng';

/** Loosen a visible stroke in sheet millimetres, keeping the same array for the catalogue. */
export function humanize(line: number[], amount: number, key: number[], seed: number, bounds: readonly number[]): void {
  if (!(amount > 0) || line.length < 4) return;
  const strength = Math.min(1, amount);
  const pts = [line[0], line[1]];
  const distances = [0];
  let total = 0;
  for (let i = 2; i < line.length; i += 2) {
    const d = Math.hypot(line[i] - pts[pts.length - 2], line[i + 1] - pts[pts.length - 1]);
    if (d < 1e-8) continue;
    total += d;
    pts.push(line[i], line[i + 1]);
    distances.push(total);
  }
  if (!total) return;
  const random = (salt: number, cell = 0) => hash(...key, seed, salt, cell) * 2 - 1;
  // Small marks need smaller errors; long strokes can wander by about half a millimetre.
  const amplitude = strength * Math.min(0.45, total * 0.09);
  const reach = strength * Math.min(0.8, total * 0.18);
  const start = random(9720) * reach;
  const end = total + random(9721) * reach;
  const phase = random(9722) * Math.PI;
  const bend = random(9723);
  const driftX = random(9724), driftY = random(9725);
  const noise = (s: number, salt: number) => {
    const cell = Math.floor(s), t = s - cell;
    const u = t * t * (3 - 2 * t);
    return random(salt, cell) * (1 - u) + random(salt, cell + 1) * u;
  };
  const samples = [start];
  // Retain corners, and sample by distance rather than by the renderer's vertex density.
  for (const d of distances) if (d > start && d < end) samples.push(d);
  for (let d = start + 0.6; d < end; d += 0.6) samples.push(d);
  samples.push(end);
  samples.sort((a, b) => a - b);
  const out: number[] = [];
  let segment = 0;
  for (const d of samples) {
    while (segment < distances.length - 2 && distances[segment + 1] < d) segment++;
    const i = segment * 2;
    const length = distances[segment + 1] - distances[segment];
    const t = (d - distances[segment]) / length;
    const x = pts[i] + (pts[i + 2] - pts[i]) * t;
    const y = pts[i + 1] + (pts[i + 3] - pts[i + 1]) * t;
    const bow = Math.sin(Math.PI * d / total) * bend;
    const wobble = Math.sin(d * 1.7 + phase) * 0.18;
    const dx = amplitude * (driftX * 0.35 + bow * driftY + noise(d / 3, 9730) * 0.5 + wobble);
    const dy = amplitude * (driftY * 0.35 - bow * driftX + noise(d / 3, 9731) * 0.5 - wobble);
    out.push(Math.max(bounds[0], Math.min(bounds[2], x + dx)), Math.max(bounds[1], Math.min(bounds[3], y + dy)));
  }
  line.length = out.length;
  for (let i = 0; i < out.length; i++) line[i] = out[i];
}
