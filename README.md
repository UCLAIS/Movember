# Fundraising reader

A plain HTML page, inline CSS/JavaScript, and a dependency-free Cloudflare Worker.

Movember is pre-connected to https://uk.movember.com/team/2492140. Paste a JustGiving team, fundraiser or campaign URL into the other connector. Both read public HTML; no API key or donor account is needed.

## Run

`npm run dev` starts a local HTTP server. `npm run build` packages the Worker. There are no dependencies to install.

## Endpoint

`GET /api/totals?platform=movember&url=https%3A%2F%2Fuk.movember.com%2Fteam%2F2492140`

Use `platform=justgiving` for the other connector. Returns integer minor currency units, currency, people, peopleLabel, sourceUrl, checkedAt and freshness status. Host/path are validated on requests and redirects. Response size and request time are capped. A 60-second memory cache is shared per Worker instance; browser storage retains the last successful reading across visits. Neither is a durable server database.

Movember reads the current campaign headline and explicit numMembers metadata. Last year's total is separate. JustGiving reads the exact donation summary aggregate, excluding separately reported Gift Aid. Teams show member counts; campaigns show fundraisers. Individuals show supporters when published, otherwise donations explicitly labelled as such. Missing counts remain unavailable. GBP/EUR and explicitly prefixed USD/CAD/AUD are supported. Ambiguous dollar currencies are rejected.

Public page layouts can change or block server requests. Failures are explicit and never converted to zero. No donor lists are retained. A JustGiving API adapter would be a future option for a supported long-term integration.
