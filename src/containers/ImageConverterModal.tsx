import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import Modal from '../components/Modal';
import { Toolbar } from '../redux/toolbar';
import { RootState, Framebuf, Pixel } from '../redux/types';
import * as ReduxRoot from '../redux/root';
import { getROMFontBits } from '../redux/selectors';
import {
  convertImage,
  ConversionCancelledError,
  disposeStandardConverterWorkers,
  ConverterFontBits,
  ConversionOutputs,
  ConversionResult,
  ConverterSettings,
  CONVERTER_DEFAULTS,
  CONVERTER_PRESETS,
  PALETTES,
} from '../utils/importers/imageConverter';
import type { StandardAccelerationPath } from '../utils/importers/imageConverter';
import styles from './ImageConverterModal.module.css';

const STORAGE_KEY = 'petsciishop-image-converter-settings';

function normalizeOutputModes(settings: ConverterSettings): ConverterSettings {
  return { ...settings, outputStandard: true };
}

function resetOutputModes(settings: ConverterSettings): ConverterSettings {
  return {
    ...settings,
    outputStandard: CONVERTER_DEFAULTS.outputStandard,
    outputEcm: CONVERTER_DEFAULTS.outputEcm,
    outputMcm: CONVERTER_DEFAULTS.outputMcm,
  };
}

function getCharsetIndicator(charset: ConversionResult['charset']): { sample: string; label: string } {
  if (charset === 'lower') {
    return { sample: 'abc', label: 'Lowercase charset selected' };
  }
  return { sample: 'ABC', label: 'Uppercase charset selected' };
}

function getStandardBackendLabel(backend: StandardAccelerationPath): string {
  return backend === 'wasm' ? 'WASM' : 'JS fallback';
}

