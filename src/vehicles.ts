import { newSolid, type Build, type Solid } from './buildings';
import { place, slab } from './infra';
import { LINEWORK } from './settings';

/*
 * Working vehicles, drawn like the cars: boxes in linework, and wheels as flat discs where they
 * stand out from the body. Farm machinery, racing cars and karts, fire engines and ambulances.
 * Each takes a position and a heading (ux, uy) and returns one Solid.
 */

type Local = number[][];

/** Whether wheels, wings and other small parts read at this scale; without them a vehicle is its main blocks. */
function fine(B: Build): boolean {
  return B.cam.size(1) >= 1.1;
}

/** Drawing in a frame along ux, uy: a forward, b to the left, z up, all in metres. */
export function local(B: Build, s: Solid, x: number, y: number, ux: number, uy: number) {
  const P = (a: number, b: number, z: number) => [x + ux * a - uy * b, y + uy * a + ux * b, z];
  return {
    P,
    /** A block from a0 to a1 along, b0 to b1 across, z0 to z1 up; returns its footprint. */
    box: (a0: number, a1: number, b0: number, b1: number, z0: number, z1: number) => {
      const ring = place(x, y, ux, uy, [
        [a0, b0],
        [a1, b0],
        [a1, b1],
        [a0, b1],
      ]);
      slab(B, s, ring, z0, z1);
      return ring;
    },
    /** A solid over any footprint. */
    body: (pts: Local, z0: number, z1: number) => {
      const ring = place(x, y, ux, uy, pts);
      slab(B, s, ring, z0, z1);
      return ring;
    },
    /** A flat plate: a wing, a mower bar. */
    plate: (pts: number[][]) => {
      const flat = pts.flatMap(([a, b, z]) => P(a, b, z));
      s.faces.push([flat]);
      s.lines.push({ pen: LINEWORK, pts: flat, closed: true });
    },
    /** A wheel standing upright across b, centred a along, its rim touching the ground. */
    wheel: (a: number, b: number, r: number) => {
      const flat: number[] = [];
      for (let q = 0; q < 10; q++) {
        const t = (q / 10) * Math.PI * 2;
        flat.push(...P(a + Math.cos(t) * r, b, r + Math.sin(t) * r));
      }
      s.faces.push([flat]);
      s.lines.push({ pen: LINEWORK, pts: flat, closed: true });
    },
    line: (...pts: number[][]) =>
      s.lines.push({
        pen: LINEWORK,
        pts: pts.flatMap(([a, b, z]) => P(a, b, z)),
      }),
  };
}

// ---------------------------------------------------------------- Farm machinery

/** What a tractor is pulling. */
export type Implement = 'plough' | 'trailer' | 'baler' | 'mower' | 'none';

