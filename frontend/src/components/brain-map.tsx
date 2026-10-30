"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BrainGraph, BrainNode } from "@/lib/api";
import { humanize } from "@/lib/format";
import { cx, inputClass } from "./ui";

type Kind = BrainNode["kind"];
const KIND_LABEL: Record<Kind, string> = {
  document: "Documents",
  project: "Projects",
  doc_type: "Document types",
  part: "Parts",
  marking: "Markings",
};
// Hubs sit larger than documents so the structure reads before the detail.
const RADIUS: Record<Kind, number> = { document: 3.5, project: 9, doc_type: 8, part: 5, marking: 6 };

interface Sim extends BrainNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || "#888";
}

/**
 * F07.8: the brain as a map. Documents cluster around the projects, document types, parts and markings they
 * mention. Drag to move, scroll to zoom, click a hub to see its documents, click a document to open it.
 * Drawn on a canvas with a small force layout and no extra libraries.
 */
export function BrainMap({ graph, onOpenDocument }: { graph: BrainGraph; onOpenDocument: (id: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shown, setShown] = useState<Record<Kind, boolean>>({
    document: true,
    project: true,
    doc_type: true,
    part: true,
    marking: true,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const view = useRef({ x: 0, y: 0, k: 1 });
  const sim = useRef<{ nodes: Sim[]; byId: Map<string, Sim> }>({ nodes: [], byId: new Map() });

  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of graph.edges) {
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    }
    return m;
  }, [graph]);

  // Lay the graph out once per graph: hubs on a ring, documents near their first hub, then settle.
  useEffect(() => {
    const hubs = graph.nodes.filter((n) => n.kind !== "document");
    const nodes: Sim[] = graph.nodes.map((n, i) => {
      const h = hubs.indexOf(n);
      const angle = h >= 0 ? (h / Math.max(hubs.length, 1)) * Math.PI * 2 : i * 2.399;
      const r = h >= 0 ? 260 : 120 + (i % 9) * 18;
      return { ...n, x: Math.cos(angle) * r, y: Math.sin(angle) * r, vx: 0, vy: 0 };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const n of nodes) {
      if (n.kind !== "document") continue;
      const first = [...(neighbours.get(n.id) ?? [])].map((id) => byId.get(id)).find(Boolean);
      if (first) {
        n.x = first.x * 0.6 + (Math.random() - 0.5) * 60;
        n.y = first.y * 0.6 + (Math.random() - 0.5) * 60;
      }
    }
    sim.current = { nodes, byId };
    for (let step = 0; step < 220; step++) tick(nodes, byId, graph.edges, 1 - step / 240);
    draw();
    // draw reads refs only; it is stable for this graph
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, neighbours]);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, selected, find]);

  const visible = (n: BrainNode) => shown[n.kind];
  const match = find.trim().toLowerCase();

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const v = view.current;
    ctx.translate(width / 2 + v.x, height / 2 + v.y);
    ctx.scale(v.k, v.k);
    const color = {
      line: cssVar(canvas, "--line-strong"),
      ink: cssVar(canvas, "--ink"),
      muted: cssVar(canvas, "--muted"),
      red: cssVar(canvas, "--redline"),
      green: cssVar(canvas, "--green"),
      amber: cssVar(canvas, "--amber"),
      blue: cssVar(canvas, "--blue"),
    };
    const fill: Record<Kind, string> = {
      document: color.muted,
      project: color.ink,
      doc_type: color.blue,
      part: color.green,
      marking: color.amber,
    };
    const { nodes, byId } = sim.current;
    const near = selected ? (neighbours.get(selected) ?? new Set<string>()) : null;
    const lit = (id: string) => !near || id === selected || near.has(id);

    ctx.lineWidth = 0.6 / v.k;
    for (const e of graph.edges) {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b || !visible(a) || !visible(b)) continue;
      ctx.globalAlpha = near ? (lit(a.id) && lit(b.id) ? 0.9 : 0.05) : 0.35;
      ctx.strokeStyle = color.line;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (const n of nodes) {
      if (!visible(n)) continue;
      const found = match && n.label.toLowerCase().includes(match);
      ctx.globalAlpha = lit(n.id) || found ? 1 : 0.15;
      ctx.fillStyle = n.conflict ? color.red : fill[n.kind];
      const r = RADIUS[n.kind] + (n.kind === "document" ? 0 : Math.min(8, Math.sqrt(n.weight)));
      ctx.beginPath();
      ctx.arc(n.x, n.y, found ? r + 3 : r, 0, Math.PI * 2);
      ctx.fill();
      if (found || n.id === selected) {
        ctx.strokeStyle = color.ink;
        ctx.lineWidth = 2 / v.k;
        ctx.stroke();
      }
      if (n.kind !== "document" || n.id === selected || found) {
        ctx.fillStyle = color.ink;
        ctx.font = `${n.kind === "document" ? 10 : 12}px Inter, system-ui, sans-serif`;
        ctx.fillText(n.kind === "doc_type" ? humanize(n.label) : n.label, n.x + r + 3, n.y + 4);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Pan, zoom and click.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let drag: { x: number; y: number; moved: boolean } | null = null;
    const toWorld = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const v = view.current;
      return { x: (ev.clientX - rect.left - rect.width / 2 - v.x) / v.k, y: (ev.clientY - rect.top - rect.height / 2 - v.y) / v.k };
    };
    const down = (ev: MouseEvent) => (drag = { x: ev.clientX, y: ev.clientY, moved: false });
    const move = (ev: MouseEvent) => {
      if (!drag) return;
      const dx = ev.clientX - drag.x;
      const dy = ev.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      view.current.x += dx;
      view.current.y += dy;
      drag.x = ev.clientX;
      drag.y = ev.clientY;
      draw();
    };
    const up = (ev: MouseEvent) => {
      const wasDrag = drag?.moved;
      drag = null;
      if (wasDrag) return;
      const p = toWorld(ev);
      let best: Sim | null = null;
      let bestD = 12 / view.current.k;
      for (const n of sim.current.nodes) {
        if (!shown[n.kind]) continue;
        const d = Math.hypot(n.x - p.x, n.y - p.y) - RADIUS[n.kind];
        if (d < bestD) {
          best = n;
          bestD = d;
        }
      }
      if (best?.kind === "document" && best.document_id) onOpenDocument(best.document_id);
      setSelected(best && best.kind !== "document" ? best.id : null);
    };
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault();
      view.current.k = Math.min(4, Math.max(0.25, view.current.k * (ev.deltaY < 0 ? 1.12 : 1 / 1.12)));
      draw();
    };
    canvas.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    const resize = new ResizeObserver(() => draw());
    resize.observe(canvas);
    return () => {
      canvas.removeEventListener("mousedown", down);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      canvas.removeEventListener("wheel", wheel);
      resize.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, onOpenDocument]);

  const sel = selected ? sim.current.byId.get(selected) : null;
  const selDocs = sel
    ? [...(neighbours.get(sel.id) ?? [])].map((id) => sim.current.byId.get(id)).filter((n): n is Sim => n?.kind === "document")
    : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Show on the map" className="flex flex-wrap gap-1">
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={shown[k]}
              onClick={() => setShown((s) => ({ ...s, [k]: !s[k] }))}
              className={cx(
                "rounded-control border px-2.5 py-1 text-sm",
                shown[k] ? "border-ink bg-ink text-panel" : "border-line bg-panel text-muted hover:text-ink",
              )}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <input
          className={cx(inputClass, "max-w-56")}
          placeholder="Find a part, project or file"
          aria-label="Find on the map"
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <canvas
          ref={canvasRef}
          className="h-[520px] w-full cursor-grab rounded-control border border-line bg-raised active:cursor-grabbing"
          role="img"
          aria-label={`Map of ${graph.nodes.length} items and ${graph.edges.length} links. Use the list beside it to browse.`}
        />
        <aside className="flex max-h-[520px] flex-col gap-2 overflow-auto rounded-control border border-line p-3 text-sm">
          {sel ? (
            <>
              <p className="font-medium">
                {sel.kind === "doc_type" ? humanize(sel.label) : sel.label}
                {sel.conflict && <span className="ml-2 text-redline">conflicting values</span>}
              </p>
              <p className="text-xs text-muted">
                {KIND_LABEL[sel.kind].replace(/s$/, "")} in {selDocs.length} document{selDocs.length === 1 ? "" : "s"}
              </p>
              <ul className="flex flex-col gap-1">
                {selDocs.map((d) => (
                  <li key={d.id}>
                    <button type="button" className="text-left text-blue underline-offset-4 hover:underline" onClick={() => onOpenDocument(d.document_id!)}>
                      {d.label}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-muted">
              Click a project, part, marking or document type to list its documents. Click a small dot to open that
              document. Red parts have conflicting values across documents.
            </p>
          )}
        </aside>
      </div>
      {graph.documents_shown < graph.documents_total && (
        <p className="text-xs text-muted">
          Showing {graph.documents_shown} of {graph.documents_total} documents, so the map stays quick to draw.
        </p>
      )}
    </div>
  );
}

/** One step of a small force layout: linked nodes pull together, every node pushes its neighbours away. */
function tick(nodes: Sim[], byId: Map<string, Sim>, edges: { source: string; target: string }[], heat: number) {
  for (const e of edges) {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const pull = ((d - 40) / d) * 0.02 * heat;
    a.vx += dx * pull;
    a.vy += dy * pull;
    b.vx -= dx * pull;
    b.vy -= dy * pull;
  }
  // Repulsion on a coarse grid keeps this fast for a few hundred nodes.
  const cell = 60;
  const grid = new Map<string, Sim[]>();
  for (const n of nodes) {
    const key = `${Math.floor(n.x / cell)}:${Math.floor(n.y / cell)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(n);
  }
  for (const n of nodes) {
    const cx0 = Math.floor(n.x / cell);
    const cy0 = Math.floor(n.y / cell);
    for (let gx = cx0 - 1; gx <= cx0 + 1; gx++)
      for (let gy = cy0 - 1; gy <= cy0 + 1; gy++)
        for (const m of grid.get(`${gx}:${gy}`) ?? []) {
          if (m === n) continue;
          const dx = n.x - m.x;
          const dy = n.y - m.y;
          const d2 = dx * dx + dy * dy || 1;
          if (d2 > cell * cell) continue;
          const push = (120 / d2) * heat;
          n.vx += dx * push;
          n.vy += dy * push;
        }
  }
  for (const n of nodes) {
    n.vx -= n.x * 0.002 * heat;
    n.vy -= n.y * 0.002 * heat;
    n.vx *= 0.6;
    n.vy *= 0.6;
    n.x += n.vx;
    n.y += n.vy;
  }
}