function sanitizeScreenName(name: string): string | undefined {
  const cleaned = name
    .normalize('NFKC')
    .replace(/[\/\\:*?"<>|]/g, ' ')
    .replace(/[\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || undefined;
}

function getTodayDateString(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = `${today.getMonth() + 1}`.padStart(2, '0');
  const day = `${today.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function loadSettings(): ConverterSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return normalizeOutputModes(resetOutputModes({ ...CONVERTER_DEFAULTS, ...JSON.parse(saved) }));
    }
  } catch { /* ignore */ }
  return normalizeOutputModes(resetOutputModes({ ...CONVERTER_DEFAULTS }));
}

function saveSettings(settings: ConverterSettings) {
  try {
      localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(normalizeOutputModes(resetOutputModes(settings)))
    );
  } catch { /* ignore */ }
}

function resultToFramebuf(result: ConversionResult, metadata?: Framebuf['metadata']): Framebuf {
  const framebuf: Pixel[][] = [];
  const isEcm = result.mode === 'ecm';
  const isMcm = result.mode === 'mcm';
  for (let row = 0; row < 25; row++) {
    const rowData: Pixel[] = [];
    for (let col = 0; col < 40; col++) {
      const idx = row * 40 + col;
      let code = result.screencodes[idx];
      if (isEcm) {
        // Encode bg selector in upper 2 bits of the screencode
        const bgSel = result.bgIndices[idx] ?? 0;
        code = ((bgSel & 3) << 6) | (code & 0x3F);
      }
      rowData.push({ code, color: result.colors[idx] });
    }
    framebuf.push(rowData);
  }
  const fb: Framebuf = {
    framebuf,
    width: 40,
    height: 25,
    backgroundColor: result.backgroundColor,
    borderColor: result.backgroundColor,
    charset: result.charset,
    metadata,
  };
  if (isEcm) {
    return {
      ...fb,
      ecmMode: true,
      extBgColor1: result.ecmBgColors[1] ?? 0,
      extBgColor2: result.ecmBgColors[2] ?? 0,
      extBgColor3: result.ecmBgColors[3] ?? 0,
    };
  }
  if (isMcm) {
    return {
      ...fb,
      mcmMode: true,
      mcmColor1: result.mcmSharedColors[0] ?? 0,
      mcmColor2: result.mcmSharedColors[1] ?? 0,
    };
  }
  return fb;
}

type ConverterModeKey = 'outputStandard' | 'outputEcm' | 'outputMcm';
type PreviewMode = 'standard' | 'ecm' | 'mcm';
type PreviewSignatures = Partial<Record<PreviewMode, string>>;
type PreviewTiming = { startedAtMs: number | null; completedSeconds: number | null };
type PreviewTimings = Record<PreviewMode, PreviewTiming>;
const PREVIEW_MODE_ORDER: PreviewMode[] = ['standard', 'ecm', 'mcm'];

function createEmptyPreviewTimings(): PreviewTimings {
  return {
    standard: { startedAtMs: null, completedSeconds: null },
    ecm: { startedAtMs: null, completedSeconds: null },
    mcm: { startedAtMs: null, completedSeconds: null },
  };
}

function trimResultsForSettings(
  results: ConversionOutputs | null,
  settings: ConverterSettings
): ConversionOutputs | null {
  if (!results) return results;

  return {
    standard: settings.outputStandard ? results.standard : undefined,
    ecm: settings.outputEcm ? results.ecm : undefined,
    mcm: settings.outputMcm ? results.mcm : undefined,
    previewStd: settings.outputStandard ? results.previewStd : undefined,
    previewEcm: settings.outputEcm ? results.previewEcm : undefined,
    previewMcm: settings.outputMcm ? results.previewMcm : undefined,
  };
}

function trimSignaturesForSettings(
  signatures: PreviewSignatures,
  settings: ConverterSettings
): PreviewSignatures {
  return {
    standard: settings.outputStandard ? signatures.standard : undefined,
    ecm: settings.outputEcm ? signatures.ecm : undefined,
    mcm: settings.outputMcm ? signatures.mcm : undefined,
  };
}

function buildPreviewSignature(
  mode: PreviewMode,
  settings: ConverterSettings,
  sourceVersion: number
): string {
  return JSON.stringify({
    mode,
    sourceVersion,
    brightnessFactor: settings.brightnessFactor,
    saturationFactor: settings.saturationFactor,
    saliencyAlpha: settings.saliencyAlpha,
    lumMatchWeight: settings.lumMatchWeight,
    paletteId: settings.paletteId,
    manualBgColor: settings.manualBgColor,
  });
}

function buildPreviewSignatures(
  settings: ConverterSettings,
  sourceVersion: number
): PreviewSignatures {
  return {
    standard: buildPreviewSignature('standard', settings, sourceVersion),
    ecm: buildPreviewSignature('ecm', settings, sourceVersion),
    mcm: buildPreviewSignature('mcm', settings, sourceVersion),
  };
}

function buildDirtyModes(
  settings: ConverterSettings,
  results: ConversionOutputs | null,
  resultSignatures: PreviewSignatures,
  sourceVersion: number
): PreviewMode[] {
  const currentSignatures = buildPreviewSignatures(settings, sourceVersion);

  return PREVIEW_MODE_ORDER.filter(mode => {
    if (mode === 'ecm' && !settings.outputEcm) return false;
    if (mode === 'mcm' && !settings.outputMcm) return false;

    if (mode === 'standard') {
      return !results?.standard || resultSignatures.standard !== currentSignatures.standard;
    }
    if (mode === 'ecm') {
      return !results?.ecm || resultSignatures.ecm !== currentSignatures.ecm;
    }
    return !results?.mcm || resultSignatures.mcm !== currentSignatures.mcm;
  });
}

function buildModeSettings(
  settings: ConverterSettings,
  mode: PreviewMode
): ConverterSettings {
  return {
    ...settings,
    outputStandard: mode === 'standard',
    outputEcm: mode === 'ecm',
    outputMcm: mode === 'mcm',
  };
}

function mergeModeOutput(
  previous: ConversionOutputs | null,
  output: ConversionOutputs,
  mode: PreviewMode
): ConversionOutputs {
  const next: ConversionOutputs = previous ? { ...previous } : {};

  if (mode === 'standard' && output.standard && output.previewStd) {
    next.standard = output.standard;
    next.previewStd = output.previewStd;
  }
  if (mode === 'ecm' && output.ecm && output.previewEcm) {
    next.ecm = output.ecm;
    next.previewEcm = output.previewEcm;
  }
  if (mode === 'mcm' && output.mcm && output.previewMcm) {
    next.mcm = output.mcm;
    next.previewMcm = output.previewMcm;
  }

  return next;
}

function updateModeSignature(
  previous: PreviewSignatures,
  mode: PreviewMode,
  settings: ConverterSettings,
  sourceVersion: number
): PreviewSignatures {
  return {
    ...previous,
    [mode]: buildPreviewSignature(mode, settings, sourceVersion),
  };
}

function getPendingPreviewState(
  mode: PreviewMode,
  converting: boolean,
  activeRenderMode: PreviewMode | null,
  awaitingManualRerender: boolean,
  progress: { stage: string; detail: string; pct: number }
): { label: string; detail: string; pct: number } {
  const modeName = mode === 'standard' ? 'Standard' : mode === 'ecm' ? 'ECM' : 'MCM';

  if (!converting) {
    if (awaitingManualRerender) {
      return {
        label: 'Needs rerender',
        detail: `Values changed. Click rerender to update ${modeName}.`,
        pct: 0,
      };
    }
    return {
      label: 'Queued...',
      detail: 'Waiting to start conversion.',
      pct: 0,
    };
  }

  if (activeRenderMode !== mode) {
    return {
      label: 'Queued...',
      detail: 'Waiting for earlier outputs to finish.',
      pct: 0,
    };
  }

  if (progress.stage === 'Rendering') {
    return {
      label: 'Rendering preview...',
      detail: progress.detail || 'Generating the preview image.',
      pct: progress.pct,
    };
  }

  if (mode === 'mcm' && progress.stage === 'MCM globals') {
    return {
      label: 'Finding MCM colors...',
      detail: progress.detail,
      pct: progress.pct,
    };
  }

  if (progress.stage === 'Converting') {
    if (mode === 'standard' && progress.detail.includes('Standard')) {
      return { label: 'Converting Standard...', detail: progress.detail, pct: progress.pct };
    }
    if (mode === 'ecm' && progress.detail.includes('ECM')) {
      return { label: 'Converting ECM...', detail: progress.detail, pct: progress.pct };
    }
    if (mode === 'mcm' && progress.detail.includes('MCM')) {
      return { label: 'Converting MCM...', detail: progress.detail, pct: progress.pct };
    }
  }

  return {
    label: `Preparing ${modeName}...`,
    detail: progress.detail || `${progress.stage}...`,
    pct: progress.pct,
  };
}

function isPreviewOverlayActive(
  mode: PreviewMode,
  converting: boolean,
  activeRenderMode: PreviewMode | null
): boolean {
  return converting && activeRenderMode === mode;
}

function formatElapsedDuration(totalSeconds: number): string {
  const clampedSeconds = Math.max(1, totalSeconds);
  const hours = Math.floor(clampedSeconds / 3600);
  const minutes = Math.floor((clampedSeconds % 3600) / 60);
  const seconds = clampedSeconds % 60;
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`);
  }

  return parts.join(' ');
}

function getElapsedSeconds(startedAtMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((nowMs - startedAtMs) / 1000));
}

function getLiveTimingLabel(
  mode: PreviewMode,
  timings: PreviewTimings,
  converting: boolean,
  activeRenderMode: PreviewMode | null,
  nowMs: number
): string | null {
  if (!converting || activeRenderMode !== mode) return null;
  const startedAtMs = timings[mode].startedAtMs;
  if (startedAtMs === null) return null;
  return formatElapsedDuration(getElapsedSeconds(startedAtMs, nowMs));
}

function getCompletedTimingLabel(
  completedSeconds: number | null,
  hasResult: boolean,
  isStale: boolean
): string | null {
  if (!hasResult || isStale || completedSeconds === null) return null;
  return `Finished processing in ${formatElapsedDuration(completedSeconds)}`;
}

export default function ImageConverterModal() {
  const show = useSelector((state: RootState) => state.toolbar.showImageConverter);
  const dispatch = useDispatch();

  const [settings, setSettings] = useState<ConverterSettings>(loadSettings);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [sourceVersion, setSourceVersion] = useState(0);
  const [converting, setConverting] = useState(false);
  const [activeRenderMode, setActiveRenderMode] = useState<PreviewMode | null>(null);
  const [progress, setProgress] = useState({ stage: '', detail: '', pct: 0 });
  const [results, setResults] = useState<ConversionOutputs | null>(null);
  const [resultSignatures, setResultSignatures] = useState<PreviewSignatures>({});
  const [previewTimings, setPreviewTimings] = useState<PreviewTimings>(createEmptyPreviewTimings);
  const [timerNowMs, setTimerNowMs] = useState(() => Date.now());
  const [standardBackend, setStandardBackend] = useState<StandardAccelerationPath | null>(null);

  const stdCanvasRef = useRef<HTMLCanvasElement>(null);
  const ecmCanvasRef = useRef<HTMLCanvasElement>(null);
  const mcmCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const convertTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversionIdRef = useRef(0);
  const fontBitsRef = useRef<ConverterFontBits | null>(null);

  // Load font bits once
  useEffect(() => {
    try {
      fontBitsRef.current = {
        upper: getROMFontBits('upper').bits,
        lower: getROMFontBits('lower').bits,
      };
    } catch { /* assets not loaded yet */ }
  }, []);

  const resetModalState = useCallback(() => {
    conversionIdRef.current += 1;
    disposeStandardConverterWorkers();
    if (convertTimeoutRef.current) {
      clearTimeout(convertTimeoutRef.current);
      convertTimeoutRef.current = null;
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setImage(null);
    setFileName('');
    setSourceVersion(0);
    setResults(null);
    setResultSignatures({});
    setPreviewTimings(createEmptyPreviewTimings());
    setStandardBackend(null);
    setProgress({ stage: '', detail: '', pct: 0 });
    setActiveRenderMode(null);
    setConverting(false);
    setSettings(prev => resetOutputModes(prev));
  }, []);

  useEffect(() => {
    if (!show) {
      resetModalState();
    }
  }, [show, resetModalState]);

  useEffect(() => {
    if (!converting || !activeRenderMode) {
      return;
    }

    setTimerNowMs(Date.now());
    const intervalId = setInterval(() => {
      setTimerNowMs(Date.now());
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [converting, activeRenderMode]);

  // Auto-convert the first render only. Once previews exist, setting changes
  // should only mark them stale until the user explicitly requests rerendering.
  useEffect(() => {
    if (!image || !show || converting) return;

    const dirtyModes = buildDirtyModes(settings, results, resultSignatures, sourceVersion);
    if (dirtyModes.length === 0) return;
    const hasRenderedOutputs = Boolean(results?.standard || results?.ecm || results?.mcm);
    if (hasRenderedOutputs) return;

    if (convertTimeoutRef.current) clearTimeout(convertTimeoutRef.current);

    convertTimeoutRef.current = setTimeout(() => {
      doConversion(image, settings, sourceVersion, dirtyModes, results, resultSignatures);
    }, 300);

    return () => {
      if (convertTimeoutRef.current) clearTimeout(convertTimeoutRef.current);
    };
  }, [image, settings, show, sourceVersion, converting]);

  // Draw previews when results change
  useEffect(() => {
    if (!results) return;
    if (stdCanvasRef.current && results.previewStd) {
      stdCanvasRef.current.getContext('2d')!.putImageData(results.previewStd, 0, 0);
    }
    if (ecmCanvasRef.current && results.previewEcm) {
      ecmCanvasRef.current.getContext('2d')!.putImageData(results.previewEcm, 0, 0);
    }
    if (mcmCanvasRef.current && results.previewMcm) {
      mcmCanvasRef.current.getContext('2d')!.putImageData(results.previewMcm, 0, 0);
    }
  }, [results]);

  const doConversion = useCallback(async (
    img: HTMLImageElement,
    s: ConverterSettings,
    sourceVersionValue: number,
    queuedModes: PreviewMode[],
    initialResults: ConversionOutputs | null,
    initialSignatures: PreviewSignatures
  ) => {
    if (!fontBitsRef.current) {
      try {
        fontBitsRef.current = {
          upper: getROMFontBits('upper').bits,
          lower: getROMFontBits('lower').bits,
        };
      } catch { return; }
    }
    const conversionId = ++conversionIdRef.current;
    let currentMode: PreviewMode | null = null;
    setConverting(true);
    setPreviewTimings(prev => {
      const next = { ...prev };
      for (const mode of queuedModes) {
        next[mode] = { startedAtMs: null, completedSeconds: null };
      }
      return next;
    });
    if (queuedModes.includes('standard')) {
      setStandardBackend(null);
    }
    let nextResults = trimResultsForSettings(initialResults, s);
    let nextSignatures = trimSignaturesForSettings(initialSignatures, s);
    try {
      for (const mode of queuedModes) {
        if (conversionId !== conversionIdRef.current) {
          return;
        }

        const startedAtMs = Date.now();
        currentMode = mode;
        setActiveRenderMode(mode);
        setTimerNowMs(startedAtMs);
        setPreviewTimings(prev => ({
          ...prev,
          [mode]: { startedAtMs, completedSeconds: null },
        }));
        setProgress({ stage: '', detail: '', pct: 0 });

        const output = await convertImage(
          img,
          buildModeSettings(s, mode),
          fontBitsRef.current,
          (stage, detail, pct) => {
            if (conversionId !== conversionIdRef.current) {
              return;
            }
            setProgress({ stage, detail, pct });
          },
          mode === 'standard'
            ? backend => {
              if (conversionId !== conversionIdRef.current) {
                return;
              }
              setStandardBackend(backend);
            }
            : undefined,
          () => conversionId !== conversionIdRef.current
        );
        if (conversionId !== conversionIdRef.current) {
          return;
        }

        nextResults = mergeModeOutput(nextResults, output, mode);
        nextSignatures = updateModeSignature(nextSignatures, mode, s, sourceVersionValue);
        setResults(nextResults);
        setResultSignatures(nextSignatures);
        setPreviewTimings(prev => ({
          ...prev,
          [mode]: {
            startedAtMs: null,
            completedSeconds: getElapsedSeconds(startedAtMs, Date.now()),
          },
        }));
        currentMode = null;

        // Let React commit the updated preview before the next output starts.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } catch (err) {
      if (err instanceof ConversionCancelledError) {
        if (conversionId === conversionIdRef.current && currentMode) {
          setPreviewTimings(prev => ({
            ...prev,
            [currentMode]: { startedAtMs: null, completedSeconds: null },
          }));
        }
        return;
      }
      if (conversionId === conversionIdRef.current && currentMode) {
        setPreviewTimings(prev => ({
          ...prev,
          [currentMode]: { startedAtMs: null, completedSeconds: null },
        }));
      }
      console.error('Conversion failed:', err);
    } finally {
      if (conversionId === conversionIdRef.current) {
        setActiveRenderMode(null);
        setProgress({ stage: '', detail: '', pct: 0 });
        setConverting(false);
      }
    }
  }, []);

  const loadImageFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        conversionIdRef.current += 1;
        if (convertTimeoutRef.current) {
          clearTimeout(convertTimeoutRef.current);
          convertTimeoutRef.current = null;
        }
        setResults(null);
        setResultSignatures({});
        setPreviewTimings(createEmptyPreviewTimings());
        setStandardBackend(null);
        setProgress({ stage: '', detail: '', pct: 0 });
        setActiveRenderMode(null);
        setConverting(false);
        setSourceVersion(prev => prev + 1);
        setImage(img);
        setFileName(file.name.replace(/\.[^.]+$/, ''));
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileSelect = useCallback(() => {
    if (converting) return;
    fileInputRef.current?.click();
  }, [converting]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (converting) return;
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    loadImageFile(file);
  }, [converting, loadImageFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (converting) return;
    const file = e.dataTransfer.files[0];
    if (file && /^image\/(jpeg|png|gif|webp)/.test(file.type)) {
      loadImageFile(file);
    }
  }, [converting, loadImageFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const updateSetting = useCallback(<K extends keyof ConverterSettings>(key: K, value: ConverterSettings[K]) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value } as ConverterSettings;
      saveSettings(next);
      return next;
    });
  }, []);

  const updateOutputMode = useCallback((key: ConverterModeKey, value: boolean) => {
    if (key === 'outputStandard') {
      return;
    }
    setSettings(prev => {
      const next = normalizeOutputModes({ ...prev, [key]: value } as ConverterSettings);
      setResults(current => trimResultsForSettings(current, next));
      setResultSignatures(current => trimSignaturesForSettings(current, next));
      saveSettings(next);
      return next;
    });
  }, []);

  const applyPreset = useCallback((presetId: string) => {
    const preset = CONVERTER_PRESETS.find(p => p.id === presetId);
    if (preset) {
      setSettings(prev => {
        const next: ConverterSettings = {
          ...prev,
          brightnessFactor: preset.brightnessFactor,
          saturationFactor: preset.saturationFactor,
          saliencyAlpha: preset.saliencyAlpha,
          lumMatchWeight: preset.lumMatchWeight,
          paletteId: preset.paletteId,
          manualBgColor: preset.manualBgColor,
        };
        saveSettings(next);
        return next;
      });
    }
  }, []);

  const handleImport = useCallback((result: ConversionResult) => {
    const fb = resultToFramebuf(result, {
      name: sanitizeScreenName(fileName),
      date: getTodayDateString(),
    });
    (dispatch as any)(ReduxRoot.actions.importFramebufsAppend([fb]));
    dispatch(Toolbar.actions.setShowImageConverter(false));
  }, [dispatch, fileName]);

  const handleClose = useCallback(() => {
    dispatch(Toolbar.actions.setShowImageConverter(false));
  }, [dispatch]);

  // Find matching preset
  const matchingPreset = CONVERTER_PRESETS.find(p =>
    Math.abs(p.brightnessFactor - settings.brightnessFactor) < 0.01 &&
    Math.abs(p.saturationFactor - settings.saturationFactor) < 0.01 &&
    Math.abs(p.saliencyAlpha - settings.saliencyAlpha) < 0.01 &&
    Math.abs(p.lumMatchWeight - settings.lumMatchWeight) < 0.01 &&
    p.paletteId === settings.paletteId &&
    p.manualBgColor === settings.manualBgColor
  );

  const activePalette = PALETTES.find(p => p.id === settings.paletteId) || PALETTES[0];
  const currentSignatures = buildPreviewSignatures(settings, sourceVersion);
  const dirtyModes = image ? buildDirtyModes(settings, results, resultSignatures, sourceVersion) : [];
  const hasRenderedOutputs = Boolean(results?.standard || results?.ecm || results?.mcm);
  const awaitingManualRerender = !converting && hasRenderedOutputs && dirtyModes.length > 0;
  const controlsDisabled = converting;
  const showStandardPreview = Boolean(image);
  const showEcmPreview = Boolean(image && settings.outputEcm);
  const showMcmPreview = Boolean(image && settings.outputMcm);
  const standardStale = Boolean(results?.standard && resultSignatures.standard !== currentSignatures.standard);
  const ecmStale = Boolean(results?.ecm && resultSignatures.ecm !== currentSignatures.ecm);
  const mcmStale = Boolean(results?.mcm && resultSignatures.mcm !== currentSignatures.mcm);
  const standardPending = getPendingPreviewState('standard', converting, activeRenderMode, awaitingManualRerender, progress);
  const ecmPending = getPendingPreviewState('ecm', converting, activeRenderMode, awaitingManualRerender, progress);
  const mcmPending = getPendingPreviewState('mcm', converting, activeRenderMode, awaitingManualRerender, progress);
  const standardOverlayActive = standardStale && isPreviewOverlayActive('standard', converting, activeRenderMode);
  const ecmOverlayActive = ecmStale && isPreviewOverlayActive('ecm', converting, activeRenderMode);
  const mcmOverlayActive = mcmStale && isPreviewOverlayActive('mcm', converting, activeRenderMode);
  const standardLiveTiming = getLiveTimingLabel('standard', previewTimings, converting, activeRenderMode, timerNowMs);
  const ecmLiveTiming = getLiveTimingLabel('ecm', previewTimings, converting, activeRenderMode, timerNowMs);
  const mcmLiveTiming = getLiveTimingLabel('mcm', previewTimings, converting, activeRenderMode, timerNowMs);
  const standardCompletedTiming = getCompletedTimingLabel(
    previewTimings.standard.completedSeconds,
    Boolean(results?.standard),
    standardStale
  );
  const ecmCompletedTiming = getCompletedTimingLabel(
    previewTimings.ecm.completedSeconds,
    Boolean(results?.ecm),
    ecmStale
  );
  const mcmCompletedTiming = getCompletedTimingLabel(
    previewTimings.mcm.completedSeconds,
    Boolean(results?.mcm),
    mcmStale
  );
  const standardLiveBackendLabel = converting && activeRenderMode === 'standard' && standardBackend
    ? getStandardBackendLabel(standardBackend)
    : null;
  const standardCompletedBackendLabel = results?.standard?.accelerationBackend && !standardStale
    ? getStandardBackendLabel(results.standard.accelerationBackend)
    : null;

  const handleManualRerender = useCallback(() => {
    if (!image || converting || dirtyModes.length === 0) {
      return;
    }
    if (convertTimeoutRef.current) {
      clearTimeout(convertTimeoutRef.current);
      convertTimeoutRef.current = null;
    }
    doConversion(image, settings, sourceVersion, dirtyModes, results, resultSignatures);
  }, [converting, dirtyModes, doConversion, image, resultSignatures, results, settings, sourceVersion]);

  if (!show) return null;

  return (
    <Modal showModal={show} width={1080}>
      <div className={styles.container}>
        <div className={styles.titleBlock}>
          <h3 className={styles.title}>Convert Image to PETSCII</h3>
          <div className={styles.titleSupport}>
            Powered by the <span className={styles.engineBadge}>TruSkii3000™</span> converter engine
          </div>
        </div>

        <div className={styles.topRow}>
          {/* File Selection / Reference Image */}
          <div className={styles.dropZoneWrapper}>
            <div
              className={`${styles.dropZone} ${image ? styles.dropZoneHasImage : ''} ${controlsDisabled ? styles.dropZoneDisabled : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={handleFileSelect}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.gif,.webp"
                disabled={controlsDisabled}
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              {image
                ? <img src={image.src} className={styles.dropZoneImage} alt="Source" />
                : <span>Click to select image or drag &amp; drop</span>
              }
            </div>
            <div className={styles.dropZoneHeading}>
              {image ? `Source: ${fileName}` : 'Source Image'}
            </div>
          </div>

          {/* Settings */}
          <fieldset className={`${styles.settings} ${controlsDisabled ? styles.controlsDisabled : ''}`} disabled={controlsDisabled}>
            <legend>Conversion Settings</legend>
            <div className={styles.settingsRow}>
              <label>Preset:</label>
              <select
                value={matchingPreset?.id || '__custom__'}
                onChange={(e) => {
                  if (e.target.value !== '__custom__') applyPreset(e.target.value);
                }}
              >
                {CONVERTER_PRESETS.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                <option value="__custom__">Custom</option>
              </select>
            </div>

            <div className={styles.settingsRow}>
              <label>Palette:</label>
              <select
                value={settings.paletteId}
                onChange={(e) => updateSetting('paletteId', e.target.value)}
              >
                {PALETTES.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className={styles.settingsRow}>
              <label>Brightness:</label>
              <input
                type="range" min="0.5" max="2.0" step="0.1"
                value={settings.brightnessFactor}
                onChange={(e) => updateSetting('brightnessFactor', parseFloat(e.target.value))}
              />
              <span className={styles.value}>{settings.brightnessFactor.toFixed(1)}</span>
            </div>

            <div className={styles.settingsRow}>
              <label>Saturation:</label>
              <input
                type="range" min="0.5" max="3.0" step="0.1"
                value={settings.saturationFactor}
                onChange={(e) => updateSetting('saturationFactor', parseFloat(e.target.value))}
              />
              <span className={styles.value}>{settings.saturationFactor.toFixed(1)}</span>
            </div>

            <div className={styles.settingsRow}>
              <label>Detail Boost:</label>
              <input
                type="range" min="0" max="10" step="0.5"
                value={settings.saliencyAlpha}
                onChange={(e) => updateSetting('saliencyAlpha', parseFloat(e.target.value))}
              />
              <span className={styles.value}>{settings.saliencyAlpha.toFixed(1)}</span>
            </div>

            <div className={styles.settingsRow}>
              <label>Lum. Match:</label>
              <input
                type="range" min="0" max="50" step="1"
                value={settings.lumMatchWeight}
                onChange={(e) => updateSetting('lumMatchWeight', parseInt(e.target.value))}
              />
              <span className={styles.value}>{settings.lumMatchWeight}</span>
            </div>
          </fieldset>

          <div className={styles.sideColumn}>
            <fieldset className={`${styles.bgPanel} ${controlsDisabled ? styles.controlsDisabled : ''}`} disabled={controlsDisabled}>
              <legend>Background</legend>
              <div className={styles.bgSwatches}>
                <button
                  className={`${styles.bgAuto} ${settings.manualBgColor === null ? styles.active : ''}`}
                  disabled={controlsDisabled}
                  onClick={() => updateSetting('manualBgColor', null)}
                >auto</button>
                {activePalette.hex.map((hex, i) => (
                  <button
                    key={i}
                    className={`${styles.bgSwatch} ${settings.manualBgColor === i ? styles.active : ''}`}
                    disabled={controlsDisabled}
                    style={{ backgroundColor: hex }}
                    onClick={() => updateSetting('manualBgColor', i)}
                    title={`Color ${i}`}
                  />
                ))}
              </div>
            </fieldset>

            <fieldset className={`${styles.outputPanel} ${controlsDisabled ? styles.controlsDisabled : ''}`} disabled={controlsDisabled}>
              <legend>PETSKII Output</legend>
              <div className={styles.outputSection}>
                <label className={styles.modeOption}>
                  <input
                    type='checkbox'
                    checked={true}
                    disabled={true}
                    onChange={() => undefined}
                  />
                  <span className={styles.modeText}>
                    <span className={styles.modeName}>Standard</span>
                    <span className={styles.modeDescription}>Standard PETSCII mode. Fastest, most common.</span>
                  </span>
                </label>
                <label className={styles.modeOption}>
                  <input
                    type='checkbox'
                    checked={settings.outputEcm}
                    onChange={(e) => updateOutputMode('outputEcm', e.target.checked)}
                  />
                  <span className={styles.modeText}>
                    <span className={styles.modeName}>ECM</span>
                    <span className={styles.modeDescription}>Extended Color Mode. A bit slower, 4 backgrounds.</span>
                  </span>
                </label>
                <label className={styles.modeOption}>
                  <input
                    type='checkbox'
                    checked={settings.outputMcm}
                    onChange={(e) => updateOutputMode('outputMcm', e.target.checked)}
                  />
                  <span className={styles.modeText}>
                    <span className={styles.modeName}>MCM</span>
                    <span className={styles.modeDescription}>Multicolor Mode. Slowest, can take several seconds.</span>
                  </span>
                </label>
                <div className={styles.outputWarning}>
                  Standard is relatively fast. ECM takes longer. MCM can take several seconds depending on your computer.
                </div>
              </div>
            </fieldset>
          </div>
        </div>

        {awaitingManualRerender && (
          <div className={styles.rerenderNotice}>
            <div className={styles.rerenderText}>Values changed. Click to rerender the outputs.</div>
            <button className={styles.rerenderBtn} onClick={handleManualRerender}>
              <i className="fa-solid fa-repeat" aria-hidden="true" />
              <span>Rerender Outputs</span>
            </button>
          </div>
        )}

        {/* Previews */}
        {(showStandardPreview || showEcmPreview || showMcmPreview) && (
          <div className={styles.previews}>
            {showStandardPreview && (
            <div className={styles.previewPanel}>
              <h4>Standard (256 chars)</h4>
              {results?.standard ? (
                <>
                  <div className={styles.previewSurface}>
                    <canvas
                      ref={stdCanvasRef}
                      width={320}
                      height={200}
                      className={`${styles.previewCanvas} ${standardStale ? styles.previewSurfaceStale : ''}`}
                    />
                    {standardOverlayActive && (
                      <div className={styles.previewOverlay}>
                        <div className={styles.previewPlaceholderInner}>
                          <div className={styles.previewPlaceholderLabel}>{standardPending.label}</div>
                          <div className={styles.previewPlaceholderDetail}>{standardPending.detail}</div>
                          <div className={styles.previewPlaceholderBar}>
                            <div className={styles.previewPlaceholderFill} style={{ width: `${standardPending.pct}%` }} />
                          </div>
                          {standardLiveTiming && <div className={styles.previewTimingLive}>{standardLiveTiming}</div>}
                          {standardLiveBackendLabel && <div className={styles.previewBackendBadge}>{standardLiveBackendLabel}</div>}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className={styles.charsetNote}>
                    <span className={styles.charsetSample}>{getCharsetIndicator(results.standard.charset).sample}</span>
                    <span>{getCharsetIndicator(results.standard.charset).label}</span>
                  </div>
                  {standardCompletedBackendLabel && <div className={styles.previewBackendBadge}>{standardCompletedBackendLabel}</div>}
                  {standardCompletedTiming && <div className={styles.previewTimingDone}>{standardCompletedTiming}</div>}
                  <button
                    className={styles.importBtn}
                    disabled={standardStale || converting}
                    onClick={() => handleImport(results.standard!)}
                  >Import Standard</button>
                </>
              ) : (
                <div className={styles.previewSurface}>
                <div className={styles.previewPlaceholder}>
                  <div className={styles.previewPlaceholderInner}>
                    <div className={styles.previewPlaceholderLabel}>{standardPending.label}</div>
                    <div className={styles.previewPlaceholderDetail}>{standardPending.detail}</div>
                    <div className={styles.previewPlaceholderBar}>
                      <div className={styles.previewPlaceholderFill} style={{ width: `${standardPending.pct}%` }} />
                    </div>
                    {standardLiveTiming && <div className={styles.previewTimingLive}>{standardLiveTiming}</div>}
                    {standardLiveBackendLabel && <div className={styles.previewBackendBadge}>{standardLiveBackendLabel}</div>}
                  </div>
                </div>
                </div>
              )}
            </div>
            )}
            {showEcmPreview && (
            <div className={styles.previewPanel}>
              <h4>ECM (64 chars, 4 bg)</h4>
              {results?.ecm ? (
                <>
                  <div className={styles.previewSurface}>
                    <canvas
                      ref={ecmCanvasRef}
                      width={320}
                      height={200}
                      className={`${styles.previewCanvas} ${ecmStale ? styles.previewSurfaceStale : ''}`}
                    />
                    {ecmOverlayActive && (
                      <div className={styles.previewOverlay}>
                        <div className={styles.previewPlaceholderInner}>
                          <div className={styles.previewPlaceholderLabel}>{ecmPending.label}</div>
                          <div className={styles.previewPlaceholderDetail}>{ecmPending.detail}</div>
                          <div className={styles.previewPlaceholderBar}>
                            <div className={styles.previewPlaceholderFill} style={{ width: `${ecmPending.pct}%` }} />
                          </div>
                          {ecmLiveTiming && <div className={styles.previewTimingLive}>{ecmLiveTiming}</div>}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className={styles.charsetNote}>
                    <span className={styles.charsetSample}>{getCharsetIndicator(results.ecm.charset).sample}</span>
                    <span>{getCharsetIndicator(results.ecm.charset).label}</span>
                  </div>
                  {ecmCompletedTiming && <div className={styles.previewTimingDone}>{ecmCompletedTiming}</div>}
                  <button
                    className={styles.importBtn}
                    disabled={ecmStale || converting}
                    onClick={() => handleImport(results.ecm!)}
                  >Import ECM</button>
                </>
              ) : (
                <div className={styles.previewSurface}>
                <div className={styles.previewPlaceholder}>
                  <div className={styles.previewPlaceholderInner}>
                    <div className={styles.previewPlaceholderLabel}>{ecmPending.label}</div>
                    <div className={styles.previewPlaceholderDetail}>{ecmPending.detail}</div>
                    <div className={styles.previewPlaceholderBar}>
                      <div className={styles.previewPlaceholderFill} style={{ width: `${ecmPending.pct}%` }} />
                    </div>
                    {ecmLiveTiming && <div className={styles.previewTimingLive}>{ecmLiveTiming}</div>}
                  </div>
                </div>
                </div>
              )}
            </div>
            )}
            {showMcmPreview && (
            <div className={styles.previewPanel}>
              <h4>MCM (mixed hires + multicolor)</h4>
              {results?.mcm ? (
                <>
                  <div className={styles.previewSurface}>
                    <canvas
                      ref={mcmCanvasRef}
                      width={320}
                      height={200}
                      className={`${styles.previewCanvas} ${mcmStale ? styles.previewSurfaceStale : ''}`}
                    />
                    {mcmOverlayActive && (
                      <div className={styles.previewOverlay}>
                        <div className={styles.previewPlaceholderInner}>
                          <div className={styles.previewPlaceholderLabel}>{mcmPending.label}</div>
                          <div className={styles.previewPlaceholderDetail}>{mcmPending.detail}</div>
                          <div className={styles.previewPlaceholderBar}>
                            <div className={styles.previewPlaceholderFill} style={{ width: `${mcmPending.pct}%` }} />
                          </div>
                          {mcmLiveTiming && <div className={styles.previewTimingLive}>{mcmLiveTiming}</div>}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className={styles.charsetNote}>
                    <span className={styles.charsetSample}>{getCharsetIndicator(results.mcm.charset).sample}</span>
                    <span>{getCharsetIndicator(results.mcm.charset).label}</span>
                  </div>
                  {mcmCompletedTiming && <div className={styles.previewTimingDone}>{mcmCompletedTiming}</div>}
                  <button
                    className={styles.importBtn}
                    disabled={mcmStale || converting}
                    onClick={() => handleImport(results.mcm!)}
                  >Import MCM</button>
                  <div className={styles.previewNote}>
                    BG {results.mcm.backgroundColor}, MC1 {results.mcm.mcmSharedColors[0] ?? 0}, MC2 {results.mcm.mcmSharedColors[1] ?? 0}
                  </div>
                </>
              ) : (
                <div className={styles.previewSurface}>
                <div className={styles.previewPlaceholder}>
                  <div className={styles.previewPlaceholderInner}>
                    <div className={styles.previewPlaceholderLabel}>{mcmPending.label}</div>
                    <div className={styles.previewPlaceholderDetail}>{mcmPending.detail}</div>
                    <div className={styles.previewPlaceholderBar}>
                      <div className={styles.previewPlaceholderFill} style={{ width: `${mcmPending.pct}%` }} />
                    </div>
                    {mcmLiveTiming && <div className={styles.previewTimingLive}>{mcmLiveTiming}</div>}
                  </div>
                </div>
                </div>
              )}
            </div>
            )}
          </div>
        )}

        {/* Close */}
        <div className={styles.footer}>
          <button className={styles.closeBtn} onClick={handleClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}
