# Packing calculator: project context

Context for any Claude session working in this repository. The README covers
how to run the project and how the calculation works; this file covers what
was decided, what is still open, and how to work here.

## What this is

An internal Best Gift tool. Best Gift sells promotional items (brindes) to
companies. Logistics and sales type in the size and weight of one unit and the
order quantity; the page says which shipping boxes to use, how many units go in
each, how to arrange them, and what the shipment weighs.

Users are not technical. Logistics will use it on phones in the warehouse,
sales on a PC to estimate freight. The interface is in Brazilian Portuguese.

## Working with the owner

- Francesco owns the repo. He knows Python, VBA and some JavaScript and React,
  but this is his first project outside a corporate tech ecosystem. Explain
  tooling steps (git, npm, GitHub settings) plainly when they come up.
- Be concise, but do not leave out important details.
- Ask clarifying questions when the answer changes what gets built.

## Commands

```
npm install       # creates node_modules
npm run db:local  # once: creates the local test database in .wrangler/
npm run dev       # page and server at http://localhost:5173, local database
                  # (admin password for local tests: copy .dev.vars.example to .dev.vars)
npm test          # engine and proposta tests (Node's built-in runner)
npm run typecheck # generates Cloudflare's types, checks the page and the server
npm run build     # page in dist/client/, server in dist/embalagem/
npm run db:remote # applies new migrations/ to the real and preview databases (needs `npx wrangler login`)
```

## Hosting, branches and publishing

- The site runs on Cloudflare Workers (moved from GitHub Pages, 2026-10-13):
  `embalagem.bestgift.workers.dev`, Worker "embalagem" in Francesco's
  Cloudflare account. A custom address (`embalagem.bestgift.com.br`) is
  planned once Best Gift's IT can set up the domain in Cloudflare.
- Cloudflare builds on its own from the GitHub repo (Workers Builds):
  `main` is production (`npx wrangler deploy`); other branches get a Preview
  (`npx wrangler preview`, named after the branch). Previews use their own
  database, `embalagem-preview` (the `previews` block in `wrangler.jsonc`), so
  testing never touches the real propostas. `npm run db:remote` brings both
  databases up to date. A failed build does not show in Cloudflare's
  Deployments list; GitHub shows it as a failed "Workers Builds" check on the
  commit, with a link to the log.
- The old GitHub Pages address only forwards to the new one
  (`.github/workflows/deploy.yml` publishes `redirect/`).
- Never commit straight to `main`. Work on `develop`; a pull request into
  `main` publishes. Merge with "Create a merge commit", not squash.
- Every push to `develop` runs `.github/workflows/ci.yml`: install, tests,
  type-check, build.
