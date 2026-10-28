# Fundraising reader

A plain HTML page, inline CSS/JavaScript, and a dependency-free Cloudflare Worker.

Starts with https://uk.movember.com/team/2492140. Paste up to 30 Movember or JustGiving links, one per line. Both connectors are detected automatically. Switch between raised and team-member rankings. Duplicate canonical URLs count once; ties share competition ranks (1, 1, 3). Money ranks within each currency. Only explicit team-member counts enter the membership ranking; donors, donations and campaign fundraisers do not.

Every page load, manual refresh, visible-tab return and 60-second refresh makes new upstream requests. Requests use no-store plus no-cache request headers and responses use no-store. No successful application cache is reused. Browser storage saves URLs only, never displayed readings. Origin platforms still control when their own totals update. Failed or stale readings are explicitly labelled and excluded from rankings.

## Run

`npm run dev` starts a local HTTP server. `npm run build` packages the Worker. There are no dependencies to install.

## Endpoint

`GET /api/totals?platform=movember&url=https%3A%2F%2Fuk.movember.com%2Fteam%2F2492140`

Use `platform=justgiving` for the other connector. Returns integer minor currency units, currency, people, peopleLabel, sourceUrl, checkedAt and freshness status. Host/path are validated on requests and redirects. Response size and request time are capped. A bounded Worker memory map retains successful readings solely for an explicitly stale failure fallback. A fresh fetch is always attempted first. There is no durable server database.

Movember reads the current campaign headline and explicit numMembers metadata. Last year's total is separate. JustGiving reads the exact donation summary aggregate, excluding separately reported Gift Aid. Teams show member counts; campaigns show fundraisers. Individuals show supporters when published, otherwise donations explicitly labelled as such. Missing counts remain unavailable. GBP/EUR and explicitly prefixed USD/CAD/AUD are supported. Ambiguous dollar currencies are rejected.

Public page layouts can change or block server requests. Failures are explicit and never converted to zero. No donor lists are retained. A JustGiving API adapter would be a future option for a supported long-term integration. Local development uses Node 24's environment proxy support. Run `node --test` for ranking and freshness checks.
