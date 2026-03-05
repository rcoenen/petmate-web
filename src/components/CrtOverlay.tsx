import React, { useRef, useEffect, useCallback } from 'react';
import { CrtFilter } from '../redux/types';

interface CrtOverlayProps {
  width: number;
  height: number;
  filter: CrtFilter;
}

const NOISE_SIZE = 128;

function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.max(cx, cy);
  const grad = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 1.2);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.7)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function createNoiseImageData(ctx: CanvasRenderingContext2D, color: boolean): ImageData {
  const imageData = ctx.createImageData(NOISE_SIZE, NOISE_SIZE);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    if (color) {
      data[i] = Math.random() * 255;
      data[i + 1] = Math.random() * 255;
      data[i + 2] = Math.random() * 255;
    } else {
      const v = Math.random() * 255;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }
    data[i + 3] = 30;
  }
  return imageData;
}

const scanlineBackground = 'repeating-linear-gradient(to bottom, transparent 0px, transparent 1px, rgba(0,0,0,0.25) 1px, rgba(0,0,0,0.25) 2px)';

export default function CrtOverlay({ width, height, filter }: CrtOverlayProps) {
  const w = Math.round(width);
  const h = Math.round(height);

  const vignetteRef = useRef<HTMLCanvasElement>(null);
  const noiseRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  const showScanlines = filter !== 'none';
  const showVignette = filter === 'colorTv' || filter === 'bwTv';
  const showNoise = filter === 'colorTv' || filter === 'bwTv';
  const colorNoise = filter === 'colorTv';

  useEffect(() => {
    if (!showVignette || !vignetteRef.current) return;
    const ctx = vignetteRef.current.getContext('2d');
    if (ctx) drawVignette(ctx, w, h);
  }, [showVignette, w, h]);

  const animateNoise = useCallback(() => {
    if (!noiseRef.current) return;
    const ctx = noiseRef.current.getContext('2d');
    if (!ctx) return;

    const noiseData = createNoiseImageData(ctx, colorNoise);
    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = NOISE_SIZE;
    tileCanvas.height = NOISE_SIZE;
    const tileCtx = tileCanvas.getContext('2d')!;
    tileCtx.putImageData(noiseData, 0, 0);

    ctx.clearRect(0, 0, w, h);
    const pattern = ctx.createPattern(tileCanvas, 'repeat');
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
    }

    animRef.current = requestAnimationFrame(animateNoise);
  }, [colorNoise, w, h]);

  useEffect(() => {
    if (!showNoise) return;
    animRef.current = requestAnimationFrame(animateNoise);
    return () => cancelAnimationFrame(animRef.current);
  }, [showNoise, animateNoise]);

  if (filter === 'none') return null;

  const wrapperStyle: React.CSSProperties = {
    position: 'relative',
    width: `${w}px`,
    height: `${h}px`,
    marginTop: `-${h}px`,
    pointerEvents: 'none',
  };

  const layerStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: `${w}px`,
    height: `${h}px`,
    display: 'block',
  };

  return (
    <div style={wrapperStyle}>
      {showScanlines && (
        <div style={{ ...layerStyle, background: scanlineBackground }} />
      )}
      {showVignette && (
        <canvas ref={vignetteRef} width={w} height={h} style={layerStyle} />
      )}
      {showNoise && (
        <canvas ref={noiseRef} width={w} height={h} style={layerStyle} />
      )}
    </div>
  );
}
