> **Updated 2026-11-03 (F10.21): the drawing-sheet pass.** Where this file says otherwise below, this note and `src/app/globals.css` win.
>
> - **Logo:** a keyhole framed by four trim marks on a solid ink tile (`components/vault-mark.tsx`, `app/icon.svg`, `app/favicon.ico` at 16/32/48 px). Keyhole = vault; trim marks = the corner marks of a drawing sheet and the frame a scanner puts round what it reads. Geometry on a 32 grid: tile rx 7, marks inset 6.5 with 5.5 arms at stroke 2.4, keyhole circle r 3.6 at (16, 13.9) over a tapered stem to y 22.6. No colour in the mark; the keyhole turns green only on hover of the wordmark link. Use `VaultLockup` (mark + wordmark) rather than rebuilding it. Never add a glow, gradient or second colour to the mark; never set the wordmark in another face.
> - **Wordmark:** `.wordmark`, Archivo 720 at width 125%, tracking 0.2em, uppercase "VAULT" as the name itself (not a label style).
> - **Type:** Archivo (variable, with width axis) for everything; IBM Plex Mono only for part numbers, file names, quotes and measured values. `.display` is Archivo 640 at width 116%, tracking -0.012em, for page titles, panel titles and big figures. Body 14px, tracking 0.004em.
> - **Drawing-sheet details (one family, used sparingly):** `.trim` puts the logo's four corner marks 5px outside a panel (every `Panel` has them); `.ruler` is an engineer's scale (8px minor, 48px major ticks) under each page title; `.sheet-grid` is the 32px drafting grid behind the sign-in and setup title areas only. The sign-in screen has a ruled title block ("Runs on / Reads with / Internet account"). Empty states show the empty trim frame. The loader is the logo's four marks lighting in turn.
> - **Face check and key phrase:** a black stage in both themes. The reticle follows the face box the model returned, one ring segment per reading needed fills (with a single frame flash) only when a reading is accepted, the check mark draws only when the server accepts, and quality cells carry a bar at the real measured value. Nothing on these screens moves without a real event. If the camera fails its checks (resolution or frame rate at start, or light/focus failing for 5 s with a face in view), set-up offers a phone passkey (QR code, the phone's own Face ID or fingerprint, stated honestly); sign-in only explains what to do, because the server never lets another step stand in for a required face check.
> - **Motion:** unchanged dial; all F10.21 motion is event-driven and switched off (or reduced to its end state) by `prefers-reduced-motion`.

> **Updated 2026-10-30 (F10.16):** the look is now black and white with falling type behind the work, mono titles, small radii, and two signals: green for live or verified and red for conflicts and denials. This replaces the blue below.

> **Updated 2026-10-30 (F10.15):** the look is now graphite with one blue accent, Inter and JetBrains Mono, larger radii and one shared easing. There is no yellow and no decorative gradient. Where this file says otherwise, the tokens in `src/app/globals.css` win.

# Design: VAULT

Read: private document-intelligence console for engineers and compliance staff who watch agents read sensitive archives. Mode: Operate. Dials: variance 3 / motion 2 / density 7.
Family: Dark technical, pushed to monochrome. Black, white and greys carry the whole interface; colour appears only when it means something (a conflict, a warning, a pass). The mood is quiet and a little withheld, like the inside of a vault.

Subject nouns: vault, keyhole, ledger, seal, redline.

Colour (dark, default)
  bg #050505 · rail #000000 · surface #0c0c0c · raised #141414 · line #1f1f1f · line-strong #2e2e2e
  ink #f5f5f5 · muted #8c8c8c · accent = ink (white buttons with black text, white focus ring)
  status only: info #8fb3e8 · success #6cc497 · warn #d9a25c · redline #f0525f (conflicts and denials)
Colour (light, opt-in): bg #fafafa · surface #ffffff · ink #0a0a0a · accent = ink (black buttons) · rail stays black.

Type      Geist for everything in the interface; Geist Mono only for part numbers, file names and verbatim quotes.
          Titles and big figures: Geist 600, tracking -0.03em. Body 14px, tracking -0.006em; meta 13px; 12px minimum.
          Scale 1.2: 12 / 13 / 14 / 17 / 20 / 24 / 29 / 35.
Logo      A vault door on a solid ink tile: a dial ring with eight bolt marks around a keyhole (`components/vault-mark.tsx`, `app/icon.svg`). The ring turns 45° on hover and swings into place on the sign-in screen.
Space     4px base: 4 8 12 16 24 32 48 64.
Radius    6 controls and tags · 10 panels and cards · 7 logo tile · 999 status dots.
Shadow    Dark: none; panels get a faint 1px top highlight. Light: one soft 1-2px shadow.
Atmosphere One faint light falls from above the work area (`.vault-glow`). Nothing else glows.
Motion    ease-out cubic-bezier(.23,1,.32,1), 150-450ms. Dial 4 of 10.
          - Each page's sections rise in once, 40 ms apart.
          - Buttons press to 97%.
          - Loading lists shimmer as skeletons, and figures count up once.
          - A running job's bar carries moving stripes, and a lane slot flashes when a real agent event lands.
          - All of it is switched off by prefers-reduced-motion.
Never     Decorative colour. Number nav items as if they were steps. Gradients beyond the single top glow.
