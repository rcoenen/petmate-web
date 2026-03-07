import type {
  ConverterFontBits,
  ConverterSettings,
  ConversionResult,
} from './imageConverter';
import type { AlignmentOffset, StandardPreprocessedImage } from './imageConverterStandardCore';
import type { PreprocessedFittedImage } from './imageConverter';

export type WorkerMode = 'standard' | 'ecm' | 'mcm';

export interface ConverterWorkerInitMessage {
  type: 'init';
  fontBitsByCharset: ConverterFontBits;
}

export interface ConverterWorkerStartRequestMessage {
  type: 'start-request';
  requestId: number;
  preprocessed: StandardPreprocessedImage | PreprocessedFittedImage;
  settings: ConverterSettings;
}

export interface ConverterWorkerSolveOffsetMessage {
  type: 'solve-offset';
  requestId: number;
  mode: WorkerMode;
  offsetId: number;
  offset: AlignmentOffset;
}

export interface ConverterWorkerCancelMessage {
  type: 'cancel';
  requestId: number;
}

export type ConverterWorkerRequestMessage =
  | ConverterWorkerInitMessage
  | ConverterWorkerStartRequestMessage
  | ConverterWorkerSolveOffsetMessage
  | ConverterWorkerCancelMessage;

export interface ConverterWorkerReadyMessage {
  type: 'ready';
  wasmEnabled: boolean;
  wasmError?: string;
}

export interface ConverterWorkerOffsetResultMessage {
  type: 'offset-result';
  requestId: number;
  mode: WorkerMode;
  offsetId: number;
  conversion: ConversionResult;
  error: number;
}

export interface ConverterWorkerCancelledMessage {
  type: 'cancelled';
  requestId: number;
  offsetId?: number;
}

export interface ConverterWorkerErrorMessage {
  type: 'error';
  requestId?: number;
  offsetId?: number;
  error: string;
}

export type ConverterWorkerResponseMessage =
  | ConverterWorkerReadyMessage
  | ConverterWorkerOffsetResultMessage
  | ConverterWorkerCancelledMessage
  | ConverterWorkerErrorMessage;
