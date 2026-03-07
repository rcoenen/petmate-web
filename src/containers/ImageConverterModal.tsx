import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import Modal from '../components/Modal';
import { Toolbar } from '../redux/toolbar';
import { RootState, Framebuf, Pixel } from '../redux/types';
import * as ReduxRoot from '../redux/root';
import { getROMFontBits } from '../redux/selectors';
import {
  convertImage,
  ConversionOutputs,
  ConversionResult,
  ConverterSettings,
  CONVERTER_DEFAULTS,
  CONVERTER_PRESETS,
  PALETTES,
} from '../utils/importers/imageConverter';
import styles from './ImageConverterModal.module.css';

const STORAGE_KEY = 'petsciishop-image-converter-settings';

function ensureAtLeastOneOutput(settings: ConverterSettings): ConverterSettings {
  if (settings.outputStandard || settings.outputEcm || settings.outputMcm) {
    return settings;
  }
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

function loadSettings(): ConverterSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return resetOutputModes(ensureAtLeastOneOutput({ ...CONVERTER_DEFAULTS, ...JSON.parse(saved) }));
    }
  } catch { /* ignore */ }
  return resetOutputModes(ensureAtLeastOneOutput({ ...CONVERTER_DEFAULTS }));
}

function saveSettings(settings: ConverterSettings) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(resetOutputModes(ensureAtLeastOneOutput(settings)))
    );
  } catch { /* ignore */ }
}

