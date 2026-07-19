import { useEffect, useRef } from 'react';

/**
 * Animated flowing wire/curve background — inspired by Lace.io's golden flowing lines.
 * Uses canvas for performance. Renders flowing bezier curves that animate continuously.
 */
export function FlowingWires() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let w = 0;
    let h = 0;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      w = window.innerWidth;
      h = window.innerHeight;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.scale(dpr, dpr);
    }

    interface WireCurve {
      baseY: number;
      amplitude: number;
      frequency: number;
      speed: number;
      phase: number;
      color: string;
      lineWidth: number;
      opacity: number;
    }

    // Define flowing wire curves
    const wires: WireCurve[] = [
      // Primary purple curves
      {
        baseY: 0.65,
        amplitude: 80,
        frequency: 0.003,
        speed: 0.4,
        phase: 0,
        color: '139, 92, 246',
        lineWidth: 2,
        opacity: 0.4,
      },
      {
        baseY: 0.7,
        amplitude: 60,
        frequency: 0.0025,
        speed: 0.35,
        phase: 1.2,
        color: '139, 92, 246',
        lineWidth: 1.5,
        opacity: 0.25,
      },
      // Gold/amber curves (Lace-style)
      {
        baseY: 0.75,
        amplitude: 100,
        frequency: 0.002,
        speed: 0.3,
        phase: 0.5,
        color: '217, 170, 79',
        lineWidth: 1.8,
        opacity: 0.35,
      },
      {
        baseY: 0.8,
        amplitude: 70,
        frequency: 0.0035,
        speed: 0.45,
        phase: 2.0,
        color: '245, 206, 107',
        lineWidth: 1,
        opacity: 0.2,
      },
      // Subtle pink accents
      {
        baseY: 0.6,
        amplitude: 50,
        frequency: 0.004,
        speed: 0.25,
        phase: 3.0,
        color: '236, 72, 153',
        lineWidth: 0.8,
        opacity: 0.15,
      },
      // Upper area subtle wires
      {
        baseY: 0.3,
        amplitude: 40,
        frequency: 0.003,
        speed: 0.2,
        phase: 1.5,
        color: '139, 92, 246',
        lineWidth: 0.6,
        opacity: 0.1,
      },
      {
        baseY: 0.25,
        amplitude: 35,
        frequency: 0.0028,
        speed: 0.22,
        phase: 4.0,
        color: '217, 170, 79',
        lineWidth: 0.5,
        opacity: 0.08,
      },
    ];

    function drawWire(wire: WireCurve, time: number) {
      ctx!.beginPath();

      const startX = -50;
      const endX = w + 50;
      const baseYPx = wire.baseY * h;
      const step = 4;

      for (let x = startX; x <= endX; x += step) {
        const y =
          baseYPx +
          Math.sin(x * wire.frequency + time * wire.speed + wire.phase) * wire.amplitude +
          Math.sin(x * wire.frequency * 0.5 + time * wire.speed * 0.7 + wire.phase * 1.3) *
            (wire.amplitude * 0.4);

        if (x === startX) {
          ctx!.moveTo(x, y);
        } else {
          ctx!.lineTo(x, y);
        }
      }

      // Create gradient along the wire
      const gradient = ctx!.createLinearGradient(0, 0, w, 0);
      gradient.addColorStop(0, `rgba(${wire.color}, 0)`);
      gradient.addColorStop(0.2, `rgba(${wire.color}, ${wire.opacity})`);
      gradient.addColorStop(0.5, `rgba(${wire.color}, ${wire.opacity * 1.2})`);
      gradient.addColorStop(0.8, `rgba(${wire.color}, ${wire.opacity})`);
      gradient.addColorStop(1, `rgba(${wire.color}, 0)`);

      ctx!.strokeStyle = gradient;
      ctx!.lineWidth = wire.lineWidth;
      ctx!.lineCap = 'round';
      ctx!.lineJoin = 'round';
      ctx!.stroke();
    }

    function draw() {
      timeRef.current += 0.016; // ~60fps time step
      ctx!.clearRect(0, 0, w, h);

      for (const wire of wires) {
        drawWire(wire, timeRef.current);
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    resize();
    rafRef.current = requestAnimationFrame(draw);
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 1 }}
      aria-hidden="true"
    />
  );
}
