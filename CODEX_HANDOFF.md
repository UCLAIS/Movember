# Continue this project in Codex

This is the complete source of Yash's fundraising leaderboard, exported from commit `aead71860134d03931c577872407d115816aabab`. The existing live site is https://fundraising-reader-yash.itsyashn.chatgpt.site/.

## Start locally

Use Node.js 24 or later and npm. Open this folder as a local project in Codex, then run:

```sh
npm ci
node --test
node scripts/restore-team-snapshot.mjs
npm run dev
```

Open http://localhost:3000. The snapshot restore is optional, imports only into the local SQLite database and refuses to overwrite an existing local list. `npm run build` produces the deployable Worker under `dist/`.

Local preview deliberately does not allow administrator sign-in or trust identity headers supplied by a caller. The backend owner flows are covered by tests that exercise explicit synthetic identities against a temporary database. Do not add an unauthenticated admin bypass to make the preview editable.

## Current behaviour and accepted requirements

- A simple, lightweight HTML/CSS/JavaScript frontend. No frontend framework and no hosted runtime package dependencies.
- The leaderboard is public and read-only. Only the owner can add, edit or remove approved teams through the separate admin interface.
- Movember and JustGiving connectors fetch totals from public pages once on each webpage load. Reloading the page updates the totals. Ranking controls sort the loaded data; there is no refresh button, timer, tab-return refresh or Last checked column. No successful app cache is reused. A failed upstream read may display an explicitly stale result, which is excluded from rankings.
- Rank by money raised or explicit team-member count. Equal values share competition ranks. Different currencies rank separately. Donors and donations are not team members.
- Movember uses the current campaign headline total and explicit `numMembers` metadata, not previous-year fundraising.
- JustGiving uses the exact donation summary total, excluding separately reported estimated Gift Aid.
- Admin entry `/admin/login` verifies the owner session and shows a visible owner-confirmation page. Existing owner sessions need not prompt for a password again. `/admin` and every write independently check authorisation.
- The team manager uses separate team-name and fundraising-link inputs, plus individual Add/Edit/Remove controls. Names are optional and at most 80 characters. Blank names use the source page's name.
- Saved entries are `{name, url}` objects. Existing string-only records are normalised without rewriting them. At most 30 distinct approved URLs are allowed.
- Tests cover ranking, extraction failures, no-cache behaviour, reload-only client fetching, authorisation, spoofed client identity at the deployed gateway, CSRF rejection, concurrency, persistence, legacy data compatibility and safe custom names. Run `node --test` for the current suite.

## Important deployment boundary

