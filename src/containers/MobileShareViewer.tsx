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
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [crtFilter, setCrtFilter] = useState<CrtFilter>('none');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLandscape, setIsLandscape] = useState(window.matchMedia('(orientation: landscape)').matches);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const gestureRef = useRef<{
    active: boolean;
    startDistance: number;
    startZoom: number;
    startMidX: number;
    startMidY: number;
    startPanX: number;
    startPanY: number;
  }>({
    active: false,
    startDistance: 0,
    startZoom: 1,
    startMidX: 0,
    startMidY: 0,
    startPanX: 0,
    startPanY: 0
  });

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

  useEffect(() => {
    if (!isFullscreen) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      gestureRef.current.active = false;
    }
  }, [isFullscreen]);

  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el || !isFullscreen) {
      return;
    }

    const distance = (t1: Touch, t2: Touch) => {
      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      return Math.hypot(dx, dy);
    };
    const midpoint = (t1: Touch, t2: Touch) => ({
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2
    });

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) {
        return;
      }
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const mid = midpoint(t1, t2);
      gestureRef.current = {
        active: true,
        startDistance: distance(t1, t2),
        startZoom: zoom,
        startMidX: mid.x,
        startMidY: mid.y,
        startPanX: pan.x,
        startPanY: pan.y
      };
      e.preventDefault();
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!gestureRef.current.active || e.touches.length !== 2) {
        return;
      }
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = distance(t1, t2);
      const mid = midpoint(t1, t2);
      const g = gestureRef.current;
      const nextZoom = Math.max(1, Math.min(6, g.startZoom * (dist / g.startDistance)));
      setZoom(nextZoom);
      setPan({
        x: g.startPanX + (mid.x - g.startMidX),
        y: g.startPanY + (mid.y - g.startMidY)
      });
      e.preventDefault();
    };

    const onTouchEnd = () => {
      if (gestureRef.current.active) {
        gestureRef.current.active = false;
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);

    return () => {
      el.removeEventListener('touchstart', onTouchStart as EventListener);
      el.removeEventListener('touchmove', onTouchMove as EventListener);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [isFullscreen, zoom, pan.x, pan.y]);

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
  // In fullscreen, compute canvas size to fill viewport while preserving aspect ratio
  const canvasStyle = useMemo(() => {
    if (!isFullscreen) return undefined;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.min(vw / dims.imgWidth, vh / dims.imgHeight);
    return {
      width: dims.imgWidth * scale,
      height: dims.imgHeight * scale,
      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
    };
  }, [isFullscreen, dims.imgWidth, dims.imgHeight, pan.x, pan.y, zoom]);

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
      <div ref={canvasWrapRef} className={s.canvasWrap}>
        <canvas
          ref={canvasRef}
          className={canvasClass}
          style={canvasStyle}
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
