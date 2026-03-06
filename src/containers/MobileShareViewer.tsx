import React, { useMemo, useRef, useEffect, useState } from 'react';
import { Framebuf, FramebufWithFont, CrtFilter } from '../redux/types';
import { getColorPaletteById } from '../utils/palette';
import { getROMFontBits } from '../redux/selectors';
import { framebufToPixels, computeOutputImageDims } from '../utils/exporters/util';
import { CHARSET_LOWER, CHARSET_UPPER } from '../redux/editor';
import s from './MobileShareViewer.module.css';

interface MobileShareViewerProps {
  framebuf: Framebuf;
}

export default function MobileShareViewer({ framebuf }: MobileShareViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [crtFilter, setCrtFilter] = useState<CrtFilter>('none');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLandscape, setIsLandscape] = useState(window.matchMedia('(orientation: landscape)').matches);

  const palette = useMemo(() => getColorPaletteById('colodore'), []);
  const font = useMemo(() => {
    const charset = framebuf.charset === CHARSET_LOWER ? CHARSET_LOWER : CHARSET_UPPER;
    return getROMFontBits(charset);
  }, [framebuf.charset]);

  const dims = useMemo(() => computeOutputImageDims({ ...framebuf, font } as FramebufWithFont, false), [framebuf, font]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const fbWithFont: FramebufWithFont = { ...framebuf, font };
    const pixels = framebufToPixels(fbWithFont, palette, false);
    const rgba = new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    const imageData = new ImageData(rgba, dims.imgWidth, dims.imgHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.putImageData(imageData, 0, 0);
  }, [framebuf, font, palette, dims.imgWidth, dims.imgHeight]);

  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const onChange = () => setIsLandscape(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    const onFs = () => setIsFullscreen(document.fullscreenElement != null);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      mq.removeEventListener('change', onChange);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, []);

  async function toggleFullscreen() {
    if (!rootRef.current) {
      return;
    }
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      if ('orientation' in screen && 'unlock' in screen.orientation) {
        screen.orientation.unlock();
      }
      return;
    }
    await rootRef.current.requestFullscreen();
    if ('orientation' in screen && 'lock' in screen.orientation) {
      try {
        await screen.orientation.lock('landscape');
      } catch {
        // Ignore unsupported/blocked orientation lock.
      }
    }
  }

  const mode = framebuf.mcmMode ? 'MCM' : framebuf.ecmMode ? 'ECM' : 'Standard';
  const screenName = framebuf.name && framebuf.name.trim() ? framebuf.name.trim() : 'Shared Screen';
  const canvasClass = [
    s.canvas,
    crtFilter === 'colorTv' ? s.crtColorTv : '',
    crtFilter === 'bwTv' ? s.crtBwTv : ''
  ].filter(Boolean).join(' ');

  return (
    <div ref={rootRef} className={`${s.page} ${isLandscape ? s.landscape : ''} ${isFullscreen ? s.fullscreen : ''}`}>
      <div className={s.header}>
        <h1 className={s.title}>{screenName}</h1>
        <p className={s.subtitle}>Read-only mobile viewer</p>
      </div>
      <div className={s.controls}>
        <span className={s.controlsLabel}>CRT mode:</span>
        <select
          className={s.select}
          value={crtFilter}
          onChange={(e) => setCrtFilter(e.target.value as CrtFilter)}
        >
          <option value='none'>Normal</option>
          <option value='scanlines'>Scanlines</option>
          <option value='colorTv'>Color TV</option>
          <option value='bwTv'>B&W TV</option>
        </select>
        <button className={s.button} onClick={toggleFullscreen}>
          {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        </button>
      </div>
      <div className={s.canvasWrap}>
        <canvas
          ref={canvasRef}
          className={canvasClass}
          width={dims.imgWidth}
          height={dims.imgHeight}
        />
        {crtFilter !== 'none' && <div className={s.scanlines} />}
      </div>
      <div className={s.meta}>
        40x25 · {mode}
      </div>
    </div>
  );
}
