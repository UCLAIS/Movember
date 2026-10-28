# Design references and assets

The public page takes its purple campaign block, restrained spacing and clear section hierarchy from [UCL's homepage](https://www.ucl.ac.uk/). Its condensed Anton headings and Overpass body type are informed by [Movember's homepage](https://movember.com/).

The text masthead identifies UCL societies. No official UCL or Movember logo has been recreated or added.

- Campus photograph: UCL, “Illuminated portico for UCL 200 event”, used on the UCL homepage. [Original image](https://www.ucl.ac.uk/home/sites/home/files/styles/homepage_hero_laptop/public/2026-02/200hero-wide.jpg.webp?itok=s5ETc_S8). The rendered page credits UCL.
- Anton: Google Fonts / Anton Project Authors, distributed by `@fontsource/anton` 5.3.0 under the SIL Open Font License 1.1. See `licences/Anton-OFL.txt`.
- Overpass: Overpass Project Authors / Red Hat, distributed by `@fontsource-variable/overpass` 5.3.0 under the SIL Open Font License 1.1. See `licences/Overpass-OFL.txt`.

These assets are embedded in the Worker so visitors do not make requests to third-party font or image hosts. Font licences are included in the served stylesheet as well as the source tree. Both npm font archives were checked against their registry SHA-512 integrity values before embedding.
