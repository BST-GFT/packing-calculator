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
npm install      # creates node_modules and package-lock.json
npm run dev      # local page at http://localhost:5173
npm test         # engine tests (Node's built-in runner, no extra packages)
npm run typecheck
npm run build    # output in dist/
```

## Branches and publishing

- Never commit straight to `main`. Work on `develop`.
- Every push to `develop` runs `.github/workflows/ci.yml`: install, tests,
  type-check, build.
- A pull request from `develop` into `main` publishes: merging runs
  `deploy.yml`, which deploys to GitHub Pages.
- Not done yet: in the GitHub repo, Settings > Pages > Source must be set to
  "GitHub Actions" before the first publish. Nothing has been merged to `main`.
- `package-lock.json` is committed, so the workflows install with `npm ci`.

## Layout

| Path | Contents |
| --- | --- |
| `src/engine/` | The calculation. Pure TypeScript, no React, fully tested |
| `src/data/boxes.ts` | Stock boxes, internal loss, box penalty |
| `src/data/shipping.ts` | Weight and size limits and cubed-weight rule per shipping mode |
| `src/App.tsx`, `src/ui/` | The page |
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

- One product per calculation. Big orders are never mixed in a box.
- Units may be turned any way by default. "Manter em pé" keeps the height
  vertical, for liquids and fragile items.
- Box sizes may be mixed in one order.
- Default box choice is "balanced": least total volume, where each extra box
  must save at least `BOX_PENALTY_LITERS` (12) to be worth it. Least volume
  alone gave bad answers, such as 19 medium boxes instead of 9 large to save
  10% of volume. "Fewest boxes" and "least volume" are offered as alternatives
  on the page when they differ.
- Static page on GitHub Pages from a public repo. No server, no login. Anyone
  with the link may open it.
- No third-party packing library. pyshipping is unmaintained and its packing
  code is licensed for research use only.
- The box measurements in `src/data/boxes.ts` are internal (Francesco measured
  a box, 2026-10-08), so `DEFAULT_LOSS_CM` is 0. The page still lets users set
  a loss for padding or a looser fit.
- Transportadora allows 25 kg per box; Correios stays at 30 kg (2026-10-08).
- The "Envio" settings start folded on every screen size; they are set once
  and rarely change.
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

Its 3D step-by-step view was adopted later as the 3D view with a layer
slider. Left out so far: several products packed together in one
calculation, a "cannot stack on top" option, and editing box sizes on the
page. Its packing method (one orientation per box, plain grid, largest
box first) fits fewer units than this engine and was not reused.

## Open questions

Marked `TO CONFIRM` or `TO CALIBRATE` in `src/data/`. Ask before assuming:

1. Which cubed-weight factor do the carriers in use apply? 300 kg/m³ is set;
   parcel carriers often use 167.
2. For Correios, is cubed weight ignored up to 5 kg or up to 10 kg? Sources
   disagree; 5 is set because it never underestimates.
3. Does sales need several products in one calculation? A middle option is
   several products per order, each packed in its own boxes, with combined
   totals.
4. How much volume is one extra box worth (`BOX_PENALTY_LITERS`)? A cost per
   box plus freight would replace the guess: every box can take a `costBRL`
   and the engine already has a lowest-cost priority.

## Known limits

- Layer packing is a strong heuristic, not a proof of the maximum. It does not
  find interlocked "pinwheel" layouts, so a layer can be one unit short.
- The calculation is geometric only: no fragility, crushing or bulging.
- Orders above 2,000,000 units are bulk-filled before the exact search, so the
  box mix is near-best rather than exact at that size.
- The 3D view is not drawn above 20,000 units per box (`MAX_3D`); a short
  note points to the layer drawings instead.
- The page has been checked with Barlow loaded in a desktop browser, including
  phone-width emulation (375 and 320 px), but not on a real phone. The 3D
  view's touch handling in particular has only been tested with a mouse.
