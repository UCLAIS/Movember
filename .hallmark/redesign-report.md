# Leaderboard redesign

The user chose off-white and ink navy. The campaign is treated as an app screen, with the standings leading and the original copy, routes, data calls and photograph retained. The shared palette also reaches the sign-up page. No public wording was changed.

Hallmark app-scope checks: 0 Floor failures, 0 Reflex findings, 0 warnings. Tested at 320, 375, 414, 768, 1024, 1280 and 1920px, with additional 1440px captures. Populated, empty and failed sample states, plus the sign-up page, were checked. Synthetic data remained in a local read-only preview.

Wiring: 11/11 links, 6/6 script hooks, 3/3 headings and 1/1 figures retained. The inline scripts, API routes and owner access checks were compared with the previous commit and are unchanged. All 21 application tests pass. The production team list was not edited.

Fresh-context review: fix. Both findings resolved in the confirming screenshots: persistent underlines make society names recognisable as links, and footer guides fit at the narrowest widths. A tabular-figure warning was also fixed. No findings were waived.

The local before-and-after comparison is `.hallmark/compare.html`. Screenshots and raw records are ignored by Git. There are no new asset slots to fill; the existing campus photograph and sign-up image remain. A photograph of actual society fundraising would be the most useful future replacement for the campus image.
