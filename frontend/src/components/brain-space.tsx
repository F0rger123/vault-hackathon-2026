"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { activityOf, laneSlots, replayDelays, type Activity } from "@/lib/agent-activity";
import type { ActivityEvent, AgentEvent, BrainGraph, BrainNode } from "@/lib/api";
import { humanize } from "@/lib/format";
import { documentIds, moves } from "@/lib/live-activity";
import { createSwarm } from "./brain-agents";
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
const REPLAY_SECONDS = 45;
const STARS = 1400;
const SPARKS = 240;
const EXTRAS = 400; // new nodes for files stored or copies written since the map was drawn
const VISIT = 8; // documents one helper craft visits for one recorded row
const LINEUP = 10; // documents the Sorter's ranking lines up
const LINEUP_MS = { out: 700, hold: 2600, back: 700 };

/** A node the map did not have when it was drawn: a file just stored, or a copy just written. */
interface Birth {
  key: string;
  kind: "stored" | "copy";
  label: string;
  /** The document a copy was made from, so it appears beside it with a link. */
  source?: number;
}

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
    fill: { document: muted, project: c("--ink"), doc_type: c("--blue"), part: c("--amber"), marking: c("--green") },
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
  events,
  runId,
  running,
  activity,
  liveFrom = Number.MAX_SAFE_INTEGER,
  side,
  compact = false,
  highlight,
  lit,
  resetKey,
  caption,
}: {
  graph: BrainGraph;
  onOpenDocument: (id: number) => void;
  onUnsupported?: () => void;
  /** The recorded events of the latest run in this collection; the agents fly only from these. */
  events?: AgentEvent[];
  runId?: number | null;
  running?: boolean;
  /** F10.22: the collection's activity feed. Rows with an id above `liveFrom` play once, as they arrive. */
  activity?: ActivityEvent[];
  liveFrom?: number;
  /** Shown beside the space, under the selection: the activity ticker. */
  side?: React.ReactNode;
  /** F10.25: the space alone, for the brain beside Ask Keeper (no filters, search or side list). */
  compact?: boolean;
  /** Documents to mark as cited: drawn larger, bright and named. */
  highlight?: number[];
  /** Documents a helper touched, with the colour (hex) of that helper. */
  lit?: Map<number, number>;
  /** When this changes (a new reply), marks left by the previous one are cleared. */
  resetKey?: string | null;
  /** One line over the space, such as "Live: Keeper's reply". */
  caption?: string;
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
  const api = useRef<{
    paint: () => void;
    reset: () => void;
    focus: (id: string) => void;
    play: (a: Activity, slots?: number) => void;
    act: (e: ActivityEvent, motion: boolean) => void;
    clear: () => void;
  } | null>(null);
  // Nodes added from the feed survive a redraw of the map (the map is drawn again when a run finishes).
  const births = useRef<Birth[]>([]);
  const feedRef = useRef<HTMLOListElement>(null);
  const [replaying, setReplaying] = useState(false);
  // The scene reads these on its own schedule, so it keeps the latest values in a ref.
  const cited = useMemo(() => new Set(highlight ?? []), [highlight]);
  // Only the first few cited documents carry their names, so a long answer does not bury the space in labels.
  const named = useMemo(() => new Set((highlight ?? []).slice(0, 6)), [highlight]);
  const state = useRef({ shown, selected, find, onOpenDocument, onUnsupported, cited, named, lit });
  useEffect(() => {
    state.current = { shown, selected, find, onOpenDocument, onUnsupported, cited, named, lit };
    api.current?.paint();
  }, [shown, selected, find, onOpenDocument, onUnsupported, cited, named, lit]);

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
    scene.add(new THREE.AmbientLight(0xffffff, 2.2));
    // Depth: far points that drift with the camera. Decoration, not data.
    const starPositions = new Float32Array(STARS * 3);
    for (let i = 0; i < STARS; i++) {
      const dir = new THREE.Vector3().randomDirection().multiplyScalar(radius * (2 + Math.random() * 3));
      starPositions.set([dir.x, dir.y, dir.z], i * 3);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const starMaterial = new THREE.PointsMaterial({ color: 0x8a8a8a, size: 1.4, sizeAttenuation: false, fog: false });
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);

    // When an agent touches a document, sparks run from it along its real links.
    const sparkPositions = new Float32Array(SPARKS * 3).fill(1e7);
    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute("position", new THREE.BufferAttribute(sparkPositions, 3));
    const sparkMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 3, sizeAttenuation: false, fog: false, transparent: true, blending: THREE.AdditiveBlending });
    const sparkPoints = new THREE.Points(sparkGeometry, sparkMaterial);
    sparkPoints.frustumCulled = false;
    scene.add(sparkPoints);
    const sparks: { from: THREE.Vector3; to: THREE.Vector3; t: number; slot: number }[] = [];
    let sparkSlot = 0;
    const flashes = new Map<string, number>();
    const touched = new Set<string>();

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.4, 0.5);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
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
    controls.autoRotateSpeed = 0.15; // F12.17: a slow idle turn only
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
      const { shown: on, selected: sel, find: q, cited: marked, named, lit: tinted } = state.current;
      const isCited = (b: Body) => b.document_id != null && marked.has(b.document_id);
      const match = q.trim().toLowerCase();
      const near = sel ? (neighbours.get(sel) ?? new Set<string>()) : null;
      const lit = (id: string) => !near || id === sel || near.has(id);
      const found = (b: Body) => !!match && b.label.toLowerCase().includes(match);
      scene.background = palette.bg;
      scene.fog!.color.copy(palette.bg);

      slots = bodies.filter((b) => on[b.kind]);
      slots.forEach((b, i) => {
        const f = found(b);
        const c = isCited(b);
        const tint = b.document_id != null ? tinted?.get(b.document_id) : undefined;
        const size = b.r * (f ? 1.7 : c ? 2 : b.id === sel || b === hovered ? 1.35 : tint !== undefined ? 1.4 : 1);
        m4.compose(b.p, one, s3.setScalar(size));
        mesh.setMatrixAt(i, m4);
        tmp.copy(b.conflict ? palette.red : palette.fill[b.kind]);
        if (touched.has(b.id)) tmp.lerp(palette.ink, 0.75);
        if (tint !== undefined) tmp.setHex(tint);
        if (c) tmp.lerp(palette.ink, 0.25);
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
        const wanted = on[b.kind] && (b.kind !== "document" || b.id === sel || b === hovered || found(b) || (b.document_id != null && named.has(b.document_id)));
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
    // F10.22: nodes born from the feed (a file stored, a copy written) and the links from a copy to its source.
    const extraMaterial = new THREE.MeshBasicMaterial();
    const extraMesh = new THREE.InstancedMesh(sphere, extraMaterial, EXTRAS);
    extraMesh.count = 0;
    extraMesh.frustumCulled = false;
    scene.add(extraMesh);
    const linkPositions = new Float32Array(EXTRAS * 6);
    const linkGeometry = new THREE.BufferGeometry();
    linkGeometry.setAttribute("position", new THREE.BufferAttribute(linkPositions, 3));
    linkGeometry.setDrawRange(0, 0);
    const linkMaterial = new THREE.LineBasicMaterial({ color: 0x00e676, transparent: true, opacity: 0.7 });
    const links = new THREE.LineSegments(linkGeometry, linkMaterial);
    links.frustumCulled = false;
    scene.add(links);
    const extras: { birth: Birth; p: THREE.Vector3; r: number; born: number; tag: CSS2DObject }[] = [];
    const extraByKey = new Map<string, (typeof extras)[number]>();
    let linkCount = 0;
    const green = new THREE.Color(0x00e676);
    const drawExtras = (clock: number) => {
      let moving = false;
      extras.forEach((x, i) => {
        const age = (clock - x.born) / 900;
        if (age < 1) moving = true;
        const grow = age >= 1 ? 1 : 0.2 + 0.8 * (1 - Math.pow(1 - Math.max(age, 0), 3)) + 0.9 * Math.sin(Math.PI * Math.max(age, 0));
        m4.compose(x.p, one, s3.setScalar(x.r * grow));
        extraMesh.setMatrixAt(i, m4);
        extraMesh.setColorAt(i, x.birth.kind === "copy" ? green : palette.ink);
      });
      extraMesh.count = extras.length;
      extraMesh.instanceMatrix.needsUpdate = true;
      if (extraMesh.instanceColor) extraMesh.instanceColor.needsUpdate = true;
      return moving;
    };
    let extrasMoving = false;
    const born = (birth: Birth, animate: boolean) => {
      if (extraByKey.has(birth.key) || extras.length >= EXTRAS) return null;
      const source = birth.source != null ? (byId.get(`doc:${birth.source}`) ?? extraByKey.get(`doc:${birth.source}`)) : undefined;
      const n = extras.length;
      const p = source
        ? source.p.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(radius * 0.07 + RADIUS.document * 3))
        : // New files gather on a ring around the space until VAULT reads them and they join their clusters.
          new THREE.Vector3(Math.cos(n * 2.399963), ((n % 9) - 4) * 0.035, Math.sin(n * 2.399963)).multiplyScalar(radius * 1.08);
      const el = document.createElement("div");
      const span = document.createElement("span");
      span.textContent = birth.label;
      span.className = cx("block max-w-[220px] truncate whitespace-nowrap font-mono text-[10px]", birth.kind === "copy" ? "text-[#00e676]" : "text-ink");
      span.style.marginLeft = "14px";
      span.style.textShadow = "0 0 3px var(--raised), 0 0 3px var(--raised)";
      el.appendChild(span);
      const tag = new CSS2DObject(el);
      tag.center.set(0, 0.5);
      tag.position.copy(p);
      scene.add(tag);
      const x = { birth, p, r: RADIUS.document * (birth.kind === "copy" ? 0.9 : 1.1), born: animate ? performance.now() : -1e9, tag };
      extras.push(x);
      extraByKey.set(birth.key, x);
      // Only the newest few keep their names on screen, so a big import does not bury the space in labels.
      extras.forEach((e, i) => (e.tag.visible = i >= extras.length - 6));
      if (source && linkCount < EXTRAS) {
        linkPositions.set([source.p.x, source.p.y, source.p.z, p.x, p.y, p.z], linkCount * 6);
        linkCount += 1;
        linkGeometry.setDrawRange(0, linkCount * 2);
        linkGeometry.attributes.position.needsUpdate = true;
        if (animate) {
          sparks.push({ from: source.p, to: p, t: 0, slot: sparkSlot });
          sparkSlot = (sparkSlot + 1) % SPARKS;
        }
      }
      extrasMoving = drawExtras(performance.now()) || animate;
      return x;
    };
    // Rebuilding the map keeps what the feed already added, except files that are now read and have their own node.
    births.current = births.current.filter((b) => !(b.kind === "stored" && byId.has(b.key)));
    for (const b of births.current) born(b, false);

    // F10.22: the Sorter's ranking. The touched documents line up across the view in the order it produced, then
    // return to their places.
    let lineup: { bodies: Body[]; from: THREE.Vector3[]; to: THREE.Vector3[]; t0: number; tags: CSS2DObject[] } | null = null;
    const endLineup = () => {
      if (!lineup) return;
      lineup.bodies.forEach((b, i) => b.p.copy(lineup!.from[i]));
      for (const t of lineup.tags) {
        scene.remove(t);
        t.element.remove();
      }
      lineup = null;
      paint();
    };
    const startLineup = (ids: number[]) => {
      endLineup();
      const ranked = ids.map((id) => byId.get(`doc:${id}`)).filter((b): b is Body => !!b).slice(0, LINEUP);
      if (ranked.length < 2) return;
      const dist = camera.position.distanceTo(controls.target);
      const centre = controls.target.clone().lerp(camera.position, 0.35);
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const across = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
      // A tall phone screen ranks top to bottom; a wide one left to right.
      const axis = camera.aspect < 1 ? camera.up.clone().normalize().negate() : across;
      const span = dist * 0.65 * 0.55 * (camera.aspect < 1 ? 1 : Math.min(camera.aspect, 1.6));
      const to = ranked.map((_, i) => centre.clone().addScaledVector(axis, -span / 2 + (span * i) / (ranked.length - 1)));
      const tags = ranked.map((b, i) => {
        const el = document.createElement("div");
        el.className = "whitespace-nowrap font-mono text-[10px] text-ink";
        el.style.marginLeft = "12px";
        el.style.textShadow = "0 0 3px var(--raised), 0 0 3px var(--raised)";
        el.textContent = `${i + 1}. ${b.label.length > 26 ? `${b.label.slice(0, 25)}…` : b.label}`;
        const tag = new CSS2DObject(el);
        tag.center.set(0, 0.5);
        scene.add(tag);
        return tag;
      });
      lineup = { bodies: ranked, from: ranked.map((b) => b.p.clone()), to, t0: performance.now(), tags };
    };
    const stepLineup = (clock: number) => {
      if (!lineup) return;
      const t = clock - lineup.t0;
      const total = LINEUP_MS.out + LINEUP_MS.hold + LINEUP_MS.back;
      if (t >= total) return endLineup();
      const k =
        t < LINEUP_MS.out
          ? t / LINEUP_MS.out
          : t < LINEUP_MS.out + LINEUP_MS.hold
            ? 1
            : 1 - (t - LINEUP_MS.out - LINEUP_MS.hold) / LINEUP_MS.back;
      const e = 1 - Math.pow(1 - Math.min(Math.max(k, 0), 1), 3);
      lineup.bodies.forEach((b, i) => {
        b.p.lerpVectors(lineup!.from[i], lineup!.to[i], e);
        lineup!.tags[i].position.copy(b.p);
        lineup!.tags[i].visible = e > 0.6;
      });
      paint();
    };

    const swarm = createSwarm({
      scene,
      radius,
      docPosition: (id) => byId.get(`doc:${id}`)?.p ?? extraByKey.get(`doc:${id}`)?.p ?? null,
      onTouch: (a, who) => {
        const id = `doc:${a.document_id}`;
        if (a.verb === "copied" && a.target && a.document_id != null) {
          // The copy appears beside its source when the Organizer's craft reaches it.
          const b: Birth = { key: `copy:${a.target}`, kind: "copy", label: a.target, source: a.document_id };
          if (born(b, true)) births.current.push(b);
        }
        const body = byId.get(id);
        if (!body) return;
        if (a.who) {
          // A helper's touch lights the document; the ticker beside the space tells it in words.
          touched.add(id);
          flashes.set(id, performance.now());
          return;
        }
        touched.add(id);
        flashes.set(id, performance.now());
        for (const other of neighbours.get(id) ?? []) {
          const hub = byId.get(other);
          if (!hub) continue;
          sparks.push({ from: body.p, to: hub.p, t: 0, slot: sparkSlot });
          sparkSlot = (sparkSlot + 1) % SPARKS;
        }
        const list = feedRef.current;
        if (list) {
          const line = document.createElement("li");
          line.textContent = `${who} ${a.verb} ${body.label}`;
          list.prepend(line);
          while (list.children.length > 5) list.lastChild?.remove();
        }
      },
    });
    /** One recorded activity row, drawn. With motion off, new nodes still appear but nothing flies or lines up. */
    const act = (e: ActivityEvent, motion: boolean) => {
      const ids = documentIds(e);
      if (e.action === "stored" || e.action === "media_stored") {
        if (e.document_id == null || byId.has(`doc:${e.document_id}`)) return;
        const b: Birth = { key: `doc:${e.document_id}`, kind: "stored", label: e.detail.filename ?? `document ${e.document_id}` };
        if (born(b, motion)) births.current.push(b);
        return;
      }
      if (e.action === "copied") {
        const target = e.detail.target;
        if (!target || e.document_id == null) return;
        const reachable = byId.has(`doc:${e.document_id}`) || extraByKey.has(`doc:${e.document_id}`);
        if (!motion || !reachable) {
          const b: Birth = { key: `copy:${target}`, kind: "copy", label: target, source: e.document_id };
          if (born(b, motion)) births.current.push(b);
          return;
        }
        swarm.feed({ id: e.id, ts: e.ts, worker: "helper:Organizer", verb: "copied", document_id: e.document_id, who: e.actor, target });
        return;
      }
      if (!motion) return;
      if (e.action === "sorted") startLineup(ids);
      for (const id of ids.slice(0, e.action === "sorted" ? 3 : VISIT)) {
        swarm.feed({ id: e.id, ts: e.ts, worker: `helper:${e.actor}`, verb: e.action, document_id: id, who: e.actor });
      }
    };
    // A new Keeper reply starts from a clean space: the last reply's touched documents go back to their own colour.
    const clear = () => {
      touched.clear();
      flashes.clear();
      paint();
    };
    api.current = { paint, reset, focus, play: (a, slots) => swarm.feed(a, slots), act, clear };

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
      composer.setSize(width, height);
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

    let useBloom = true;
    let frames = 0;
    let slowSeconds = 0;
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
      swarm.update(dt);
      stepLineup(now);
      if (extrasMoving) extrasMoving = drawExtras(now);
      // Fly each spark along its link, and let a touched document swell and settle.
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.t += dt * 1.6;
        const p = s.t >= 1 ? null : step.copy(s.from).lerp(s.to, s.t);
        sparkPositions.set(p ? [p.x, p.y, p.z] : [1e7, 1e7, 1e7], s.slot * 3);
        if (!p) sparks.splice(i, 1);
      }
      sparkGeometry.attributes.position.needsUpdate = true;
      if (flashes.size) {
        const clock = performance.now();
        let settled = false;
        slots.forEach((b, i) => {
          const at = flashes.get(b.id);
          if (at === undefined) return;
          const age = (clock - at) / 900;
          if (age >= 1) {
            flashes.delete(b.id);
            settled = true;
          }
          const boost = age >= 1 ? 1 : 1 + 2.4 * (1 - age);
          m4.compose(b.p, one, s3.setScalar(b.r * boost));
          mesh.setMatrixAt(i, m4);
          mesh.setColorAt(i, tmp.copy(palette.ink));
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        // A settled document takes its own colour again (its helper's, when one touched it).
        if (settled) paint();
      }
      // A machine that cannot keep up loses the glow rather than the smoothness.
      frames += 1;
      slowSeconds += dt;
      if (frames === 40) {
        if (useBloom && slowSeconds / frames > 1 / 28) {
          useBloom = false;
          renderer.setPixelRatio(1);
          resize();
        }
        frames = 0;
        slowSeconds = 0;
      }
      if (useBloom) composer.render(dt);
      else renderer.render(scene, camera);
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
      swarm.dispose();
      if (lineup) {
        lineup.bodies.forEach((b, i) => b.p.copy(lineup!.from[i]));
        for (const t of lineup.tags) t.element.remove();
      }
      for (const x of extras) x.tag.element.remove();
      extraMesh.dispose();
      extraMaterial.dispose();
      linkGeometry.dispose();
      linkMaterial.dispose();
      composer.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      sparkGeometry.dispose();
      sparkMaterial.dispose();
      sphere.dispose();
      material.dispose();
      mesh.dispose();
      edgeGeometry.dispose();
      edgeMaterial.dispose();
      renderer.dispose();
      api.current = null;
    };
  }, [graph, neighbours]);

  // Live events play as they arrive. A finished run replays once by itself, and again from the button.
  const timers = useRef<number[]>([]);
  const playedTo = useRef(0);
  const startedRun = useRef<number | null>(null);
  const startReplay = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    const items = (events ?? []).map(activityOf).filter((a): a is Activity => a !== null && a.document_id != null);
    const delays = replayDelays(items, REPLAY_SECONDS);
    const slots = laneSlots(events ?? []);
    setReplaying(true);
    timers.current = items.map((a, i) => window.setTimeout(() => api.current?.play(a, slots.get(a.lane ?? "")), delays[i]));
    timers.current.push(window.setTimeout(() => setReplaying(false), REPLAY_SECONDS * 1000 + 800));
  };
  const replayRef = useRef(startReplay);
  useEffect(() => {
    replayRef.current = startReplay;
  });
  const hasEvents = (events?.length ?? 0) > 0;
  useEffect(() => {
    if (!hasEvents || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (running) {
      for (const e of events ?? []) {
        if (e.id <= playedTo.current) continue;
        playedTo.current = e.id;
        // Only what happens from now on flies; earlier work in this run is already done.
        const a = startedRun.current === runId ? activityOf(e) : null;
        if (a) api.current?.play(a, laneSlots(events ?? []).get(a.lane ?? ""));
      }
      startedRun.current = runId ?? null;
    } else if (startedRun.current !== runId) {
      // A finished run is not replayed by itself; the Replay button does that, labelled as a replay.
      startedRun.current = runId ?? null;
    }
  }, [events, hasEvents, running, runId]);
  useEffect(() => {
    const list = timers;
    return () => list.current.forEach((t) => window.clearTimeout(t));
  }, []);

  // F10.22: each new activity row plays once, when it arrives. Rows from before the page opened never move anything.
  // Processing reads are flown by the run's own events above, so here only helpers, copies and new files act.
  const actedTo = useRef(0);
  const actTimers = useRef<number[]>([]);
  useEffect(() => {
    if (!api.current || !activity?.length) return;
    const motion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const due = activity.filter((e) => e.id > Math.max(liveFrom, actedTo.current) && moves(e));
    if (!due.length) return;
    actedTo.current = due[due.length - 1].id;
    // Rows that arrive in one poll keep their recorded order and are spaced out a little, so each can be seen.
    due.forEach((e, i) => {
      if (i === 0) api.current?.act(e, motion);
      else actTimers.current.push(window.setTimeout(() => api.current?.act(e, motion), Math.min(i * 450, 6000)));
    });
  }, [activity, liveFrom]);
  useEffect(() => {
    const list = actTimers;
    return () => list.current.forEach((t) => window.clearTimeout(t));
  }, []);

  const lastReset = useRef(resetKey);
  useEffect(() => {
    if (lastReset.current === resetKey) return;
    lastReset.current = resetKey;
    api.current?.clear();
  }, [resetKey]);

  const sel = selected ? nodeById.get(selected) : null;
  const selDocs = sel
    ? [...(neighbours.get(sel.id) ?? [])].map((id) => nodeById.get(id)).filter((n): n is BrainNode => n?.kind === "document")
    : [];

  const space = (
    <div
      ref={wrapRef}
      className={cx(
        "space-scope relative overflow-hidden rounded-control border border-line bg-black",
        compact ? "h-[380px] sm:h-[440px]" : "h-[440px] sm:h-[620px]",
      )}
    >
      <canvas
        ref={canvasRef}
        tabIndex={0}
        className="block h-full w-full cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-ink active:cursor-grabbing"
        role="img"
        aria-label={`Map of ${graph.nodes.length} items and ${graph.edges.length} links, in 3D. Drag to look around, scroll to zoom, and with the map focused use W A S D or the arrow keys to fly, Q and E to go down and up. Use the list beside it to browse.`}
      />
      {(runId != null || caption) && (
        <div aria-hidden className="pointer-events-none absolute left-3 top-3 max-w-[70%] font-mono text-[11px] text-[#d0d0d0]">
          <p className="mb-1 text-[#00e676]">
            {caption ?? (running ? `Live: run ${runId}` : replaying ? `Replaying the record of run ${runId}` : `Record of run ${runId}`)}
          </p>
          <ol ref={feedRef} className="flex flex-col gap-0.5 [&>li]:truncate" />
        </div>
      )}
      <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-muted" aria-hidden>
        {compact
          ? "Drag to look · Scroll to zoom · Click a dot to open it"
          : "Drag to look · Scroll to zoom · Click here, then W A S D or arrows to fly · Q / E down and up"}
      </p>
    </div>
  );
  if (compact) return space;

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
        {runId != null && !running && (
          <Button type="button" variant="quiet" className="ml-auto" disabled={!hasEvents} onClick={startReplay}>
            Replay run {runId}
          </Button>
        )}
        <Button type="button" variant="quiet" className={runId != null && !running ? "" : "ml-auto"} onClick={() => api.current?.reset()}>
          Reset view
        </Button>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        {space}
        <div className="flex min-w-0 flex-col gap-3 lg:max-h-[620px]">
        <aside className={cx("flex flex-col gap-2 overflow-auto rounded-control border border-line p-3 text-sm", side ? "max-h-56 shrink-0" : "max-h-[560px]")}>
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
        {side}
        </div>
      </div>
      {graph.documents_shown < graph.documents_total && (
        <p className="text-xs text-muted">
          Showing {graph.documents_shown} of {graph.documents_total} documents, so the space stays quick to draw.
        </p>
      )}
    </div>
  );
}