- `package-lock.json` is committed, so the workflows install with `npm ci`.
- Files attached to freight (the carriers' quotes) are kept in R2, Cloudflare's
  file storage: bucket `embalagem-anexos`, and `embalagem-anexos-preview` for
  previews (`r2_buckets` in `wrangler.jsonc`). Francesco enabled R2 with a card
  on 2026-10-14; the free tier covers 10 GB. Both buckets must exist before a
  build that binds them, or the build fails.
- Version: `version` in `package.json`, shown in the bottom right corner of the
  page ("v0.9" for 0.9.0). Raise it with each batch of changes that goes to
  `main`: the last number for fixes, the middle one for new features. 0.9.0
  was the first (2026-10-14).
- Secrets live in Cloudflare's settings for the Worker, never in the repo,
  which is public. The only one is `ADMIN_PASSWORD`, set by Francesco in the
  dashboard (Worker embalagem → Settings → Variables and Secrets); the
  preview has its own (`npx wrangler preview secret put ADMIN_PASSWORD --name
  develop`). Locally it comes from `.dev.vars`, which is gitignored. Never
  ask for, print or commit the real one.

## Layout

| Path | Contents |
| --- | --- |
| `src/engine/` | The calculation. Pure TypeScript, no React, fully tested |
| `src/engine/shipment.ts` | Plans an order of one or more products; mixes leftovers |
| `src/engine/mixed.ts` | Packs several products into one box, unit by unit |
| `src/engine/support.ts` | The rule that no unit hangs over empty space |
| `src/data/boxes.ts` | Factory settings: stock boxes, internal loss, box penalty |
| `src/data/shipping.ts` | Factory settings: weight and size limits and cubed-weight rule per shipping mode |
| `src/data/products.ts` | Factory settings: how much weight a fragile product can carry (`FRAGILE_LOAD`) |
| `src/settings/` | The settings in use: their format and checks (`readSettings`, shared with the server), and `SettingsProvider`, which loads them once for every screen |
| `src/App.tsx` | Picks the screen from the address: start, new proposta, list, saved proposta, admin |
| `src/ui/` | The page; `Calculator.tsx` the calculator, `Products.tsx` the product list, `ShipmentLabel.tsx` the plan, `ProposalList.tsx` the saved propostas, `Admin.tsx` the admin area |
| `src/proposal/` | What a saved proposta keeps and its checks (shared with the server), the plan summary, calls to the server; `freight.ts` the freight and its checks |
| `src/ui/Freight.tsx` | The "Frete" section: carrier, prices, quote date, tracking code, attached quote |
| `src/data/freight.ts` | Factory carriers and the charge factor (1.4) |
| `src/admin/api.ts` | The admin area's calls to the server, and keeping the login for the browser tab |
| `worker/index.ts` | The server on Cloudflare, with the D1 database: `/api/proposals`, `/api/settings`, `/api/admin/...` |
| `worker/admin.ts` | Checking the admin password and the login token (tested in `worker/admin.test.ts`) |
| `migrations/` | The database's tables, applied in order (`npm run db:local`, `db:remote`) |
| `wrangler.jsonc` | Cloudflare settings: Worker name, database, which addresses reach the server |
| `src/ui/Box3D.tsx` | The 3D view of a packed box (three.js), loaded on demand |
| `src/styles.css` | All styling, plain CSS |
| `src/assets/logo.jpg` | Best Shipping logo, trimmed and scaled for the header |

## Code conventions

- Code, comments and commit messages in English. Everything the user reads on
  the page in Portuguese.
- Relative imports include the file extension (`./fit.ts`, `./App.tsx`). The
  tests run on Node's built-in type stripping, which needs it.
- Only erasable TypeScript: no enums, namespaces or parameter properties
  (`erasableSyntaxOnly` is on). Type-only imports use `import type` or an
  inline `type`.
- The engine works in whole millimetres internally to avoid rounding errors;
  its inputs and outputs are in cm and kg.
- New engine behaviour gets a test in `src/engine/engine.test.ts`. Prefer
  tests that check a layout is physically valid over tests that pin a number.
- No new dependencies without a reason. The page is React and plain CSS, plus
  three.js for the 3D view. three.js is imported only from `src/ui/Box3D.tsx`,
  which is loaded lazily so the first page load stays small.

## Design direction

The result is drawn like a shipping label: white stock, heavy rules,
condensed type (Barlow Condensed) and solid tags for the box codes. Cardboard
brown appears only in the packing drawings. Inputs stay quiet. Keep touch
targets large and numeric keyboards on phones; decimals accept a comma.

Company colours go on headings and details only, not on large areas: BEST
purple `#341F62` for titles, tags, rules and selected buttons; BEST orange
`#F16620` for the line under the header and the focus ring. Orange is too
light for small text on white. The logo sits on a white header bar, the
background it was drawn for.

## Decisions made

- An order may hold several products (2026-10-09), added with "Adicionar
  produto"; the name is optional. Each product fills its own boxes as if it
  were alone. Only the leftovers, what would go in each product's partly
  filled box, are mixed into shared boxes, and only when that saves boxes, or
  volume for the same number of boxes. Leftovers above 400 units in all
  (`MIX_LIMIT`) stay in their own boxes.
- A box of leftovers is emptied into the room other boxes leave when all its
  units fit there (2026-10-14, Francesco's test: 20 boxes of 17 × 39 × 18 cm
  fill five CMs only half, as a CM takes four, and 10 cups took a P of their
  own). The units already in a box stay exactly where they are, arranged as
  in that product's own boxes; the newcomers go beside or on top of them
  under every rule (support, Máx. camadas, Frágil, weight). Each time, the
  box with room for the most of them is used, so they go in as few boxes as
  possible rather than a few in each. Only leftovers move, and only to save a
  box. A box of one product takes only other products, and boxes of more
  than 1,000 units (`HOST_LIMIT`) take none, as packing around them is slow
  and units that small leave little room. Such a box is shown as mixed, with
  a note to start with its own product as usual (`base` on the line). Over
  400 random orders this saved at least one box in 179 and added one in none
  (210 boxes fewer in all), at about the same planning time.
- "Frágil" (off by default) replaced an "Outros por cima" checkbox that people
  in logistics would find hard to read (2026-10-09). In a mixed box, fragile
  products are packed after all the others, so they end up on top. Other
  products may rest on a fragile unit up to a multiple of its own weight in
  all, counted through any units in between: (Máx. camadas − 1) when that
  field is filled, so a product stacked at most 2 high carries its own weight;
  otherwise `FRAGILE_LOAD` (3), set in `src/data/products.ts` because fragile
  items usually stack 3 or 4 high without trouble (`fragileFactor` in
  `src/engine/mixed.ts`). Light products go on top of fragile ones only when the
  usual order cannot fit everything. A fragile product with no weight entered
  carries no other product. Stacking a product on itself is governed by
  "Máx. camadas" alone, which counts every unit above, whatever its product.
- Every unit off the floor rests on at least 75% of its base (`MIN_SUPPORT`),
  in single-product layouts too. Adding this cost 0.04% of capacity over 3,200
  random cases (2026-10-09).
- Units may be turned any way by default. "Em pé" keeps the height vertical,
  for liquids and fragile items.
- Box sizes may be mixed in one order.
- Default box choice is "least volume" (Francesco, 2026-10-14). It was "fewest
  boxes" from 2026-10-09, and "balanced" (least volume, each extra box worth
  `BOX_PENALTY_LITERS`) before that. Least volume can choose more, smaller
  boxes (500 mugs of 10.5 × 8 × 5 cm: 8 boxes against 6), so "Menos caixas"
  and the other choices are offered under the plan whenever they differ. With
  a cost on every box, lowest cost is the default instead.
