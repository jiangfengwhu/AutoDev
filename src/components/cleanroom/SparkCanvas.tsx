import { useEffect, useRef } from 'react';

interface SparkCanvasProps {
  active: boolean;
  intensity?: 'normal' | 'rework';
}

interface SparkParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

const SPARK_COLORS_NORMAL = ['#F59E0B', '#FBBF24', '#38BDF8', '#60A5FA'];
const SPARK_COLORS_REWORK = ['#F59E0B', '#FB923C', '#EF4444', '#38BDF8'];

/**
 * Restrained 60fps micro-spark emitter for ST-02 Code Workshop.
 * Only spawns fine parabolic amber-gold & electric-blue welding sparks while
 * `active` is true; cleanly extinguishes and stops RAF when idle.
 */
export function SparkCanvas({ active, intensity = 'normal' }: SparkCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (!active || reducedMotion) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    let rafId = 0;
    const particles: SparkParticle[] = [];
    const palette = intensity === 'rework' ? SPARK_COLORS_REWORK : SPARK_COLORS_NORMAL;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let lastTime = performance.now();
    let spawnCarry = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const width = canvas.clientWidth || 260;
      const height = canvas.clientHeight || 42;
      ctx.clearRect(0, 0, width, height);

      // Restrained spawn rate (around 14–18 fine sparks/sec)
      spawnCarry += dt * (intensity === 'rework' ? 19 : 14);
      while (spawnCarry >= 1) {
        spawnCarry -= 1;
        // Emit near left/right terminal seam or bottom rim
        const originX =
          Math.random() < 0.55
            ? width * (0.28 + Math.random() * 0.44)
            : width * (0.14 + Math.random() * 0.72);
        const originY = height * (0.18 + Math.random() * 0.25);
        const angle = -Math.PI * (0.2 + Math.random() * 0.6);
        const speed = 38 + Math.random() * 68;
        particles.push({
          x: originX,
          y: originY,
          vx: Math.cos(angle) * speed * (Math.random() < 0.5 ? -1 : 1) * 0.75,
          vy: -Math.abs(Math.sin(angle) * speed * 0.55) - 10,
          life: 0,
          maxLife: 0.36 + Math.random() * 0.32,
          size: 1.2 + Math.random() * 1.4,
          color: palette[Math.floor(Math.random() * palette.length)],
        });
      }

      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i];
        p.life += dt;
        if (p.life >= p.maxLife) {
          particles.splice(i, 1);
          continue;
        }
        // Parabolic gravity decay
        p.vy += 210 * dt;
        const prevX = p.x;
        const prevY = p.y;
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        const alpha = Math.max(0, 1 - p.life / p.maxLife);
        ctx.save();
        ctx.globalAlpha = alpha * 0.92;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();

        // Crisp bright spark tip
        ctx.fillStyle = '#FFFFFF';
        ctx.globalAlpha = alpha * 0.8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.45, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [active, intensity]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-0 bottom-0 h-11 w-full transition-opacity duration-300 ${
        active ? 'opacity-100' : 'opacity-0'
      }`}
    />
  );
}
