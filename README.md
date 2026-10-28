# Fundraising reader

A plain HTML leaderboard, a separate owner-only admin page, and a dependency-free Cloudflare Worker runtime. A small D1 table stores the approved fundraising URLs.

The leaderboard at `/` is read-only. Manage Teams opens `/admin/login`, which displays a server-verified owner confirmation before linking to the editor at `/admin`. Existing authorised sessions do not require a second password prompt. Both routes check access independently. Anonymous visitors go through platform sign-in; signed-in non-owners receive 404.

The public `/sign-up` guide explains how to create JustGiving and Movember teams, including JustGiving’s individual member pages and shared team total. Committees email their society page and team fundraising link to `president@uclai.co.uk` for manual addition. Both public pages link to the official setup guides and participating teams. The sign-up page renders the approved team links from D1 without fetching platform totals.

The owner adds one team using separate name and fundraising URL fields. Each saved team has Edit and Remove controls and a short source link. Names are optional and limited to 80 characters; a blank name uses the fundraising page name. Entries are stored as `{name, url}` objects. Old link-only records are normalised on read without rewriting them. Starts with https://uk.movember.com/team/2492140 when no list has been saved. Up to 30 pages are supported. Ties share competition ranks (1, 1, 3), and money ranks within each currency. Only explicit team-member counts enter the membership ranking.

Each page load reads the approved list from the server and makes new upstream requests. Reload the webpage to update the list and totals. Changing the ranking, returning to the tab or leaving it open does not fetch again. Requests use no-store plus no-cache request headers and responses use no-store. No successful application cache is reused, and no browser-local team list is trusted. Origin platforms control when their totals update. Failed or stale readings are explicitly labelled and excluded from rankings.

## Access

The leaderboard is intended for public viewing. Administration requires platform-authenticated identity headers and a case-insensitive match against `LEADERBOARD_OWNER_EMAIL`, configured as a runtime secret. The dispatch platform owns sign-in and sanitizes authenticated identity headers; application code never accepts an owner identity from request JSON, query strings or browser storage. Non-owners receive 404 for `/admin`. Missing owner configuration fails closed. Every PUT checks identity, same-origin requests, JSON type, payload bounds and supported URLs before writing. Revision checks prevent another tab from overwriting a newer list. All SQL values use bound parameters. Totals can be requested only for approved URLs.

Root HTML contains no editing form. User and platform text is inserted with textContent. Both HTML pages use hash-based script/style CSP and deny embedding. Service-access tokens do not grant admin identity. These controls are tested protections, not a guarantee of complete security.

## Run

Install the development dependencies, then use `npm run dev` for a local read-only preview. It applies pending generated migrations to `.local/leaderboard.sqlite` before serving and removes caller-supplied platform identity headers. `npm run db:generate` generates schema migrations. `npm run build` packages the Worker; Sites provisions D1 and applies schema migrations during publishing. No third-party package is imported by the hosted Worker.

## Endpoint

`GET /api/totals?platform=movember&url=https%3A%2F%2Fuk.movember.com%2Fteam%2F2492140`

Use `platform=justgiving` for the other connector. Returns integer minor currency units, currency, people, peopleLabel, sourceUrl, checkedAt and freshness status. `name` uses the saved display name when present; `pageName` retains the platform name. Host/path are validated on requests and redirects. Response size and request time are capped. A bounded Worker memory map retains successful readings solely for an explicitly stale failure fallback. A fresh fetch is always attempted first. `GET /api/teams` reads the shared list; `PUT /api/teams` is owner-only and takes `{teams: {name: string, url: string}[], revision: number}`. Legacy string entries are also accepted.

Movember reads the current campaign headline and explicit numMembers metadata. Last year's total is separate. JustGiving reads the exact donation summary aggregate, excluding separately reported Gift Aid. Teams show member counts; campaigns show fundraisers. Individuals show supporters when published, otherwise donations explicitly labelled as such. Missing counts remain unavailable. GBP/EUR and explicitly prefixed USD/CAD/AUD are supported. Ambiguous dollar currencies are rejected.

Public page layouts can change or block server requests. Failures are explicit and never converted to zero. No donor lists are retained. A JustGiving API adapter would be a future option for a supported long-term integration. Local development uses Node 24's environment proxy support. Run `node --test` for ranking and freshness checks.
