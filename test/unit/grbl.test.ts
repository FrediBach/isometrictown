/**
 * The GRBL streamer against a simulated controller over a fake Web Serial port. GRBL drops
 * whatever overflows its 128-byte receive buffer, so the one thing that must never happen is
 * more unanswered bytes on the wire than that.
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Grbl, GrblError, Stopped } from '@/app/grbl';

const RX = 128;

class FakeGrbl {
  /** Bytes sent and not yet answered: what sits in GRBL's receive buffer. */
  pending: number[] = [];
  maxPending = 0;
  lines: string[] = [];
  /** Answer each line with this instead of ok. */
  reply: (line: string) => string[] = () => ['ok'];
  private push!: (s: string) => void;
  private partial = '';
  readable = new ReadableStream<Uint8Array>({ start: (c) => void (this.push = (s) => c.enqueue(new TextEncoder().encode(s))) });
  writable = new WritableStream<Uint8Array>({
    write: (chunk) => {
      for (const ch of new TextDecoder().decode(chunk)) {
        if (ch === '?') {
          this.push('<Idle|MPos:10.000,20.000,0.000|WCO:1.000,2.000,0.000>\r\n');
          continue;
        }
        if (ch === '!' || ch === '~' || ch === '\x18') continue;
        this.partial += ch;
        if (ch !== '\n') continue;
        const line = this.partial.trim();
        this.pending.push(this.partial.length);
        this.maxPending = Math.max(this.maxPending, this.pending.reduce((a, b) => a + b, 0));
        this.partial = '';
        if (!line) {
          this.pending.pop();
          continue;
        }
        this.lines.push(line);
        // Answer a little later, as a real controller would.
        setTimeout(() => {
          this.pending.shift();
          if (line === '$I') this.push('[VER:1.1h.20190825:]\r\nok\r\n');
          else if (line === '$$') this.push('$110=8000.000\r\n$111=8000.000\r\nok\r\n');
          else for (const r of this.reply(line)) this.push(`${r}\r\n`);
        }, 0);
      }
    },
  });
  async open() {}
  async close() {}
  addEventListener() {}
}

let fake: FakeGrbl;
beforeEach(() => {
  fake = new FakeGrbl();
  vi.stubGlobal('navigator', { serial: { requestPort: async () => fake } });
  vi.stubGlobal('window', globalThis);
});
afterEach(() => vi.unstubAllGlobals());

async function connected() {
  const statuses: unknown[] = [];
  const g = new Grbl((s) => statuses.push(s), () => {});
  // The fake has no banner, so connect waits out its 2.5 s grace; skip it.
  vi.useFakeTimers({ toFake: ['setTimeout'], shouldAdvanceTime: true, advanceTimeDelta: 50 });
  const p = g.connect();
  await vi.advanceTimersByTimeAsync(2600);
  await p;
  vi.useRealTimers();
  return { g, statuses };
}

test('connect reads the version and settings', async () => {
  const { g } = await connected();
  expect(g.version).toBe('1.1h.20190825');
  expect(g.settings.get(110)).toBe(8000);
  await g.close();
});

test('streaming never overfills the receive buffer and sends every line in order', async () => {
  const { g } = await connected();
  const lines = Array.from({ length: 2000 }, (_, i) => `G1 X${(i % 400) + 0.123} Y${(i * 7) % 290}.456 F2400`);
  let taken = 0;
  await g.stream(lines, (n) => (taken = n), new AbortController().signal);
  expect(taken).toBe(lines.length);
  expect(fake.lines.slice(-lines.length - 1)).toEqual([...lines, 'G4 P0']);
  expect(fake.maxPending).toBeLessThanOrEqual(RX);
  // It must actually use the buffer, or plots crawl.
  expect(fake.maxPending).toBeGreaterThan(RX / 2);
  await g.close();
});

test('an error answer fails the stream with an explanation', async () => {
  const { g } = await connected();
  fake.reply = (l) => (l.startsWith('G1 X5 ') ? ['error:15'] : ['ok']);
  const lines = Array.from({ length: 20 }, (_, i) => `G1 X${i} Y0`);
  const err = await g.stream(lines, () => {}, new AbortController().signal).catch((e) => e);
  expect(err).toBeInstanceOf(GrblError);
  expect(err.message).toContain('soft limits');
  expect(err.message).toContain('G1 X5 Y0');
  await g.close();
});

test('an aborted stream throws Stopped', async () => {
  const { g } = await connected();
  const ctrl = new AbortController();
  ctrl.abort();
  await expect(g.stream(['G0 X1'], () => {}, ctrl.signal)).rejects.toBeInstanceOf(Stopped);
  await g.close();
});

test('status reports turn machine positions into work positions', async () => {
  const { g, statuses } = await connected();
  await vi.waitFor(() => expect(statuses.length).toBeGreaterThan(0));
  expect(g.status).toEqual({ state: 'Idle', pos: [9, 18, 0] });
  await g.close();
});

test('sending without a port is refused', async () => {
  const g = new Grbl(() => {}, () => {});
  await expect(g.send('G0 X0')).rejects.toThrow('Not connected');
});