function resultToFramebuf(result: ConversionResult): Framebuf {
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
    charset: 'upper',
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

function getPendingPreviewState(
  mode: PreviewMode,
  converting: boolean,
  progress: { stage: string; detail: string; pct: number }
): { label: string; detail: string; pct: number } {
  if (!converting) {
    return {
      label: 'Queued...',
      detail: 'Waiting to start conversion.',
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

  const modeName = mode === 'standard' ? 'Standard' : mode === 'ecm' ? 'ECM' : 'MCM';
  return {
    label: `Preparing ${modeName}...`,
    detail: progress.detail || `${progress.stage}...`,
    pct: progress.pct,
  };
}

export default function ImageConverterModal() {
  const show = useSelector((state: RootState) => state.toolbar.showImageConverter);
  const dispatch = useDispatch();

  const [settings, setSettings] = useState<ConverterSettings>(loadSettings);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState({ stage: '', detail: '', pct: 0 });
  const [results, setResults] = useState<ConversionOutputs | null>(null);

  const stdCanvasRef = useRef<HTMLCanvasElement>(null);
  const ecmCanvasRef = useRef<HTMLCanvasElement>(null);
  const mcmCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const convertTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversionIdRef = useRef(0);
  const fontBitsRef = useRef<number[]>([]);

  // Load font bits once
  useEffect(() => {
    try {
      const font = getROMFontBits('upper');
      fontBitsRef.current = font.bits;
    } catch { /* assets not loaded yet */ }
  }, []);

  const resetModalState = useCallback(() => {
    conversionIdRef.current += 1;
    if (convertTimeoutRef.current) {
      clearTimeout(convertTimeoutRef.current);
      convertTimeoutRef.current = null;
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setImage(null);
    setFileName('');
    setResults(null);
    setProgress({ stage: '', detail: '', pct: 0 });
    setConverting(false);
    setSettings(prev => resetOutputModes(prev));
  }, []);

  useEffect(() => {
    if (!show) {
      resetModalState();
    }
  }, [show, resetModalState]);

  // Auto-convert when image or settings change
  useEffect(() => {
    if (!image || !show) return;

    if (convertTimeoutRef.current) clearTimeout(convertTimeoutRef.current);

    convertTimeoutRef.current = setTimeout(() => {
      doConversion(image, settings);
    }, 300);

    return () => {
      if (convertTimeoutRef.current) clearTimeout(convertTimeoutRef.current);
    };
  }, [image, settings, show]);

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

  const doConversion = useCallback(async (img: HTMLImageElement, s: ConverterSettings) => {
    if (fontBitsRef.current.length === 0) {
      try {
        fontBitsRef.current = getROMFontBits('upper').bits;
      } catch { return; }
    }
    const conversionId = ++conversionIdRef.current;
    setConverting(true);
    try {
      const output = await convertImage(img, s, fontBitsRef.current, (stage, detail, pct) => {
        if (conversionId !== conversionIdRef.current) {
          return;
        }
        setProgress({ stage, detail, pct });
      });
      if (conversionId !== conversionIdRef.current) {
        return;
      }
      setResults(output);
    } catch (err) {
      console.error('Conversion failed:', err);
    } finally {
      if (conversionId === conversionIdRef.current) {
        setConverting(false);
      }
    }
  }, []);

  const loadImageFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        setImage(img);
        setFileName(file.name.replace(/\.[^.]+$/, ''));
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    loadImageFile(file);
  }, [loadImageFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (file && /^image\/(jpeg|png|gif|webp)/.test(file.type)) {
      loadImageFile(file);
    }
  }, [loadImageFile]);

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
    setSettings(prev => {
      const next = { ...prev, [key]: value } as ConverterSettings;
      if (!next.outputStandard && !next.outputEcm && !next.outputMcm) {
        return prev;
      }
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
    const fb = resultToFramebuf(result);
    (dispatch as any)(ReduxRoot.actions.importFramebufsAppend([fb]));
    dispatch(Toolbar.actions.setShowImageConverter(false));
  }, [dispatch]);

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
  const showStandardPreview = Boolean(results?.standard) || Boolean(image && settings.outputStandard);
  const showEcmPreview = Boolean(results?.ecm) || Boolean(image && settings.outputEcm);
  const showMcmPreview = Boolean(results?.mcm) || Boolean(image && settings.outputMcm);
  const standardPending = getPendingPreviewState('standard', converting, progress);
  const ecmPending = getPendingPreviewState('ecm', converting, progress);
  const mcmPending = getPendingPreviewState('mcm', converting, progress);

  if (!show) return null;

  return (
    <Modal showModal={show} width={1080}>
      <div className={styles.container}>
        <h3 className={styles.title}>Convert Image to PETSCII</h3>

        <div className={styles.topRow}>
          {/* File Selection / Reference Image */}
          <div className={styles.dropZoneWrapper}>
            <div
              className={`${styles.dropZone} ${image ? styles.dropZoneHasImage : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={handleFileSelect}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.gif,.webp"
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
          <fieldset className={styles.settings}>
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
            <fieldset className={styles.bgPanel}>
              <legend>Background</legend>
              <div className={styles.bgSwatches}>
                <button
                  className={`${styles.bgAuto} ${settings.manualBgColor === null ? styles.active : ''}`}
                  onClick={() => updateSetting('manualBgColor', null)}
                >auto</button>
                {activePalette.hex.map((hex, i) => (
                  <button
                    key={i}
                    className={`${styles.bgSwatch} ${settings.manualBgColor === i ? styles.active : ''}`}
                    style={{ backgroundColor: hex }}
                    onClick={() => updateSetting('manualBgColor', i)}
                    title={`Color ${i}`}
                  />
                ))}
              </div>
            </fieldset>

            <fieldset className={styles.outputPanel}>
              <legend>PETSKII Output</legend>
              <div className={styles.outputSection}>
                <label className={styles.modeOption}>
                  <input
                    type='checkbox'
                    checked={settings.outputStandard}
                    onChange={(e) => updateOutputMode('outputStandard', e.target.checked)}
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

        {/* Progress */}
        {converting && (
          <div className={styles.progressContainer}>
            <div className={styles.progressLabel}>
              {progress.stage} {progress.detail}
            </div>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${progress.pct}%` }} />
            </div>
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
                  <canvas
                    ref={stdCanvasRef}
                    width={320}
                    height={200}
                    className={styles.previewCanvas}
                  />
                  <button
                    className={styles.importBtn}
                    onClick={() => handleImport(results.standard)}
                  >Import Standard</button>
                </>
              ) : (
                <div className={styles.previewPlaceholder}>
                  <div className={styles.previewPlaceholderInner}>
                    <div className={styles.previewPlaceholderLabel}>{standardPending.label}</div>
                    <div className={styles.previewPlaceholderDetail}>{standardPending.detail}</div>
                    <div className={styles.previewPlaceholderBar}>
                      <div className={styles.previewPlaceholderFill} style={{ width: `${standardPending.pct}%` }} />
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
                  <canvas
                    ref={ecmCanvasRef}
                    width={320}
                    height={200}
                    className={styles.previewCanvas}
                  />
                  <button
                    className={styles.importBtn}
                    onClick={() => handleImport(results.ecm)}
                  >Import ECM</button>
                </>
              ) : (
                <div className={styles.previewPlaceholder}>
                  <div className={styles.previewPlaceholderInner}>
                    <div className={styles.previewPlaceholderLabel}>{ecmPending.label}</div>
                    <div className={styles.previewPlaceholderDetail}>{ecmPending.detail}</div>
                    <div className={styles.previewPlaceholderBar}>
                      <div className={styles.previewPlaceholderFill} style={{ width: `${ecmPending.pct}%` }} />
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
                  <canvas
                    ref={mcmCanvasRef}
                    width={320}
                    height={200}
                    className={styles.previewCanvas}
                  />
                  <button
                    className={styles.importBtn}
                    onClick={() => handleImport(results.mcm)}
                  >Import MCM</button>
                  <div className={styles.previewNote}>
                    BG {results.mcm.backgroundColor}, MC1 {results.mcm.mcmSharedColors[0] ?? 0}, MC2 {results.mcm.mcmSharedColors[1] ?? 0}
                  </div>
                </>
              ) : (
                <div className={styles.previewPlaceholder}>
                  <div className={styles.previewPlaceholderInner}>
                    <div className={styles.previewPlaceholderLabel}>{mcmPending.label}</div>
                    <div className={styles.previewPlaceholderDetail}>{mcmPending.detail}</div>
                    <div className={styles.previewPlaceholderBar}>
                      <div className={styles.previewPlaceholderFill} style={{ width: `${mcmPending.pct}%` }} />
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