Production currently runs on Sites using a Cloudflare Worker and a D1 database. `.openai/hosting.json` identifies the existing Site and declares its logical `DB` binding. The source history is stored in [UCLAIS/Movember](https://github.com/UCLAIS/Movember) on GitHub and mirrored into the Sites-managed Git repository for publication. Pushing to GitHub now deploys the public frontend through Pages from the generated `docs/` folder; backend publication still uses Sites.

The current owner identity relies on authenticated identity headers injected and sanitised by the Sites dispatch gateway. The runtime secret `LEADERBOARD_OWNER_EMAIL` is set in the existing hosting configuration. It is intentionally NOT included in this export. No user password, access token, cookie or service-access credential is included.

### GitHub Pages frontend, 29 October 2026

The public frontend builds with `npm run build:pages` into the tracked `docs/` directory. GitHub Pages uses built-in branch deployment from `main/docs`. Run tests and regenerate/commit `docs/` before pushing frontend changes. The CLI token and connected GitHub app cannot create workflow files, so this route avoids needing broader permissions. Its custom domain is `https://novembergiving.uclai.co.uk/`. The user made the repository public and connected the domain before this deployment work. Preserve the CNAME and HTTPS settings.

Sites remains the backend for D1, live platform reads and authenticated administration. The Worker allows credential-free CORS GET reads only from `PUBLIC_SITE_ORIGIN`, for `/api/teams` and `/api/totals`. It does not permit cross-origin writes or expose the editor through Pages. The static export links owner administration to Sites. Both public pages read the current team list at load time, so manual additions do not require a new Pages build. Future backend changes still require publication through Sites; a GitHub push updates only the public frontend.

**Do not expose the unchanged Worker directly on a new public host.** Outside the trusted Sites gateway, caller-supplied identity headers are not authentication. A move to another host requires implementing and verifying an appropriate login/session system before exposing the admin page or write API. GitHub or UCL sign-in has not been implemented.

Downloading the source does not migrate production database bindings, secrets, authentication, domain routing or the live deployment. With a working Sites connection in the new Codex environment, preserve the exact existing project ID and follow the current Sites skill. If using a different host, port those services deliberately and preserve the owner-only access requirement.

## Included data and history

- `data/team-list-snapshot.json`: a point-in-time export of the public approved list and revision, not a live database connection or full database backup.
- `source-history.bundle`: the complete Git history of the exported HEAD/main branch, with no repository credential/configuration files. If desired, clone it into a separate folder with `git clone source-history.bundle ../fundraising-reader-with-history`.
- Database schema and immutable generated migration SQL/metadata are included under `db/` and `drizzle/`.
- Build output, installed packages, browser sessions and local database files are excluded. Regenerate build output and packages locally.

## Useful source files

- `worker/index.js`: both page templates, verification screen, platform adapters, request routing, authorisation, validation and ranking.
- `scripts/dev.mjs`: local HTTP server; strips caller-supplied authenticated identity headers.
- `scripts/local-d1.mjs`: Node SQLite adapter used by the local preview and tests; applies migrations at startup.
- `tests/admin.test.mjs` and `tests/leaderboard.test.mjs`: access, persistence, data and ranking checks.
- `README.md`: API contract and implementation details.

## Local Codex setup, 28 October 2026

The exported Git history and hidden `.openai/hosting.json`, `.gitignore` and `.env.example` have been restored. Sites source access was verified against the existing project at commit `aead71860134d03931c577872407d115816aabab`. The existing public deployment, database and owner secret remain hosted on Sites.

This Mac uses Codex's bundled Node.js 24 and an ignored project-local npm installation under `.local/`. Double-click `Start Local.command` to start the read-only preview at http://localhost:3000. For development commands from this folder, run `export PATH="$PWD/.local/bin:$PATH"` first, then use the npm commands above. On another machine, install Node.js 24+ and npm normally.

The exported UCL Swim Team snapshot has been restored into the local SQLite database. Local database paths now correctly handle spaces in this folder's name. Local administration remains disabled, as intended.

The public page is titled “UCL Societies’ November Giving Leaderboard”, with friendly competition and committee-forfeit copy. Its purple campus banner and clear hierarchy take inspiration from UCL's homepage; Anton headings and Overpass body text follow Movember's typography. Light and system dark palettes are supported. Assets and licences are recorded in `ASSETS.md`. Refresh behaviour follows the requirements above.

The campaign introduction presents November as our month for giving, takes inspiration from Movember's focus on men's health and welcomes a wider range of charities and causes. Everyone is welcome to participate; the copy does not claim an official Movember partnership. The standings use restrained typography, fine borders and a clear empty state.

## Suggested opening prompt

Read CODEX_HANDOFF.md and README.md, inspect the source, install dependencies and run the tests. Continue improving this existing fundraising leaderboard. Keep the leaderboard public and read-only, preserve server-side owner-only admin access, custom team names, live data refresh and both rankings. Explain any hosting or authentication migration before changing it.

## Hallmark public frontend update, 29 October 2026

The user chose off-white and ink navy. The public Pages interface now uses that consistent light palette, a compact title before the standings, ruled rows, persistent team-link underlines and mobile rows that put the society above its two figures. Red still marks the bottom-ranked teams. The existing UCL campus photograph moved beside the campaign explanation; the copy and all links remain.

The authored CSS lives in `tokens.css`, `base.css` and `public.css`. Run `npm run styles:sync` after editing it, then `node --test` and `npm run build:pages`; both build paths reject stale embedded CSS. Commit the generated `docs/` with the source. The Worker remains self-contained and dependency-free. All inline scripts, request routing, API behaviour and owner authorisation were verified unchanged. The backend was not redeployed for this frontend-only change.

Hallmark app-scope render checks passed with 0 Floor failures, 0 Reflex findings and 0 warnings, including populated, empty and failed sample states and the sign-up page. The before/after wiring check kept 11/11 links, 6/6 script hooks, 3/3 headings and 1/1 figures. A fresh-context review’s two findings were resolved: persistent society-link underlines and non-wrapping footer guides at narrow widths. Test fixtures and screenshots are local only; production team data was not edited.

The user subsequently changed the ink to UCL’s dark purple, `#361a54`, verified against current UCL colour guidance on 29 October 2026. This replaces navy for text and primary controls. Keep the off-white surfaces and red relegation tint.
