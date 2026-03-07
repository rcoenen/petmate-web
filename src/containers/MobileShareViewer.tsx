import React, { useMemo, useRef, useEffect, useState } from 'react';
import { Framebuf, FramebufWithFont } from '../redux/types';
import { getColorPaletteById } from '../utils/palette';
import { C64_PALETTES } from '../utils/c64Palettes';
import { getROMFontBits } from '../redux/selectors';
import { framebufToPixels, computeOutputImageDims, BorderSpec } from '../utils/exporters/util';
import { CHARSET_LOWER, CHARSET_UPPER } from '../redux/editor';
import s from './MobileShareViewer.module.css';

interface MobileShareViewerProps {
  framebuf: Framebuf;
}

const MONTH_CODES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const URL_RE = /(https?:\/\/[^\s]+)/g;
const MOBILE_BORDER_SPEC: BorderSpec = { left: 24, right: 24, top: 27, bottom: 29 };

function formatDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const monthIdx = parseInt(m[2], 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) return date;
  return `${m[3]}/${MONTH_CODES[monthIdx]}/${m[1]}`;
}

function renderTextWithLinks(text: string) {
  const parts = text.split(URL_RE);
  return parts.map((part, idx) => {
    if (/^https?:\/\//.test(part)) {
      return <a key={idx} href={part} target="_blank" rel="noreferrer">{part}</a>;
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export default function MobileShareViewer({ framebuf }: MobileShareViewerProps) {
  const renderBorders = true;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLandscape, setIsLandscape] = useState(window.matchMedia('(orientation: landscape)').matches);
  const [showGrid, setShowGrid] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [paletteId, setPaletteId] = useState('colodore');

  const gestureRef = useRef<{
    active: boolean;
    startDistance: number;
    startZoom: number;
    startMidX: number;
    startMidY: number;
    startLocalX: number;
    startLocalY: number;
    baseLeft: number;
    baseTop: number;
    startPanX: number;
    startPanY: number;
    lastTapTime: number;
  }>({
    active: false,
    startDistance: 0,
    startZoom: 1,
    startMidX: 0,
    startMidY: 0,
    startLocalX: 0,
    startLocalY: 0,
    baseLeft: 0,
    baseTop: 0,
    startPanX: 0,
    startPanY: 0,
    lastTapTime: 0,
  });

  const palette = useMemo(() => getColorPaletteById(paletteId), [paletteId]);
  const font = useMemo(() => {
    const charset = framebuf.charset === CHARSET_LOWER ? CHARSET_LOWER : CHARSET_UPPER;
    return getROMFontBits(charset);
  }, [framebuf.charset]);

  const dims = useMemo(
    () => computeOutputImageDims({ ...framebuf, font } as FramebufWithFont, renderBorders, MOBILE_BORDER_SPEC),
    [framebuf, font]
  );
  const gridOverlayStyle = useMemo<React.CSSProperties>(() => {
    const borderLeft = renderBorders ? MOBILE_BORDER_SPEC.left : 0;
    const borderTop = renderBorders ? MOBILE_BORDER_SPEC.top : 0;
    const screenPixelWidth = framebuf.width * 8;
    const screenPixelHeight = framebuf.height * 8;

    return {
      left: `${(borderLeft / dims.imgWidth) * 100}%`,
      top: `${(borderTop / dims.imgHeight) * 100}%`,
      width: `${(screenPixelWidth / dims.imgWidth) * 100}%`,
      height: `${(screenPixelHeight / dims.imgHeight) * 100}%`,
      ['--grid-cols' as any]: framebuf.width,
      ['--grid-rows' as any]: framebuf.height,
    };
  }, [dims.imgHeight, dims.imgWidth, framebuf.height, framebuf.width, renderBorders]);
  const borderCssColor = useMemo(() => {
    const c = palette[framebuf.borderColor];
    return `rgb(${c.r}, ${c.g}, ${c.b})`;
  }, [palette, framebuf.borderColor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const fbWithFont: FramebufWithFont = { ...framebuf, font };
    const pixels = framebufToPixels(fbWithFont, palette, renderBorders, MOBILE_BORDER_SPEC);
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

  // Double-tap to toggle fullscreen (works in and out of fullscreen)
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    let lastTap = 0;
    const onTap = (e: TouchEvent) => {
      if (e.touches.length !== 0 || e.changedTouches.length !== 1) return;
      const now = Date.now();
      if (now - lastTap < 300) {
        toggleFullscreen();
        lastTap = 0;
      } else {
        lastTap = now;
      }
    };
    el.addEventListener('touchend', onTap);
    return () => el.removeEventListener('touchend', onTap);
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
      if (e.touches.length === 1 && zoom > 1) {
        // Single-finger pan when zoomed in
        const t = e.touches[0];
        const stageRect = stageRef.current?.getBoundingClientRect();
        gestureRef.current = {
          ...gestureRef.current,
          active: true,
          startMidX: t.clientX,
          startMidY: t.clientY,
          startLocalX: 0,
          startLocalY: 0,
          baseLeft: stageRect ? stageRect.left - pan.x : 0,
          baseTop: stageRect ? stageRect.top - pan.y : 0,
          startPanX: pan.x,
          startPanY: pan.y,
          startDistance: 0,
        };
        e.preventDefault();
        return;
      }
      if (e.touches.length !== 2) {
        return;
      }
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const mid = midpoint(t1, t2);
      const stageRect = stageRef.current?.getBoundingClientRect();
      const localX = stageRect ? (mid.x - stageRect.left) / zoom : 0;
      const localY = stageRect ? (mid.y - stageRect.top) / zoom : 0;
      gestureRef.current = {
        ...gestureRef.current,
        active: true,
        startDistance: distance(t1, t2),
        startZoom: zoom,
        startMidX: mid.x,
        startMidY: mid.y,
        startLocalX: localX,
        startLocalY: localY,
        baseLeft: stageRect ? stageRect.left - pan.x : 0,
        baseTop: stageRect ? stageRect.top - pan.y : 0,
        startPanX: pan.x,
        startPanY: pan.y,
      };
      e.preventDefault();
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!gestureRef.current.active) return;

      // Single-finger pan
      if (e.touches.length === 1 && gestureRef.current.startDistance === 0) {
        const t = e.touches[0];
        const g = gestureRef.current;
        setPan({
          x: g.startPanX + (t.clientX - g.startMidX),
          y: g.startPanY + (t.clientY - g.startMidY),
        });
        e.preventDefault();
        return;
      }

      // Two-finger pinch-zoom + pan
      if (e.touches.length !== 2) return;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = distance(t1, t2);
      const mid = midpoint(t1, t2);
      const g = gestureRef.current;
      const nextZoom = Math.max(1, Math.min(6, g.startZoom * (dist / g.startDistance)));
      setZoom(nextZoom);
      setPan({
        x: nextZoom <= 1 ? 0 : mid.x - g.baseLeft - (g.startLocalX * nextZoom),
        y: nextZoom <= 1 ? 0 : mid.y - g.baseTop - (g.startLocalY * nextZoom),
      });
      e.preventDefault();
    };

    const onTouchEnd = () => {
      gestureRef.current.active = false;
    };

    // Mouse drag for desktop
    const onMouseDown = (e: MouseEvent) => {
      if (zoom <= 1) return;
      gestureRef.current = {
        ...gestureRef.current,
        active: true,
        startMidX: e.clientX,
        startMidY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
        startDistance: 0,
      };
      e.preventDefault();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!gestureRef.current.active) return;
      const g = gestureRef.current;
      setPan({
        x: g.startPanX + (e.clientX - g.startMidX),
        y: g.startPanY + (e.clientY - g.startMidY),
      });
    };
    const onMouseUp = () => {
      gestureRef.current.active = false;
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      el.removeEventListener('touchstart', onTouchStart as EventListener);
      el.removeEventListener('touchmove', onTouchMove as EventListener);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
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
  const screenName = framebuf.metadata?.name?.trim() || 'Shared Screen';
  const author = framebuf.metadata?.author?.trim();
  const date = framebuf.metadata?.date?.trim();
  const description = framebuf.metadata?.description?.trim();
  const formattedDate = date ? formatDate(date) : undefined;
  // In fullscreen, compute canvas size to fill viewport while preserving aspect ratio
  const stageStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!isFullscreen) return undefined;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.min(vw / dims.imgWidth, vh / dims.imgHeight);
    return {
      width: dims.imgWidth * scale,
      height: dims.imgHeight * scale,
      transform: `translate(${pan.x}px, ${pan.y}px)`,
    };
  }, [isFullscreen, dims.imgWidth, dims.imgHeight, pan.x, pan.y, zoom]);
  const stageContentStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!isFullscreen) return undefined;
    return {
      transform: `scale(${zoom})`,
    };
  }, [isFullscreen, zoom]);
  const normalStageStyle = useMemo<React.CSSProperties>(() => ({
    aspectRatio: `${dims.imgWidth} / ${dims.imgHeight}`,
  }), [dims.imgHeight, dims.imgWidth]);

  return (
    <div ref={rootRef} className={`${s.page} ${isLandscape ? s.landscape : ''} ${isFullscreen ? s.fullscreen : ''}`}>
      <header className={s.headerBand}>
        <div className={s.headerInner}>
          <a
            className={s.logoLink}
            href="https://github.com/rcoenen/Petsciishop"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open Petsciishop on GitHub"
          >
            <img src={`${import.meta.env.BASE_URL}assets/petsciishop_logo.png`} alt="Petsciishop" className={s.logo} />
          </a>
          <p className={s.subtitle}>Mobile viewer only. Desktop opens the full editor.</p>
        </div>
      </header>
      <div className={s.controls}>
        <div className={s.paletteRow}>
          <span className={s.controlsLabel}>Palette</span>
          <div className={s.selectWrap}>
            <select className={s.select} value={paletteId} onChange={e => setPaletteId(e.target.value)}>
              {C64_PALETTES.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <span className={s.selectChevron} aria-hidden="true">▾</span>
          </div>
        </div>
        <div className={s.buttonRow}>
          <button
            className={`${s.button} ${showGrid ? s.buttonActive : ''}`}
            onClick={() => setShowGrid((prev) => !prev)}
            type="button"
          >
            {showGrid ? 'Hide Grid' : 'Show Grid'}
          </button>
          <button className={s.button} onClick={toggleFullscreen}>
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
        </div>
      </div>
      <div
        ref={canvasWrapRef}
        className={s.canvasWrap}
        style={{ backgroundColor: borderCssColor }}
        onDoubleClick={toggleFullscreen}
      >
        <div ref={stageRef} className={s.stage} style={isFullscreen ? stageStyle : normalStageStyle}>
          <div className={s.stageContent} style={stageContentStyle}>
            <canvas
              ref={canvasRef}
              className={s.canvas}
              width={dims.imgWidth}
              height={dims.imgHeight}
            />
            {showGrid && (
              <div
                className={s.gridOverlay}
                style={gridOverlayStyle}
              />
            )}
          </div>
        </div>
      </div>
      <div className={s.infoBlock}>
        <div className={`${s.fieldGroup} ${s.firstFieldGroup}`}>
          <div className={s.fieldLine}>
            <span className={s.fieldLabel}>Colormode:</span>{' '}
            <span className={s.fieldValue}>{mode}</span>
          </div>
        </div>
        <div className={s.fieldGroup}>
          <div className={s.fieldLine}>
            <span className={s.fieldLabel}>Name:</span>{' '}
            <span className={s.fieldValue}>{screenName}</span>
          </div>
        </div>
        {author && (
          <div className={s.fieldGroup}>
            <div className={s.fieldLine}>
              <span className={s.fieldLabel}>Author:</span>{' '}
              <span className={s.fieldValue}>{author}</span>
            </div>
          </div>
        )}
        {formattedDate && (
          <div className={s.fieldGroup}>
            <div className={s.fieldLine}>
              <span className={s.fieldLabel}>Date:</span>{' '}
              <span className={s.fieldValue}>{formattedDate}</span>
            </div>
          </div>
        )}
        {description && (
          <div className={s.fieldGroup}>
            <div className={s.fieldLine}>
              <span className={s.fieldLabel}>Description:</span>{' '}
              <span className={s.fieldValue}>{renderTextWithLinks(description)}</span>
            </div>
          </div>
        )}
      </div>
      <footer className={s.footer}>
        <div className={s.footerInner}>
          <a
            className={s.footerLink}
            href="https://github.com/rcoenen/Petsciishop"
            target="_blank"
            rel="noopener noreferrer"
          >
            github.com/rcoenen/Petsciishop
          </a>
        </div>
      </footer>
    </div>
  );
}