/** A tractor with big rear wheels, a cab and a bonnet, and what it pulls behind. Its length is about 4 m, more with the implement. */
export function tractor(B: Build, x: number, y: number, ux: number, uy: number, tool: Implement): Solid {
  const s = newSolid();
  const T = local(B, s, x, y, ux, uy);
  const small = fine(B);
  const cab = T.box(-1.3, 0.2, -0.6, 0.6, small ? 0.95 : 0, 2.8);
  T.box(0.2, 2.0, -0.42, 0.42, small ? 0.7 : 0, 1.45);
  if (small) {
    T.line([1.1, 0.25, 1.45], [1.1, 0.25, 2.4]);
    for (const b of [-1, 1]) {
      T.wheel(-0.85, b * 0.98, 0.8);
      T.wheel(1.45, b * 0.82, 0.46);
    }
  }
  s.casts.push({ ring: cab, h: 2.8 });
  if (tool === 'plough' && !small) {
    T.line([-1.4, 0, 0.6], [-5.2, -1.4, 0.6]);
  } else if (tool === 'plough') {
    // A beam set at a slant, with a row of shares under it.
    T.line([-1.4, 0, 0.6], [-2.2, 0, 0.6], [-5.2, -1.4, 0.6]);
    for (let i = 0; i < 4; i++) {
      const a = -2.6 - i * 0.75;
      const b = -0.35 * i - 0.1;
      T.body(
        [
          [a, b - 0.15],
          [a + 0.6, b - 0.15],
          [a + 0.3, b + 0.35],
          [a - 0.3, b + 0.35],
        ],
        0,
        0.45,
      );
      T.line([a + 0.15, b, 0.45], [a + 0.15, b, 0.6]);
    }
  } else if (tool === 'trailer') {
    T.line([-1.4, 0, 0.7], [-2.3, 0, 0.7]);
    const box = T.box(-7.3, -2.3, -1.15, 1.15, small ? 1.0 : 0, 2.3);
    if (small)
      for (const b of [-1, 1]) {
        T.wheel(-5.2, b * 1.2, 0.5);
        T.wheel(-4.0, b * 1.2, 0.5);
      }
    s.casts.push({ ring: box, h: 2.3 });
  } else if (tool === 'baler') {
    T.line([-1.4, 0, 0.6], [-2.4, 0.3, 0.6]);
    const box = T.box(-4.8, -2.4, -0.9, 1.5, small ? 0.45 : 0, 2.1);
    if (small) {
      T.wheel(-3.6, -0.95, 0.42);
      T.wheel(-3.6, 1.55, 0.42);
    }
    s.casts.push({ ring: box, h: 2.1 });
  } else if (tool === 'mower') {
    // A cutter bar out to the side and one at the back, low over the grass.
    T.plate([
      [-0.6, -1.0, 0.25],
      [0.4, -1.0, 0.25],
      [0.4, -3.6, 0.25],
      [-0.6, -3.6, 0.25],
    ]);
    T.box(-2.2, -1.4, -1.5, 1.5, 0.15, 0.7);
  }
  return s;
}

/** A combine harvester with its header down, about 9 m long and 7 m across the header. */
export function combine(B: Build, x: number, y: number, ux: number, uy: number, unloading: boolean): Solid {
  const s = newSolid();
  const T = local(B, s, x, y, ux, uy);
  const small = fine(B);
  T.box(3.2, 4.4, -3.5, 3.5, 0.2, 1.1);
  T.box(1.9, 3.2, -0.7, 0.7, 0.6, 1.6);
  const body = T.box(-3.6, 1.9, -1.4, 1.4, small ? 0.9 : 0, 3.4);
  T.box(0.7, 1.9, -0.95, 0.95, 3.4, 4.3);
  T.box(-1.6, 0.5, -1.25, 1.25, 3.4, 4.0);
  if (small) {
    // The reel over the header.
    T.line([4.1, -3.4, 1.6], [4.1, 3.4, 1.6]);
    T.line([3.4, -3.4, 1.1], [4.1, -3.4, 1.6]);
    T.line([3.4, 3.4, 1.1], [4.1, 3.4, 1.6]);
    for (const b of [-1, 1]) {
      T.wheel(0.9, b * 1.6, 0.85);
      T.wheel(-2.8, b * 1.45, 0.55);
    }
  }
  // The unloading auger, swung out over a trailer or folded along the side.
  if (unloading) T.line([-0.6, 1.25, 3.7], [-0.4, 5.6, 4.0]);
  else T.line([-0.8, 1.45, 3.6], [2.6, 1.5, 3.6]);
  s.casts.push({ ring: body, h: 4.0 });
  return s;
}

// ---------------------------------------------------------------- Racing

export type Racer = 'formula' | 'gt' | 'kart';

/** Length of a racing car, nose to tail. */
export function racerLength(kind: Racer): number {
  return kind === 'formula' ? 5.5 : kind === 'gt' ? 4.7 : 1.9;
}

