/** The steps a drawing goes through, in order, as reported by the worker. */
export const STAGES = ['map', 'ground', 'buildings', 'life', 'light', 'lines', 'plan'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  map: 'Preparing the map',
  ground: 'Laying out the ground',
  buildings: 'Raising buildings',
  life: 'Planting trees, parking cars',
  light: 'Working out light and shade',
  lines: 'Inking the lines',
  plan: 'Planning the pen path',
};

/** Progress inside a step: a count, and an optional note on what is happening. */
export type StageProgress = { stage: Stage; done?: number; total?: number; note?: string };