- Propostas (2026-10-13). The site opens on "Nova proposta" / "Carregar
  proposta". A proposta is saved with a number (typed by the user, unique
  whatever its capitals or spacing), a responsável and every product named;
  none of these are needed just to calculate. It keeps the inputs as typed,
  the Envio settings used and a summary of the result, so a loaded proposta
  shows what was proposed and warns when today's calculation differs.
  What was proposed never changes: a database trigger refuses updates to
  everything but the number and responsável, and only the admin can change
  those. A loaded proposta can be saved again only under a new number.
  Loading a proposta does not change the device's own Envio choices.
- No login: anyone with the link can use the site, load and save propostas
  (Francesco, 2026-10-13).
- Freight, the "Frete" section (2026-10-14, asked for by sales). Carrier, from
  a dropdown of the carriers the admin lists; the carrier's price; the ideal
  price for the customer, the carrier's times `chargeFactor` (1.4), shown and
  never typed; the price actually charged; the day of the quote; the tracking
  code; and the carrier's quote as an image or PDF. Optional for saving a
  proposta, since a quote usually comes hours later; once a carrier is chosen
  every price and the date are needed. The tracking code is never required:
  it exists only once the package is posted, so for carriers marked as having
  one (Sedex) it shows as pending, on the proposta and in the list, until it
  is filled in (Francesco's choice over requiring it). The section is called
  "Frete" because Envio already has a mode called Transportadora.
  Freight lives apart from the proposta, which never changes: anyone with
  the link adds a version with "Atualizar frete", every version is kept, the
  newest is in use, and the database refuses changes to any version. A new
  version keeps the earlier file unless replaced or removed. A loaded
  proposta saved under a new number takes the freight on the page with it,
  file included (copied). The ideal price uses the factor in use when each
  version was saved. Deleting a proposta in the admin area deletes its
  freight and files.
- Attached files go to R2, chosen over the database and KV for room (10 GB
  free, about 40,000 screenshots) at the cost of a card on file (Francesco,
  2026-10-14). Images are scaled to at most 2000 px and saved as JPEG in the
  browser before sending (a screenshot is typically 30 to 300 KB); PDFs go as
  they are. Up to 10 MB a file. Files are served only while some freight
  version points to them, with their stored type and no guessing by the
  browser.
- Admin area (`#admin`, linked at the bottom of the start screen; 2026-10-13).
  One shared password, `ADMIN_PASSWORD`, checked on the server. Logging in
  gives a token signed with the password (HMAC), good for 12 hours and kept
  for the browser tab only; changing the password logs everyone out. Ten
  login tries a minute per connection (Cloudflare rate limiting,
  `LOGIN_LIMIT`). The admin can:
  - correct a proposta's number or responsável (the proposta then says when
    it was corrected; `corrected_at`);
  - delete a proposta for good, chosen by Francesco over hiding it: it is
    gone at once and its number is free again. Ids are never reused
    (AUTOINCREMENT), so an old link to a deleted proposta says it was not
    found instead of opening another one;
  - change the shared settings (below).
  Not built: exporting the list (offered, not chosen).
