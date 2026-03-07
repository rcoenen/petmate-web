import type {
  ConverterFontBits,
  ConverterSettings,
  PreprocessedFittedImage,
  ProgressCallback,
  WorkerSolvedModeCandidate,
} from './imageConverter';
import { buildAlignmentOffsets, ConversionCancelledError } from './imageConverterStandardCore';
import type { AlignmentOffset } from './imageConverterStandardCore';
import type {
  ConverterWorkerRequestMessage,
  ConverterWorkerResponseMessage,
  WorkerMode,
} from './imageConverterWorkerProtocol';

type SupportedMode = Exclude<WorkerMode, 'standard'>;

type OffsetJob = {
  offsetId: number;
  offset: AlignmentOffset;
};

type WorkerSlot = {
  id: number;
  worker: Worker;
  busy: boolean;
  currentRequestId: number | null;
  currentOffsetId: number | null;
};

type ActiveRequest = {
  requestId: number;
  mode: SupportedMode;
  queue: OffsetJob[];
  inflight: number;
  completed: number;
  total: number;
  best?: WorkerSolvedModeCandidate;
  cancelled: boolean;
  cancelTimer: ReturnType<typeof setInterval> | null;
  startedAt: number;
  onProgress: ProgressCallback;
  resolve: (result: WorkerSolvedModeCandidate | undefined) => void;
  reject: (error: unknown) => void;
};

function buildOffsetJobs(): OffsetJob[] {
  return buildAlignmentOffsets().map((offset, offsetId) => ({ offsetId, offset }));
}

class ModeWorkerPool {
  private readonly slots: WorkerSlot[];
  private readonly ready: Promise<void>;
  private nextRequestId = 1;
  private activeRequest: ActiveRequest | null = null;

  constructor(fontBitsByCharset: ConverterFontBits) {
    const hardware = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    const workerCount = Math.max(1, Math.min(8, Math.max(1, hardware - 1)));
    this.slots = Array.from({ length: workerCount }, (_, index) => ({
      id: index + 1,
      worker: new Worker(new URL('./imageConverterWorker.ts', import.meta.url), { type: 'module' }),
      busy: false,
      currentRequestId: null,
      currentOffsetId: null,
    }));

    this.ready = Promise.all(this.slots.map(slot => new Promise<void>((resolve, reject) => {
      const handleMessage = (event: MessageEvent<ConverterWorkerResponseMessage>) => {
        if (event.data.type === 'ready') {
          slot.worker.removeEventListener('message', handleMessage);
          slot.worker.removeEventListener('error', handleError);
          resolve();
        }
      };
      const handleError = (event: ErrorEvent) => {
        slot.worker.removeEventListener('message', handleMessage);
        slot.worker.removeEventListener('error', handleError);
        reject(event.error ?? new Error(event.message));
      };
      slot.worker.addEventListener('message', handleMessage);
      slot.worker.addEventListener('error', handleError, { once: true });
      slot.worker.postMessage({
        type: 'init',
        fontBitsByCharset,
      } satisfies ConverterWorkerRequestMessage);
    }))).then(() => {
      this.slots.forEach(slot => {
        slot.worker.onmessage = event => this.handleWorkerMessage(slot, event.data as ConverterWorkerResponseMessage);
        slot.worker.onerror = event => this.handleWorkerError(slot, event);
      });
    });
  }

  async run(
    mode: SupportedMode,
    preprocessed: PreprocessedFittedImage,
    settings: ConverterSettings,
    onProgress: ProgressCallback,
    shouldCancel?: () => boolean
  ): Promise<WorkerSolvedModeCandidate | undefined> {
    await this.ready;

    if (this.activeRequest) {
      this.cancelActiveRequest();
      throw new Error('Mode worker pool already has an active request.');
    }

    const requestId = this.nextRequestId++;
    const queue = buildOffsetJobs();
    const active: ActiveRequest = {
      requestId,
      mode,
      queue,
      inflight: 0,
      completed: 0,
      total: queue.length,
      cancelled: false,
      cancelTimer: null,
      startedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      onProgress,
      resolve: () => {},
      reject: () => {},
    };
    this.activeRequest = active;

    this.slots.forEach(slot => {
      slot.worker.postMessage({
        type: 'start-request',
        requestId,
        preprocessed,
        settings,
      } satisfies ConverterWorkerRequestMessage);
    });

    return await new Promise<WorkerSolvedModeCandidate | undefined>((resolve, reject) => {
      active.resolve = resolve;
      active.reject = reject;
      active.cancelTimer = shouldCancel ? setInterval(() => {
        if (!active.cancelled && shouldCancel()) {
          this.cancelActiveRequest();
        }
      }, 25) : null;
      this.fillIdleWorkers();
    });
  }

  dispose() {
    this.cancelActiveRequest(true);
    this.slots.forEach(slot => slot.worker.terminate());
  }

  private fillIdleWorkers() {
    const active = this.activeRequest;
    if (!active || active.cancelled) return;

    for (const slot of this.slots) {
      if (slot.busy) continue;
      const job = active.queue.shift();
      if (!job) break;
      slot.busy = true;
      slot.currentRequestId = active.requestId;
      slot.currentOffsetId = job.offsetId;
      active.inflight++;
      slot.worker.postMessage({
        type: 'solve-offset',
        requestId: active.requestId,
        mode: active.mode,
        offsetId: job.offsetId,
        offset: job.offset,
      } satisfies ConverterWorkerRequestMessage);
    }
  }

