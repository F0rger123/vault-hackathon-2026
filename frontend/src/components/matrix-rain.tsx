"use client";

import { useEffect, useRef } from "react";
import { cx } from "./ui";

const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜ0123456789VAULT";
const CELL = 16;
const FPS = 14;

/** Falling type, drawn behind the interface. Decoration only: it says nothing about what the agents are doing. */
export function MatrixRain({ className, fps = FPS }: { className?: string; fps?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let drops: number[] = [];
    let colors = { paper: "#000", ink: "#fff", green: "#0f6", muted: "#888" };

    const readColors = () => {
      const css = getComputedStyle(canvas);
      const v = (n: string) => css.getPropertyValue(n).trim();
      colors = { paper: v("--paper"), ink: v("--ink"), green: v("--green"), muted: v("--muted") };
    };
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      const columns = Math.ceil(width / CELL);
      drops = Array.from({ length: columns }, () => Math.floor((Math.random() * height) / CELL));
      ctx.font = `13px ${getComputedStyle(canvas).getPropertyValue("--font-data") || "monospace"}, monospace`;
    };
    const draw = () => {
      // Painting the page colour thinly over the last frame is what leaves each column's fading tail.
      ctx.globalAlpha = 0.09;
      ctx.fillStyle = colors.paper;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
      for (let i = 0; i < drops.length; i++) {
        const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        const roll = Math.random();
        ctx.fillStyle = roll < 0.012 ? colors.green : roll < 0.12 ? colors.ink : colors.muted;
        ctx.fillText(glyph, i * CELL, drops[i] * CELL);
        if (drops[i] * CELL > canvas.height && Math.random() > 0.975) drops[i] = 0;
        else drops[i] += 1;
      }
    };

    readColors();
    resize();
    const sizer = new ResizeObserver(resize);
    sizer.observe(canvas);
    const theme = new MutationObserver(() => {
      readColors();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    let timer: ReturnType<typeof setInterval> | undefined;
    if (reduced) {
      for (let i = 0; i < 40; i++) draw();
    } else {
      timer = setInterval(() => {
        if (!document.hidden) draw();
      }, 1000 / fps);
    }
    return () => {
      if (timer) clearInterval(timer);
      sizer.disconnect();
      theme.disconnect();
    };
  }, [fps]);

  return <canvas ref={ref} aria-hidden className={cx("pointer-events-none block", className)} />;
}
