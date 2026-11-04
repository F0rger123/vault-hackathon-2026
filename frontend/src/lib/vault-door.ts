/**
 * F09.22: the vault door that opens on a granted face sign-in. The wheel spins, the bolts retract, then the door swings
 * open on its hinge and the app is behind it. Plain DOM rather than React, so it outlives the sign-in screen it
 * covers: the app renders underneath while the door is still on top. With reduced motion it is a short fade.
 *
 * The markup is a fixed string written here (no user data), and the element removes itself when it is done.
 */
const BOLTS = Array.from({ length: 8 }, (_, i) => i * 45);

const DOOR = `
<svg class="vd-svg" viewBox="-110 -110 220 220" aria-hidden="true">
  <defs>
    <radialGradient id="vd-steel" cx="38%" cy="32%" r="80%">
      <stop offset="0" stop-color="#3a3a3a"/><stop offset="0.55" stop-color="#1b1b1b"/><stop offset="1" stop-color="#0b0b0b"/>
    </radialGradient>
    <linearGradient id="vd-rim" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5a5a5a"/><stop offset="1" stop-color="#151515"/>
    </linearGradient>
  </defs>
  <circle r="104" fill="#050505" stroke="#262626" stroke-width="2"/>
  <g class="vd-door">
    <g class="vd-bolts">${BOLTS.map(
      (a) => `<g transform="rotate(${a})"><rect class="vd-bolt" x="-6" y="-108" width="12" height="26" rx="2" fill="#b5b5b5" stroke="#00e676" stroke-width="1"/></g>`,
    ).join("")}</g>
    <circle r="92" fill="url(#vd-steel)" stroke="url(#vd-rim)" stroke-width="5"/>
    <circle r="78" fill="none" stroke="#2c2c2c" stroke-width="1.5"/>
    <circle r="70" fill="none" stroke="#00e676" stroke-width="2" class="vd-ring" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" transform="rotate(-90)"/>
    <g class="vd-wheel">
      <circle r="40" fill="none" stroke="#9a9a9a" stroke-width="5"/>
      ${[0, 60, 120].map((a) => `<rect x="-3" y="-52" width="6" height="104" rx="3" fill="#7a7a7a" transform="rotate(${a})"/>`).join("")}
      ${[0, 60, 120, 180, 240, 300].map((a) => `<circle cx="0" cy="-52" r="6" fill="#b5b5b5" transform="rotate(${a})"/>`).join("")}
    </g>
    <circle r="16" fill="#f4f4f4"/>
    <circle cy="-3" r="4.6" fill="#000"/><path d="M-2.7 0h5.4l1.4 8h-8.2z" fill="#000"/>
  </g>
</svg>
<p class="vd-label">Access granted</p>`;

export function playVaultDoor(onOpen: () => void | Promise<void>): void {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = document.createElement("div");
  el.className = reduce ? "vault-door vault-door-reduced" : "vault-door";
  el.setAttribute("role", "status");
  el.setAttribute("aria-label", "Access granted. Opening VAULT.");
  el.innerHTML = DOOR;
  document.body.appendChild(el);
  const unlock = reduce ? 350 : 1500; // wheel spin and bolts, then the door swings
  const gone = reduce ? 700 : 2700;
  window.setTimeout(() => {
    void Promise.resolve(onOpen()).catch(() => {});
    el.classList.add("vault-door-open");
  }, unlock);
  window.setTimeout(() => el.remove(), gone);
}
