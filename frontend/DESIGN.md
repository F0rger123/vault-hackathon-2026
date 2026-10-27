# Design: VAULT

Read: private document-intelligence console for engineers and compliance staff who watch agents read sensitive archives. Mode: Operate. Dials: variance 3 / motion 3 / density 7.
Family: Dark technical, bent toward vault hardware: brushed steel surfaces, a brass combination dial, blueprint blue for information and redline red for conflicts.

Subject nouns: vault door, combination dial, brass, steel, drawing sheet, redline, seal.

Colour (dark, default)
  bg #0b0f14 · rail #080b0f · surface #121921 · raised #19222d · line #24303d · line-strong #344354
  ink #e7ecf2 · muted #8e9bab · brass #d9a54a (accent, primary actions, focus) · on-brass #1a1206
  info #6fa8ff · success #4cc98a · warn #f0903f · redline #ff5a6a (conflicts and denials only)
Colour (light, opt-in): bg #eceef1 · surface #ffffff · ink #121a24 · brass #9a6a14 · same roles.

Type      Archivo variable. Display: weight 650, width 118 (expanded), tracking -0.01em, for page titles, the wordmark and big figures.
          Body: Archivo 400/500 at 14px; meta 13px; 12px minimum. IBM Plex Mono only for part numbers, file names and verbatim quotes.
          Scale 1.2: 12 / 13 / 14 / 17 / 20 / 24 / 29 / 35.
Space     4px base: 4 8 12 16 24 32 48 64.
Radius    6 controls and tags · 10 panels and cards · 999 status dots and pills.
Shadow    Dark: none; panels get a 1px top highlight (inset 0 1px 0 rgb(255 255 255 / .04)). Light: 0 1px 2px ink/6%, 0 4px 12px ink/5%.
Motion    ease-out cubic-bezier(.23,1,.32,1), 150-250ms. Signature moment: a lane slot flashes brass when a real agent event lands.
Signature The brass combination-dial wordmark and the lit pipeline on the live run board.
Never     Number nav items as if they were steps. Box every element with the same outline. Use brass for anything but actions, focus and the active state.