/** A racing car: an open-wheeled single-seater with wings, a low GT car with a rear wing, or a kart. */
export function racer(B: Build, x: number, y: number, ux: number, uy: number, kind: Racer): Solid {
  const s = newSolid();
  const T = local(B, s, x, y, ux, uy);
  if (kind === 'formula' && !fine(B)) {
    // Too small for wings and wheels: a low wedge with the cockpit on it.
    const body = T.body(
      [
        [-2.7, -0.85],
        [1.2, -0.7],
        [2.7, -0.2],
        [2.7, 0.2],
        [1.2, 0.7],
        [-2.7, 0.85],
      ],
      0,
      0.6,
    );
    T.box(-1.0, -0.2, -0.3, 0.3, 0.6, 0.95);
    s.casts.push({ ring: body, h: 0.7 });
  } else if (kind === 'formula') {
    const nose = T.body(
      [
        [-2.3, -0.45],
        [1.6, -0.3],
        [2.55, -0.12],
        [2.55, 0.12],
        [1.6, 0.3],
        [-2.3, 0.45],
      ],
      0.15,
      0.6,
    );
    T.box(-1.6, 0.4, -0.8, 0.8, 0.15, 0.55);
    T.box(-0.9, -0.2, -0.3, 0.3, 0.6, 0.95);
    T.plate([
      [2.3, -0.95, 0.12],
      [2.75, -0.95, 0.12],
      [2.75, 0.95, 0.12],
      [2.3, 0.95, 0.12],
    ]);
    T.plate([
      [-2.75, -0.5, 0.95],
      [-2.3, -0.5, 0.95],
      [-2.3, 0.5, 0.95],
      [-2.75, 0.5, 0.95],
    ]);
    T.line([-2.5, 0, 0.6], [-2.5, 0, 0.95]);
    for (const b of [-1, 1]) {
      T.wheel(1.65, b * 0.82, 0.34);
      T.wheel(-1.95, b * 0.82, 0.36);
    }
    s.casts.push({ ring: nose, h: 0.7 });
  } else if (kind === 'gt') {
    const body = T.box(-2.35, 2.35, -0.98, 0.98, 0.12, 0.85);
    T.box(-0.9, 0.6, -0.7, 0.7, 0.85, 1.2);
    if (fine(B)) {
      T.plate([
        [-2.35, -0.9, 1.25],
        [-1.95, -0.9, 1.25],
        [-1.95, 0.9, 1.25],
        [-2.35, 0.9, 1.25],
      ]);
      T.line([-2.15, -0.6, 0.85], [-2.15, -0.6, 1.25]);
      T.line([-2.15, 0.6, 0.85], [-2.15, 0.6, 1.25]);
    }
    s.casts.push({ ring: body, h: 1.1 });
  } else {
    const deck = T.box(-0.95, 0.95, -0.6, 0.6, 0.1, 0.25);
    T.box(-0.55, -0.05, -0.25, 0.25, 0.25, 1.0);
    s.casts.push({ ring: deck, h: 0.8 });
  }
  return s;
}

// ---------------------------------------------------------------- Emergency

/** A fire engine (9 m, a ladder on the roof) or an ambulance (6 m), parked. */
export function emergency(B: Build, x: number, y: number, ux: number, uy: number, fire: boolean): Solid {
  const s = newSolid();
  const T = local(B, s, x, y, ux, uy);
  // The ladder's rails and the light bars only read from about 1:2000; the rungs from 1:900.
  const roof = B.cam.size(1) >= 0.5;
  if (fire) {
    T.box(2.9, 4.5, -1.25, 1.25, 0, 3.0);
    const body = T.box(-4.5, 2.9, -1.25, 1.25, 0, 3.1);
    if (roof) {
      T.box(3.5, 4.1, -0.7, 0.7, 3.0, 3.25);
      T.line([-4.4, -0.45, 3.45], [3.9, -0.45, 3.45]);
      T.line([-4.4, 0.45, 3.45], [3.9, 0.45, 3.45]);
    }
    if (fine(B)) for (let a = -4.0; a < 3.8; a += 0.7) T.line([a, -0.45, 3.45], [a, 0.45, 3.45]);
    s.casts.push({ ring: body, h: 3.3 });
  } else {
    T.box(2.3, 3.0, -1.0, 1.0, 0, 1.1);
    T.box(1.4, 2.3, -1.0, 1.0, 0, 2.1);
    const body = T.box(-3.0, 1.4, -1.1, 1.1, 0, 2.7);
    if (roof) T.box(1.6, 2.1, -0.6, 0.6, 2.1, 2.3);
    s.casts.push({ ring: body, h: 2.7 });
  }
  return s;
}
