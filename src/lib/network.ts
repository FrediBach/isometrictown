import { json, LOCAL, META, read, TTL, write } from '../netcache';

/** Limit active work, releasing a slot on success, failure or cancellation. */
export function queue(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(run: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await run();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

/** Keep the timeout active until the response body has also been consumed. */
export async function timed<T>(ms: number, run: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal): Promise<T> {
  const ctrl = new AbortController();
  const abort = () => ctrl.abort(parent?.reason);
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) abort();
  const timer = setTimeout(() => ctrl.abort(new DOMException('Request timed out', 'TimeoutError')), ms);
  try {
    ctrl.signal.throwIfAborted();
    return await run(ctrl.signal);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', abort);
  }
}

type Pause = { until: number; backoff: number };
const BASE = 120000;
const MAX = 1800000;

/** Persist provider failures in Cache Storage, which is available in workers too. */
export class Cooldown {
  private state: Pause = { until: 0, backoff: BASE };
  private readonly key: string;

  constructor(name: string) {
    this.key = `${LOCAL}cooldown/${encodeURIComponent(name)}`;
  }

  async ready(): Promise<boolean> {
    const hit = await read(META, this.key, json<Pause>, TTL.day);
    const value = hit?.value;
    if (hit?.fresh && value && Number.isFinite(value.until) && Number.isFinite(value.backoff) && value.backoff >= BASE && value.backoff <= MAX) {
      this.state = value;
    }
    return Date.now() >= this.state.until;
  }

  async success(): Promise<void> {
    this.state = { until: 0, backoff: BASE };
    await this.save();
  }

  async failure(response?: Response): Promise<void> {
    const retry = response?.headers.get('Retry-After');
    const seconds = retry ? Number(retry) : NaN;
    const retryAt = retry ? (Number.isFinite(seconds) ? Date.now() + Math.max(0, seconds) * 1000 : Date.parse(retry)) : 0;
    this.state = {
      until: Math.max(Date.now() + this.state.backoff, Number.isFinite(retryAt) ? retryAt : 0),
      backoff: Math.min(this.state.backoff * 2, MAX),
    };
    await this.save();
  }

  private async save(): Promise<void> {
    await write(META, this.key, JSON.stringify(this.state), 'application/json');
  }
}
