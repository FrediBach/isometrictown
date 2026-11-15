/**
 * A GRBL 1.1 controller over Web Serial, for the UUNA TEK 3.0 and other GRBL pen plotters.
 *
 * Lines are streamed with GRBL's character-counting protocol: as many lines as fit in its
 * 128-byte receive buffer are in flight at once, so the planner never runs dry between
 * short strokes. Real-time bytes (status, hold, resume, reset) skip the queue.
 */

// Web Serial is not in TypeScript's DOM library yet; this is the part of it used here.
type SerialPortLike = {
  open(o: { baudRate: number; bufferSize?: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  addEventListener(type: 'disconnect', cb: () => void): void;
};
type SerialLike = { requestPort(o?: object): Promise<SerialPortLike> };

/** Whether this browser can talk to a plotter directly (Chrome or Edge on a desktop). */
export const hasSerial = () => typeof navigator !== 'undefined' && 'serial' in navigator;

export const BAUD = 115200;
const RX_BUFFER = 127;
const RT_STATUS = '?';
const RT_HOLD = '!';
const RT_RESUME = '~';
const RT_RESET = '\x18';

/** What the machine last reported. `pos` is the work position in mm. */
export type MachineStatus = { state: string; pos: [number, number, number] | null };

/** A GRBL `error:` or `ALARM:` answer, with a plain explanation where one is known. */
export class GrblError extends Error {
  constructor(
    readonly code: string,
    readonly line: string,
  ) {
    super(explain(code, line));
  }
}

/** Raised in a stream when the plot was stopped on purpose. */
export class Stopped extends Error {
  constructor() {
    super('Stopped');
  }
}

const HINTS: Record<string, string> = {
  'error:2': 'a G-code word has no number',
  'error:9': 'the machine is locked by an alarm; unlock it first',
  'error:15': 'the move goes past the soft limits',
  'error:20': 'unsupported G-code command',
  'error:22': 'no feed rate set',
  'ALARM:1': 'a limit switch was hit; check the paper fits the bed',
  'ALARM:2': 'the move goes past the soft limits; the drawing is larger than the plot area',
  'ALARM:3': 'reset while moving, so the position may be lost',
};

function explain(code: string, line: string): string {
  const hint = HINTS[code];
  return `The plotter answered ${code}${hint ? ` (${hint})` : ''}${line ? ` to “${line}”` : ''}.`;
}

type Sent = { len: number; line: string; info: string[]; resolve: (info: string[]) => void; reject: (e: Error) => void };

export class Grbl {
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private out: Promise<void> = Promise.resolve();
  private text = '';
  private inFlight: Sent[] = [];
  private queue: Sent[] = [];
  private bytes = 0;
  private poll = 0;
  private wco: [number, number, number] = [0, 0, 0];
  private wcoSeen = false;
  private onBanner: (() => void) | null = null;
  private encoder = new TextEncoder();
  status: MachineStatus = { state: 'Unknown', pos: null };
  /** GRBL settings read on connect ($$), by number. */
  settings = new Map<number, number>();
  version = '';

  constructor(
    private onStatus: (s: MachineStatus) => void,
    private onClose: () => void,
  ) {}

  get connected(): boolean {
    return !!this.port;
  }

  /** Ask for a port, open it at 115200 baud and wake GRBL. Rejects if the user picks nothing. */
  async connect(): Promise<void> {
    const port = await (navigator as unknown as { serial: SerialLike }).serial.requestPort();
    await port.open({ baudRate: BAUD, bufferSize: 4096 });
    this.port = port;
    port.addEventListener('disconnect', () => void this.close());
    this.writer = port.writable!.getWriter();
    this.reader = port.readable!.getReader();
    void this.readLoop(this.reader);
    // Many boards reset when the port opens and greet with a banner; others stay silent.
    const banner = new Promise<void>((resolve) => {
      this.onBanner = resolve;
    });
    this.raw('\r\n\r\n');
    await Promise.race([banner, wait(2500)]);
    this.onBanner = null;
    try {
      const info = await withTimeout(this.send('$I'), 4000, 'The plotter did not answer. Is it switched on, and is this the right port?');
      const ver = info.map((l) => /^\[VER:([^:\]]+)/.exec(l)?.[1]).find(Boolean);
      if (ver) this.version = ver;
      for (const l of await withTimeout(this.send('$$'), 4000, 'The plotter did not list its settings.')) {
        const m = /^\$(\d+)=(-?[\d.]+)/.exec(l);
        if (m) this.settings.set(Number(m[1]), Number(m[2]));
      }
    } catch (e) {
      await this.close();
      throw e;
    }
    this.poll = window.setInterval(() => this.raw(RT_STATUS), 250);
    this.raw(RT_STATUS);
  }

  async close(): Promise<void> {
    if (!this.port) return;
    clearInterval(this.poll);
    const port = this.port;
    this.port = null;
    this.fail(new Error('The plotter was disconnected.'));
    try {
      await this.reader?.cancel();
    } catch {
      /* already gone */
    }
    try {
      this.writer?.releaseLock();
      await port.close();
    } catch {
      /* unplugged */
    }
    this.reader = null;
    this.writer = null;
    this.status = { state: 'Unknown', pos: null };
    this.onClose();
  }

  /** Send one line and resolve with any lines GRBL printed before its `ok`. */
  send(line: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      if (!this.port) return reject(new Error('Not connected to a plotter.'));
      const text = line.trim();
      this.queue.push({ len: text.length + 1, line: text, info: [], resolve, reject });
      this.pump();
    });
  }

  /** Send several lines in order and wait for all of them. */
  async run(lines: string[]): Promise<void> {
    await Promise.all(lines.map((l) => this.send(l)));
  }

  /**
   * Stream many lines, keeping GRBL's buffer full, and wait until the machine has stopped
   * moving. `done` is told how many lines GRBL has taken; aborting the signal throws `Stopped`.
   */
  async stream(lines: string[], done: (n: number) => void, signal: AbortSignal): Promise<void> {
    let failed: Error | null = null;
    let taken = 0;
    const window: Promise<void>[] = [];
    const take = (p: Promise<string[]>) =>
      p.then(
        () => void done(++taken),
        (e: Error) => void (failed ??= e),
      );
    for (const line of lines) {
      if (signal.aborted) throw new Stopped();
      if (failed) throw failed;
      window.push(take(this.send(line)));
      // Keep a bounded number of promises; GRBL's own buffer is the real limit.
      if (window.length >= 48) await window.shift();
    }
    await Promise.all(window);
    if (failed) throw signal.aborted ? new Stopped() : failed;
    // G4 P0 answers only once every queued move has finished.
    await this.send('G4 P0').catch((e: Error) => {
      throw signal.aborted ? new Stopped() : e;
    });
  }

  hold(): void {
    this.raw(RT_HOLD);
  }

  resume(): void {
    this.raw(RT_RESUME);
  }

  /** Jog by a distance in mm, relative to where the pen is. */
  jog(dx: number, dy: number, feed = 3000): Promise<string[]> {
    return this.send(`$J=G91 G21 X${dx.toFixed(2)} Y${dy.toFixed(2)} F${feed}`);
  }

  /** Clear an alarm. */
  unlock(): Promise<string[]> {
    return this.send('$X');
  }

  /**
   * Bring a running plot to a halt without losing the position: hold until the carriage has
   * stopped, then reset GRBL to drop the rest of the job, lift the pen and go back to the origin.
   */
  async stop(liftPen: string): Promise<void> {
    this.hold();
    for (let i = 0; i < 60; i++) {
      await wait(100);
      if (/^(Hold:0|Idle|Alarm)/.test(this.status.state)) break;
    }
    const offset = this.wcoSeen ? ([...this.wco] as [number, number, number]) : null;
    const banner = new Promise<void>((resolve) => {
      this.onBanner = resolve;
    });
    this.raw(RT_RESET);
    this.fail(new Stopped());
    await Promise.race([banner, wait(1500)]);
    this.onBanner = null;
    await this.unlock().catch(() => []);
    await this.run(['G21', 'G90', liftPen]);
    // A reset may drop the G92 origin, so go to it in machine coordinates and set it again.
    if (offset) await this.run([`G53 G0 X${offset[0]} Y${offset[1]}`, 'G92 X0 Y0']);
    else await this.run(['G0 X0 Y0']);
    await this.send('G4 P0');
  }

  private raw(text: string): void {
    if (!this.writer) return;
    const bytes = this.encoder.encode(text);
    const w = this.writer;
    this.out = this.out.then(() => w.write(bytes)).catch(() => undefined);
  }

  private pump(): void {
    while (this.queue.length) {
      const next = this.queue[0];
      if (this.inFlight.length && this.bytes + next.len > RX_BUFFER) break;
      this.queue.shift();
      this.inFlight.push(next);
      this.bytes += next.len;
      this.raw(`${next.line}\n`);
    }
  }

  /** Reject everything waiting, after a reset, an alarm or a lost port. */
  private fail(e: Error): void {
    const all = [...this.inFlight, ...this.queue];
    this.inFlight = [];
    this.queue = [];
    this.bytes = 0;
    for (const s of all) s.reject(e);
  }

  private async readLoop(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        this.text += decoder.decode(value, { stream: true });
        let nl = this.text.indexOf('\n');
        while (nl >= 0) {
          const line = this.text.slice(0, nl).trim();
          this.text = this.text.slice(nl + 1);
          if (line) this.onLine(line);
          nl = this.text.indexOf('\n');
        }
      }
    } catch {
      /* port closed or unplugged */
    }
    if (this.port) void this.close();
  }

  private onLine(line: string): void {
    if (line === 'ok') {
      const s = this.inFlight.shift();
      if (s) {
        this.bytes -= s.len;
        s.resolve(s.info);
      }
      this.pump();
    } else if (line.startsWith('error:')) {
      const s = this.inFlight.shift();
      if (s) {
        this.bytes -= s.len;
        s.reject(new GrblError(line, s.line));
      }
      this.pump();
    } else if (line.startsWith('ALARM:')) {
      this.fail(new GrblError(line, ''));
    } else if (line.startsWith('<')) {
      this.onReport(line);
    } else if (/^Grbl \S+/.test(line)) {
      // A banner means GRBL has just reset: nothing in flight will be answered.
      this.version = /^Grbl (\S+)/.exec(line)![1];
      this.fail(new Stopped());
      this.onBanner?.();
    } else {
      this.inFlight[0]?.info.push(line);
    }
  }

  private onReport(line: string): void {
    const parts = line.slice(1, -1).split('|');
    const state = parts[0];
    let mpos: number[] | null = null;
    let wpos: number[] | null = null;
    for (const p of parts.slice(1)) {
      const [k, v] = p.split(':');
      const nums = v?.split(',').map(Number);
      if (k === 'MPos') mpos = nums;
      else if (k === 'WPos') wpos = nums;
      else if (k === 'WCO' && nums) {
        this.wco = [nums[0], nums[1], nums[2] ?? 0];
        this.wcoSeen = true;
      }
    }
    const pos = wpos ?? (mpos ? mpos.map((v, i) => v - this.wco[i]) : null);
    this.status = { state, pos: pos ? [pos[0], pos[1], pos[2] ?? 0] : this.status.pos };
    this.onStatus(this.status);
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([p, wait(ms).then(() => Promise.reject(new Error(message)))]);
}
