"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { BrainGraph, BrainNode } from "@/lib/api";
import { humanize } from "@/lib/format";
import { Button, cx, inputClass } from "./ui";

type Kind = BrainNode["kind"];
const KIND_LABEL: Record<Kind, string> = {
  document: "Documents",
  project: "Projects",
  doc_type: "Document types",
  part: "Parts",
  marking: "Markings",
};
// Hubs sit larger than documents so the structure reads before the detail.
const RADIUS: Record<Kind, number> = { document: 3, project: 9, doc_type: 8, part: 5, marking: 6 };
const IDLE_MS = 5000;
const FLY_SPEED = 220; // world units per second

interface Body extends BrainNode {
  p: THREE.Vector3;
  v: THREE.Vector3;
  r: number;
}

interface Palette {
  bg: THREE.Color;
  ink: THREE.Color;
  edge: THREE.Color;
  red: THREE.Color;
  fill: Record<Kind, THREE.Color>;
}

function readPalette(el: Element): Palette {
  const css = getComputedStyle(el);
  const c = (name: string) => new THREE.Color(css.getPropertyValue(name).trim() || "#888888");
  const muted = c("--muted");
  return {
    bg: c("--raised"),
    ink: c("--ink"),
    // The line token alone vanishes into the fog, so lift it a little toward muted.
    edge: c("--line-strong").lerp(muted, 0.35),
    red: c("--redline"),
    fill: { document: muted, project: c("--ink"), doc_type: c("--blue"), part: c("--green"), marking: c("--amber") },
  };
}

const label = (n: BrainNode) => (n.kind === "doc_type" ? humanize(n.label) : n.label);

/** A 3D force layout: linked nodes pull together, every node pushes the others away, all drift to the centre. */
function layout(graph: BrainGraph, neighbours: Map<string, Set<string>>): { bodies: Body[]; byId: Map<string, Body>; radius: number } {
  const hubs = graph.nodes.filter((n) => n.kind !== "document");
  // A seeded generator keeps the space the same each time the page opens.
  let seed = 2026;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  const bodies: Body[] = graph.nodes.map((n) => {
    const h = hubs.indexOf(n);
    // Hubs start on a Fibonacci sphere so no two begin in the same place.
    const t = h >= 0 ? (h + 0.5) / Math.max(hubs.length, 1) : 0;
    const phi = Math.acos(1 - 2 * t);
    const theta = Math.PI * (1 + Math.sqrt(5)) * h;
    const p =
      h >= 0
        ? new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)).multiplyScalar(260)
        : new THREE.Vector3(rand(), rand(), rand()).multiplyScalar(200);
    const r = RADIUS[n.kind] + (n.kind === "document" ? 0 : Math.min(8, Math.sqrt(n.weight)));
    return { ...n, p, v: new THREE.Vector3(), r };
  });
  const byId = new Map(bodies.map((b) => [b.id, b]));
  for (const b of bodies) {
    if (b.kind !== "document") continue;
    const first = [...(neighbours.get(b.id) ?? [])].map((id) => byId.get(id)).find(Boolean);
    if (first) b.p.copy(first.p).multiplyScalar(0.7).add(new THREE.Vector3(rand(), rand(), rand()).multiplyScalar(70));
  }
  const d = new THREE.Vector3();
  const steps = 180;
  for (let step = 0; step < steps; step++) {
    const heat = 1 - step / (steps + 20);
    for (const e of graph.edges) {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b) continue;
      d.subVectors(b.p, a.p);
      const len = d.length() || 1;
      const pull = ((len - 45) / len) * 0.02 * heat;
      a.v.addScaledVector(d, pull);
      b.v.addScaledVector(d, -pull);
    }
    // A few hundred nodes at most (the API caps documents), so plain pairwise repulsion is quick enough.
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        d.subVectors(a.p, b.p);
        const d2 = d.lengthSq() || 1;
        if (d2 > 22500) continue;
        const push = (260 / d2) * heat;
        a.v.addScaledVector(d, push);
        b.v.addScaledVector(d, -push);
      }
    }
    for (const b of bodies) {
      b.v.addScaledVector(b.p, -0.002 * heat).multiplyScalar(0.6);
      b.p.add(b.v);
    }
  }
  const radius = Math.max(120, ...bodies.map((b) => b.p.length()));
  return { bodies, byId, radius };
}

/**
 * F07.8: the brain as a space you can fly through. Documents cluster around the projects, document types, parts and
 * markings they mention. Drag to look around, scroll to zoom, W A S D or the arrow keys to fly (Q and E for down and
 * up). Click a hub to see its documents, click a document to open it. The 2D map stays as the accessible fallback.
 */
