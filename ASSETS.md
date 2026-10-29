# Design references and assets

The public page takes its purple campaign block, restrained spacing and clear section hierarchy from [UCL's homepage](https://www.ucl.ac.uk/). Its condensed Anton headings and Overpass body type are informed by [Movember's homepage](https://movember.com/).

The text masthead identifies UCL societies. No official UCL or Movember logo has been recreated or added.

- Campus photograph: UCL, “Illuminated portico for UCL 200 event”, used on the UCL homepage. [Original image](https://www.ucl.ac.uk/home/sites/home/files/styles/homepage_hero_laptop/public/2026-02/200hero-wide.jpg.webp?itok=s5ETc_S8). The rendered page credits UCL.
- Anton: Google Fonts / Anton Project Authors, distributed by `@fontsource/anton` 5.3.0 under the SIL Open Font License 1.1. See `licences/Anton-OFL.txt`.
- Overpass: Overpass Project Authors / Red Hat, distributed by `@fontsource-variable/overpass` 5.3.0 under the SIL Open Font License 1.1. See `licences/Overpass-OFL.txt`.

These assets are embedded in the Worker so visitors do not make requests to third-party font or image hosts. Font licences are included in the served stylesheet as well as the source tree. Both npm font archives were checked against their registry SHA-512 integrity values before embedding.

## Local campaign redesign, 29 October 2026

The broader campaign system preserves UCL purple, Anton / Overpass typography, the existing routes and the UCL photograph. Research references include [UCL](https://www.ucl.ac.uk/), [Movember](https://movember.com/), [charity: water](https://www.charitywater.org/) and [Wellcome](https://wellcome.org/). These are design references, not claimed partners or sponsors.

`assets/connected-paper.jpg` is an illustrative studio still life generated with the built-in image_gen tool for the sign-up page. It represents connected participation rather than a real event or identifiable people. Its exact generation prompt and delivery details are in `assets/connected-paper.prompt.txt`.

The design uses shared native CSS tokens and templates across the public pages, owner verification and team manager. No external design-system package is implied. System light and dark palettes, keyboard focus states and reduced-motion preferences are respected.

## Hallmark leaderboard redesign, 29 October 2026

The public Pages site now uses the user-selected off-white and ink navy palette, with red reserved for the relegation state. Hallmark’s Sport theme informed the ruled results-sheet treatment; its volt accent and catalog fonts were replaced by the explicit palette choice and the project’s existing licensed faces. Overpass carries the interface, and Anton remains in the campaign wordmark. The display is consistently light rather than following system dark mode.

The existing campus photograph and illustrative sign-up image remain, rendered in greyscale through CSS. No new photographs, logos, figures or fundraising claims were introduced. The shared source styles are `tokens.css`, `base.css` and `public.css` and are embedded into the Worker by `scripts/sync-styles.mjs`. Public layout changes deploy through GitHub Pages; the existing Sites backend and owner sign-in are retained.

## UCL dark purple update, 29 October 2026

At the user’s request, the ink and primary controls use UCL’s current dark purple, `#361a54` (RGB 54, 26, 84), verified against the [official colour guidance](https://www.ucl.ac.uk/brand-and-experience/brand/visual-guidelines/colour). The existing off-white surfaces and red relegation state remain. Hover colours derive from the dark-purple token.