  private handleWorkerMessage(slot: WorkerSlot, message: ConverterWorkerResponseMessage) {
    const active = this.activeRequest;
    if (!active) return;
    if ('requestId' in message && message.requestId !== undefined && message.requestId !== active.requestId) {
      return;
    }

    if (message.type === 'offset-result') {
      if (message.mode !== active.mode) {
        this.failActiveRequest(new Error(`Worker mode mismatch: expected ${active.mode}, got ${message.mode}`));
        return;
      }
      this.releaseSlot(slot);
      active.completed += 1;
      active.inflight -= 1;
      const solved: WorkerSolvedModeCandidate = {
        conversion: message.conversion,
        error: message.error,
      };
      if (!active.best || solved.error < active.best.error) {
        active.best = solved;
      }
      active.onProgress(
        'Alignment',
        `${active.mode.toUpperCase()} ${active.completed} of ${active.total}`,
        Math.round((active.completed / Math.max(1, active.total)) * 100)
      );
      this.fillIdleWorkers();
      this.maybeFinish();
      return;
    }

    if (message.type === 'cancelled') {
      if (slot.currentRequestId === active.requestId) {
        this.releaseSlot(slot);
        if (active.inflight > 0) active.inflight -= 1;
      }
      this.maybeFinish();
      return;
    }

    if (message.type === 'error') {
      this.releaseSlot(slot);
      if (active.inflight > 0) active.inflight -= 1;
      this.failActiveRequest(new Error(message.error));
    }
  }

  private handleWorkerError(slot: WorkerSlot, event: ErrorEvent) {
    this.releaseSlot(slot);
    this.failActiveRequest(event.error ?? new Error(event.message));
  }

  private maybeFinish() {
    const active = this.activeRequest;
    if (!active) return;
    if (active.cancelled) {
      if (active.inflight === 0) {
        this.finishActiveRequestWithError(new ConversionCancelledError());
      }
      return;
    }
    if (active.completed === active.total && active.inflight === 0) {
      const result = active.best;
      const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - active.startedAt;
      console.info(`[TruSkii3000] ${active.mode.toUpperCase()} conversion finished.`, {
        alignments: active.total,
        elapsedMs: Math.round(elapsedMs),
        elapsedSeconds: Number((elapsedMs / 1000).toFixed(2)),
      });
      this.cleanupRequestData(active.requestId);
      this.clearActiveRequest();
      active.resolve(result);
    }
  }

  private cancelActiveRequest(fromDispose = false) {
    const active = this.activeRequest;
    if (!active || active.cancelled) return;
    active.cancelled = true;
    this.slots.forEach(slot => {
      slot.worker.postMessage({
        type: 'cancel',
        requestId: active.requestId,
      } satisfies ConverterWorkerRequestMessage);
      if (fromDispose && slot.currentRequestId === active.requestId) {
        this.releaseSlot(slot);
      }
    });
    if (fromDispose) {
      this.finishActiveRequestWithError(new ConversionCancelledError());
    }
  }

  private failActiveRequest(error: Error) {
    this.cancelActiveRequest();
    this.finishActiveRequestWithError(error);
  }

  private finishActiveRequestWithError(error: Error) {
    const active = this.activeRequest;
    if (!active) return;
    this.clearActiveRequest();
    active.reject(error);
  }

  private clearActiveRequest() {
    const active = this.activeRequest;
    if (!active) return;
    if (active.cancelTimer) {
      clearInterval(active.cancelTimer);
    }
    this.activeRequest = null;
  }

  private cleanupRequestData(requestId: number) {
    this.slots.forEach(slot => {
      slot.worker.postMessage({
        type: 'cancel',
        requestId,
      } satisfies ConverterWorkerRequestMessage);
    });
  }

  private releaseSlot(slot: WorkerSlot) {
    slot.busy = false;
    slot.currentRequestId = null;
    slot.currentOffsetId = null;
  }
}

let poolPromise: Promise<ModeWorkerPool> | null = null;

function supportsWorkerAcceleration(): boolean {
  return typeof Worker !== 'undefined';
}

async function getPool(fontBitsByCharset: ConverterFontBits): Promise<ModeWorkerPool> {
  if (!poolPromise) {
    poolPromise = Promise.resolve(new ModeWorkerPool(fontBitsByCharset));
  }
  return await poolPromise;
}

export async function runModeConversionInWorkers(
  mode: SupportedMode,
  preprocessed: PreprocessedFittedImage,
  settings: ConverterSettings,
  fontBitsByCharset: ConverterFontBits,
  onProgress: ProgressCallback,
  shouldCancel?: () => boolean
): Promise<WorkerSolvedModeCandidate | undefined> {
  if (!supportsWorkerAcceleration()) {
    throw new Error(`${mode.toUpperCase()} worker acceleration is not supported.`);
  }
  const pool = await getPool(fontBitsByCharset);
  return await pool.run(mode, preprocessed, settings, onProgress, shouldCancel);
}

export function disposeModeConverterWorkers() {
  if (!poolPromise) return;
  void poolPromise.then(pool => pool.dispose()).catch(() => {});
  poolPromise = null;
}