export default function BrainSpace({
  graph,
  onOpenDocument,
  onUnsupported,
}: {
  graph: BrainGraph;
  onOpenDocument: (id: number) => void;
  onUnsupported?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
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
  const api = useRef<{ paint: () => void; reset: () => void; focus: (id: string) => void } | null>(null);
  // The scene reads these on its own schedule, so it keeps the latest values in a ref.
  const state = useRef({ shown, selected, find, onOpenDocument, onUnsupported });
  useEffect(() => {
    state.current = { shown, selected, find, onOpenDocument, onUnsupported };
    api.current?.paint();
  }, [shown, selected, find, onOpenDocument, onUnsupported]);

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
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch {
      state.current.onUnsupported?.();
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    // Laid out here rather than in a memo: the scene owns and moves these positions.
    const { bodies, byId, radius } = layout(graph, neighbours);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 1, radius * 12);
    const home = new THREE.Vector3(radius * 0.3, radius * 0.35, radius * 1.55);
    camera.position.copy(home);
    scene.fog = new THREE.Fog(0x000000, radius * 1.3, radius * 4.5);
    scene.add(new THREE.AmbientLight(0xffffff, 1.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(1, 1.4, 0.8);
    scene.add(sun);

    const sphere = new THREE.SphereGeometry(1, 20, 14);
    const material = new THREE.MeshLambertMaterial();
    const mesh = new THREE.InstancedMesh(sphere, material, Math.max(bodies.length, 1));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);
    let slots: Body[] = []; // instance index to node, visible nodes only

    const edgeGeometry = new THREE.BufferGeometry();
    const edgeMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 });
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    scene.add(edges);

    const labels = new CSS2DRenderer();
    labels.domElement.style.position = "absolute";
    labels.domElement.style.inset = "0";
    labels.domElement.style.pointerEvents = "none";
    wrap.appendChild(labels.domElement);
    const tags = new Map<string, CSS2DObject>();
    const makeTag = (b: Body) => {
      const el = document.createElement("div");
      const span = document.createElement("span");
      span.textContent = label(b);
      span.className = cx(
        "block whitespace-nowrap text-ink",
        b.kind === "document" ? "text-[11px]" : "text-xs font-medium",
      );
      span.style.marginLeft = `${12 + b.r}px`;
      span.style.textShadow = "0 0 3px var(--raised), 0 0 3px var(--raised), 0 0 6px var(--raised)";
      el.appendChild(span);
      const tag = new CSS2DObject(el);
      tag.center.set(0, 0.5);
      tag.position.copy(b.p);
      tag.visible = false;
      scene.add(tag);
      tags.set(b.id, tag);
      return tag;
    };
    for (const b of bodies) if (b.kind !== "document") makeTag(b);
    let hovered: Body | null = null;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.6;
    controls.minDistance = 10;
    controls.maxDistance = radius * 6;
    controls.screenSpacePanning = true;
    controls.autoRotateSpeed = 0.35;
    // Clicking a hub glides the view to it, so the cluster comes to you.
    let glide: { from: THREE.Vector3; to: THREE.Vector3; t0: number } | null = null;
    let lastInput = performance.now();
    const touch = () => {
      lastInput = performance.now();
      glide = null;
    };
    controls.addEventListener("start", touch);

    let palette = readPalette(wrap);
    const tmp = new THREE.Color();
    const m4 = new THREE.Matrix4();
    const one = new THREE.Quaternion();
    const s3 = new THREE.Vector3();

    /** Rebuild colours, sizes, edges and labels from the current filters, selection and search. */
    const paint = () => {
      const { shown: on, selected: sel, find: q } = state.current;
      const match = q.trim().toLowerCase();
      const near = sel ? (neighbours.get(sel) ?? new Set<string>()) : null;
      const lit = (id: string) => !near || id === sel || near.has(id);
      const found = (b: Body) => !!match && b.label.toLowerCase().includes(match);
      scene.background = palette.bg;
      scene.fog!.color.copy(palette.bg);

      slots = bodies.filter((b) => on[b.kind]);
      slots.forEach((b, i) => {
        const f = found(b);
        const size = b.r * (f ? 1.7 : b.id === sel || b === hovered ? 1.35 : 1);
        m4.compose(b.p, one, s3.setScalar(size));
        mesh.setMatrixAt(i, m4);
        tmp.copy(b.conflict ? palette.red : palette.fill[b.kind]);
        if (f || b.id === sel) tmp.lerp(palette.ink, b.conflict ? 0 : 0.35);
        const dim = !lit(b.id) && !f ? 0.85 : match && !f ? 0.6 : 0;
        mesh.setColorAt(i, tmp.lerp(palette.bg, dim));
      });
      mesh.count = slots.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();

      const pos: number[] = [];
      const col: number[] = [];
      for (const e of graph.edges) {
        const a = byId.get(e.source);
        const b = byId.get(e.target);
        if (!a || !b || !on[a.kind] || !on[b.kind]) continue;
        const bright = near ? lit(a.id) && lit(b.id) : false;
        tmp.copy(palette.edge);
        if (bright) tmp.lerp(palette.ink, 0.55);
        else if (near) tmp.lerp(palette.bg, 0.8);
        pos.push(a.p.x, a.p.y, a.p.z, b.p.x, b.p.y, b.p.z);
        col.push(tmp.r, tmp.g, tmp.b, tmp.r, tmp.g, tmp.b);
      }
      edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      edgeGeometry.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      edgeGeometry.computeBoundingSphere();

      for (const b of bodies) {
        const wanted = on[b.kind] && (b.kind !== "document" || b.id === sel || b === hovered || found(b));
        const tag = tags.get(b.id) ?? (wanted ? makeTag(b) : null);
        if (!tag) continue;
        tag.visible = wanted;
        tag.element.style.opacity = !lit(b.id) && !found(b) && b !== hovered ? "0.25" : "1";
      }
    };

    const focus = (id: string) => {
      const b = byId.get(id);
      if (!b) return;
      const shift = b.p.clone().sub(controls.target);
      if (reduced.matches) {
        controls.target.add(shift);
        camera.position.add(shift);
      } else {
        glide = { from: controls.target.clone(), to: b.p.clone(), t0: performance.now() };
      }
      lastInput = performance.now();
    };
    const reset = () => {
      glide = null;
      controls.target.set(0, 0, 0);
      camera.position.copy(home);
      controls.update();
      lastInput = performance.now();
    };
    api.current = { paint, reset, focus };

    // Picking: a ray against the spheres first, then the nearest dot on screen so small documents stay easy to hit.
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const proj = new THREE.Vector3();
    const pick = (ev: PointerEvent): Body | null => {
      const rect = canvas.getBoundingClientRect();
      ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(mesh, false).find((h) => h.instanceId !== undefined && slots[h.instanceId]);
      if (hit) return slots[hit.instanceId!];
      let best: Body | null = null;
      let bestD = 10;
      for (const b of slots) {
        proj.copy(b.p).project(camera);
        if (proj.z > 1) continue;
        const d = Math.hypot(((proj.x - ndc.x) * rect.width) / 2, ((proj.y - ndc.y) * rect.height) / 2);
        if (d < bestD) {
          best = b;
          bestD = d;
        }
      }
      return best;
    };
    let down: { x: number; y: number } | null = null;
    const onDown = (ev: PointerEvent) => {
      down = { x: ev.clientX, y: ev.clientY };
      canvas.focus({ preventScroll: true }); // so the fly keys work straight after a click
      touch();
    };
    const onUp = (ev: PointerEvent) => {
      const start = down;
      down = null;
      if (!start || Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 4 || ev.button !== 0) return;
      const b = pick(ev);
      if (b?.kind === "document" && b.document_id) {
        state.current.onOpenDocument(b.document_id);
        setSelected(b.id);
      } else {
        setSelected(b ? b.id : null);
        if (b) focus(b.id);
      }
    };
    let hoverQueued = false;
    const onMove = (ev: PointerEvent) => {
      if (down || hoverQueued) return;
      hoverQueued = true;
      requestAnimationFrame(() => {
        hoverQueued = false;
        const b = pick(ev);
        if (b === hovered) return;
        hovered = b;
        canvas.style.cursor = b ? "pointer" : "";
        paint();
      });
    };
    const onLeave = () => {
      if (!hovered) return;
      hovered = null;
      canvas.style.cursor = "";
      paint();
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", touch, { passive: true });

    // Flying: keys held while the space has focus move the camera and its target together.
    const held = new Set<string>();
    const FLY_KEYS = new Set(["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
    const onKey = (ev: KeyboardEvent) => {
      const k = ev.key.toLowerCase();
      if (!FLY_KEYS.has(k) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      ev.preventDefault();
      if (ev.type === "keydown") {
        held.add(k);
        touch();
      } else held.delete(k);
    };
    const onBlur = () => held.clear();
    canvas.addEventListener("keydown", onKey);
    canvas.addEventListener("keyup", onKey);
    canvas.addEventListener("blur", onBlur);

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      labels.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const sizer = new ResizeObserver(resize);
    sizer.observe(canvas);
    resize();

    // Follow the light and dark theme, which flips data-theme on <html>.
    const theme = new MutationObserver(() => {
      palette = readPalette(wrap);
      paint();
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });

    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const step = new THREE.Vector3();
    let frame = 0;
    let last = performance.now();
    let onScreen = true;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (held.size) {
        camera.getWorldDirection(forward);
        right.crossVectors(forward, camera.up).normalize();
        step.set(0, 0, 0);
        if (held.has("w") || held.has("arrowup")) step.add(forward);
        if (held.has("s") || held.has("arrowdown")) step.sub(forward);
        if (held.has("d") || held.has("arrowright")) step.add(right);
        if (held.has("a") || held.has("arrowleft")) step.sub(right);
        if (held.has("e")) step.add(camera.up);
        if (held.has("q")) step.sub(camera.up);
        if (step.lengthSq()) {
          step.normalize().multiplyScalar(FLY_SPEED * dt * (radius / 260));
          camera.position.add(step);
          controls.target.add(step);
        }
      }
      if (glide) {
        const t = Math.min(1, (now - glide.t0) / 450);
        const e = 1 - Math.pow(1 - t, 3);
        const next = glide.from.clone().lerp(glide.to, e);
        camera.position.add(next.clone().sub(controls.target));
        controls.target.copy(next);
        if (t >= 1) glide = null;
      }
      controls.autoRotate = !reduced.matches && !held.size && !glide && now - lastInput > IDLE_MS;
      controls.update(dt);
      for (const [id, tag] of tags) {
        if (!tag.visible) continue;
        // Far labels fade with the fog so the near ones stay readable.
        const far = camera.position.distanceTo(byId.get(id)!.p) / (radius * 4);
        tag.element.style.filter = far > 0.55 ? `opacity(${Math.max(0.15, 1.3 - far * 1.4)})` : "";
      }
      renderer.render(scene, camera);
      labels.render(scene, camera);
    };
    const run = () => {
      cancelAnimationFrame(frame);
      if (document.hidden || !onScreen) return;
      last = performance.now();
      frame = requestAnimationFrame(loop);
    };
    // Stop drawing while the tab is hidden or the space is scrolled out of view.
    document.addEventListener("visibilitychange", run);
    const seen = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      run();
    });
    seen.observe(canvas);

    paint();
    run();

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", run);
      seen.disconnect();
      sizer.disconnect();
      theme.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", touch);
      canvas.removeEventListener("keydown", onKey);
      canvas.removeEventListener("keyup", onKey);
      canvas.removeEventListener("blur", onBlur);
      controls.dispose();
      for (const tag of tags.values()) tag.element.remove();
      labels.domElement.remove();
      sphere.dispose();
      material.dispose();
      mesh.dispose();
      edgeGeometry.dispose();
      edgeMaterial.dispose();
      renderer.dispose();
      api.current = null;
    };
  }, [graph, neighbours]);

  const sel = selected ? nodeById.get(selected) : null;
  const selDocs = sel
    ? [...(neighbours.get(sel.id) ?? [])].map((id) => nodeById.get(id)).filter((n): n is BrainNode => n?.kind === "document")
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
        <Button type="button" variant="quiet" className="ml-auto" onClick={() => api.current?.reset()}>
          Reset view
        </Button>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div ref={wrapRef} className="relative h-[560px] overflow-hidden rounded-control border border-line bg-raised">
          <canvas
            ref={canvasRef}
            tabIndex={0}
            className="block h-full w-full cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-ink active:cursor-grabbing"
            role="img"
            aria-label={`Map of ${graph.nodes.length} items and ${graph.edges.length} links, in 3D. Drag to look around, scroll to zoom, and with the map focused use W A S D or the arrow keys to fly, Q and E to go down and up. Use the list beside it to browse.`}
          />
          <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-muted" aria-hidden>
            Drag to look · Scroll to zoom · Click here, then W A S D or arrows to fly · Q / E down and up
          </p>
        </div>
        <aside className="flex max-h-[560px] flex-col gap-2 overflow-auto rounded-control border border-line p-3 text-sm">
          {sel && sel.kind !== "document" ? (
            <>
              <p className="font-medium">
                {label(sel)}
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
              Click a project, part, marking or document type to fly to it and list its documents. Click a small dot to
              open that document. Red parts have conflicting values across documents.
            </p>
          )}
        </aside>
      </div>
      {graph.documents_shown < graph.documents_total && (
        <p className="text-xs text-muted">
          Showing {graph.documents_shown} of {graph.documents_total} documents, so the space stays quick to draw.
        </p>
      )}
    </div>
  );
}
