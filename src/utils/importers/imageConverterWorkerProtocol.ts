import type { ConverterFontBits, ConverterSettings, ConversionResult } from './imageConverter';
import type { AlignmentOffset, StandardPreprocessedImage } from './imageConverterStandardCore';

export interface StandardWorkerInitMessage {
  type: 'init';
  fontBitsByCharset: ConverterFontBits;
}

export interface StandardWorkerStartRequestMessage {
  type: 'start-request';
  requestId: number;
  preprocessed: StandardPreprocessedImage;
  settings: ConverterSettings;
}

export interface StandardWorkerSolveOffsetMessage {
  type: 'solve-standard-offset';
  requestId: number;
  offsetId: number;
  offset: AlignmentOffset;
}

export interface StandardWorkerCancelMessage {
  type: 'cancel';
  requestId: number;
}

export type StandardWorkerRequestMessage =
  | StandardWorkerInitMessage
  | StandardWorkerStartRequestMessage
  | StandardWorkerSolveOffsetMessage
  | StandardWorkerCancelMessage;

export interface StandardWorkerReadyMessage {
  type: 'ready';
  wasmEnabled: boolean;
  wasmError?: string;
}

export interface StandardWorkerComboResultMessage {
  type: 'offset-result';
  requestId: number;
  offsetId: number;
  conversion: ConversionResult;
  error: number;
}

export interface StandardWorkerCancelledMessage {
  type: 'cancelled';
  requestId: number;
  offsetId?: number;
}

export interface StandardWorkerErrorMessage {
  type: 'error';
  requestId?: number;
  offsetId?: number;
  error: string;
}

export type StandardWorkerResponseMessage =
  | StandardWorkerReadyMessage
  | StandardWorkerComboResultMessage
  | StandardWorkerCancelledMessage
  | StandardWorkerErrorMessage;