- Shared settings (2026-10-13), replacing the "no settings page" decision of
  2026-10-09. The boxes in stock, each shipping mode's weight limit, size
  limits and cubed-weight factor, the default folga, `FRAGILE_LOAD` and
  `BOX_PENALTY_LITERS` are set by the admin and apply to everyone. Each save
  is a new row in the `settings` table (newest applies, older ones are
  history). `src/data/` holds the factory values, used until the first
  save, when the saved ones fail `readSettings`, and when the server cannot
  be reached (the page then says so). The page loads the settings once and
  the calculator waits for them. The shipping modes themselves (Transportadora
  and Correios) and how their cubed weight is counted (per shipment or per
  box) are fixed in code; only their numbers are settings. Box ids are the
  name in capitals, so a box keeps its id when only its size changes.
- Each device remembers its own shipping mode, protection and boxes switched
  off, and only once someone changes them. The weight limit and folga are not
  remembered (2026-10-13): each new proposta starts from the shared settings,
  so the admin's changes reach every device.
- The page and its server run on Cloudflare Workers with a D1 database, from
  a public repo. No third-party login or tracking.
- No third-party packing library. pyshipping is unmaintained and its packing
  code is licensed for research use only.
- The box measurements in `src/data/boxes.ts` are internal (Francesco measured
  a box, 2026-10-08), so `DEFAULT_LOSS_CM` is 0. The page still lets users set
  a loss for padding or a looser fit.
- Transportadora allows 25 kg per box; Correios stays at 30 kg (2026-10-08).
- The "Envio" settings start folded on every screen size; they are set once
  and rarely change. "Frete" starts folded too, on new and saved propostas
  alike (Francesco, 2026-10-14); its summary line shows the carrier, the
  price charged and a pending tracking code.
- "Máximo de camadas" on the product is optional and empty by default (no
  limit). It caps how many units sit on top of each other. With a limit the
  units go in flat layers only, each one unit tall, so "camadas" in the result
  means the same as in the field. Arrangements with layers standing on end are
  then not used, even where their columns would be low enough (2026-10-09).
  The table and the arrangement say so when the limit cost units
  (`limitedBy: 'layers'`).
