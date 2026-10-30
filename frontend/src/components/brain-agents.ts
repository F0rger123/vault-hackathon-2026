import * as THREE from "three";
import type { Activity } from "@/lib/agent-activity";

const SPEED = 2.4; // fractions of the space's radius per second
const TOUCH_S = 0.75;

interface Agent {
  mesh: THREE.Mesh;
  beam: THREE.Line;
  home: THREE.Vector3;
  queue: Activity[];
  job: Activity | null;
  target: THREE.Vector3 | null;
  touching: number;
}

/**
 * F10.16: the agents as small craft in the brain. Each flies to the document a recorded event names, holds a beam on it
 * while it "touches" it, and moves on. Agents only ever fly because of a recorded event.
 */
export function createSwarm({
  scene,
  radius,
  docPosition,
  onTouch,
}: {
  scene: THREE.Scene;
  radius: number;
  docPosition: (documentId: number) => THREE.Vector3 | null;
  onTouch: (activity: Activity, label: string) => void;
}) {
  const agents = new Map<string, Agent>();
  const geometry = new THREE.OctahedronGeometry(Math.max(2.5, radius * 0.012));
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const green = new THREE.MeshBasicMaterial({ color: 0x00e676 });
  const beamMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  const lane = new Map<string, number>();

  const make = (key: string, material: THREE.Material): Agent => {
    const angle = agents.size * 2.399963; // golden angle, so the craft wait evenly spaced around the core
    const home = new THREE.Vector3(Math.cos(angle), Math.sin(agents.size * 1.3) * 0.35, Math.sin(angle)).multiplyScalar(radius * 0.32);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(home);
    const beamGeometry = new THREE.BufferGeometry().setFromPoints([home, home]);
    const beam = new THREE.Line(beamGeometry, beamMaterial);
    beam.visible = false;
    beam.frustumCulled = false;
    scene.add(mesh, beam);
    const agent: Agent = { mesh, beam, home, queue: [], job: null, target: null, touching: 0 };
    agents.set(key, agent);
    return agent;
  };

  const readerKey = (a: Activity, slots: number) => {
    const name = a.lane ?? "";
    const turn = lane.get(name) ?? 0;
    lane.set(name, turn + 1);
    return { key: `reader:${name}:${turn % slots}`, label: `Reader ${(turn % slots) + 1}` };
  };

  const labels = new Map<string, string>();

  return {
    feed(a: Activity, slots = 1) {
      if (a.document_id == null || !docPosition(a.document_id)) return;
      let key = a.worker as string;
      let label = a.worker === "security" ? "Security gate" : "Reviewer";
      if (a.worker.startsWith("reader:")) ({ key, label } = readerKey(a, slots));
      labels.set(key, label);
      const agent = agents.get(key) ?? make(key, a.worker.startsWith("reader:") ? white : green);
      // During a fast replay a craft keeps only its next jobs, so it never falls behind the record.
      if (agent.queue.length < 3) agent.queue.push(a);
    },
    update(dt: number) {
      for (const [key, agent] of agents) {
        if (!agent.job && agent.queue.length) {
          agent.job = agent.queue.shift()!;
          agent.target = docPosition(agent.job.document_id!);
          agent.touching = 0;
        }
        const goal = agent.target ?? agent.home;
        const away = goal.clone().sub(agent.mesh.position);
        const step = SPEED * radius * dt;
        if (away.length() > step) agent.mesh.position.addScaledVector(away.normalize(), step);
        else agent.mesh.position.copy(goal);
        agent.mesh.rotation.y += dt * 2.5;
        agent.mesh.rotation.x += dt * 1.1;

        if (agent.job && agent.target && away.length() <= step) {
          if (agent.touching === 0) onTouch(agent.job, labels.get(key) ?? "Agent");
          agent.touching += dt;
          // The craft hovers just off the document; the beam is what reaches it.
          agent.beam.visible = true;
          const offset = new THREE.Vector3(0, radius * 0.05, 0);
          agent.mesh.position.copy(agent.target).add(offset);
          (agent.beam.geometry as THREE.BufferGeometry).setFromPoints([agent.mesh.position, agent.target]);
          if (agent.touching >= TOUCH_S) {
            agent.job = null;
            agent.target = null;
            agent.beam.visible = false;
          }
        }
      }
    },
    dispose() {
      for (const agent of agents.values()) {
        scene.remove(agent.mesh, agent.beam);
        agent.beam.geometry.dispose();
      }
      geometry.dispose();
      white.dispose();
      green.dispose();
      beamMaterial.dispose();
    },
  };
}