- Each box's arrangement starts with a free-spinning 3D view (three.js),
  chosen over a dependency-free fixed drawing (2026-10-08). It shows only the
  units that go in under the weight limit, and a slider builds it layer by
  layer. To keep the page scrollable, one finger turns the box sideways while
  vertical swipes scroll, two fingers zoom, and the mouse wheel zooms only
  with Ctrl held. The unit positions come from `placeUnits` in
  `src/engine/place.ts`, which is tested like the rest of the engine.

## The sales prototype

A colleague in sales built a single-file prototype with ChatGPT. It was
reviewed and these ideas were adopted: shipping mode with a weight limit per
box, protection weight per box, internal loss per box dimension, switching
boxes on and off, printing the plan, and the keep-upright option.

Adopted later: its 3D step-by-step view (as the 3D view with a layer slider),
several products in one order, and "Outros produtos por cima", later replaced
by "Frágil" with a weight allowance (see above). Left out so
far: a "Fixa" position that keeps C × L × A exactly as typed. Its editing of
box sizes on the page became the admin's shared settings rather than a
per-user choice. Its packing method (one orientation per box, plain grid,
largest box first) fits fewer units than this engine and was not reused. Its
newer version once left a unit unsupported on top; this engine's support rule
rules that out.

## Open questions

Marked `TO CONFIRM` or `TO CALIBRATE` in `src/data/`. Ask before assuming. Once
known, the admin sets them in the admin area; `src/data/` changes only if the
factory values should change too.

1. Which cubed-weight factor do the carriers in use apply? 300 kg/m³ is set;
   parcel carriers often use 167.
2. For Correios, is cubed weight ignored up to 5 kg or up to 10 kg? Sources
   disagree; 5 is set because it never underestimates.
3. How much volume is one extra box worth (`BOX_PENALTY_LITERS`)? It now only
   affects the "balanced" alternative. A cost per box plus freight would
   replace the guess: every box can take a `costBRL` and the engine already
   has a lowest-cost priority.

## Known limits

- Layer packing is a strong heuristic, not a proof of the maximum. It does not
  find interlocked "pinwheel" layouts, so a layer can be one unit short.
- Mixed boxes are packed unit by unit into the lowest free corner, trying a
  few orders. Each order is first tried with every product keeping one way of
  lying (or a free mix, if that does better), chosen by trying each one; only
  if none of those fits everything are the same orders tried with every unit
  turning freely. Choosing orientation unit by unit alone let a product spread
  over the floor every which way, so that a fragile one packed after it could
  need a bigger box (2026-10-13, test "needs no bigger box when a product is
  marked fragile"). Over 400 random mixed orders, the combined packer used 706
  boxes against 730 for unit-by-unit alone, and was worse in 6 orders, all
  needing two or more mixed boxes. It is still a heuristic: a person may find
  a tighter mixed box now and then.
- The calculation is geometric. Fragility and crushing are only what the user
  states per product (Em pé, Máx. camadas, Frágil); no bulging.
- Orders above 2,000,000 units are bulk-filled before the exact search, so the
  box mix is near-best rather than exact at that size.
- The 3D view is not drawn above 20,000 units per box (`MAX_3D`); a short
  note points to the layer drawings instead.
- Anyone with the link can attach files to freight, up to 10 MB each, so a
  stranger with the link could fill the bucket past the free 10 GB, which
  R2 would then charge for (about US$ 0.015 per GB a month). Nothing limits
  uploads yet beyond the file size.
- Anyone with the link can save propostas, so nothing stops a stranger who
  gets it from filling the list; the server only checks the shape and size of
  what is saved; the admin can delete what should not be there. The list
  shows the 50 most recent; older ones are found by searching. The server's
  routes have no automated tests; the checks they use (`src/proposal/`,
  `src/settings/`, `worker/admin.ts`) do.
- A proposta saved with boxes that the admin later removes or resizes still
  shows what it proposed; recalculated today it uses today's boxes, and the
  page says the result differs.
- The page has been checked with Barlow loaded in a desktop browser, including
  phone-width emulation (375 and 320 px), but not on a real phone. The 3D
  view's touch handling in particular has only been tested with a mouse.
