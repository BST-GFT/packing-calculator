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
- Not done yet: `package-lock.json` is not committed. Commit the one the first
  `npm install` creates; the workflows switch to `npm ci` once it exists.

## Layout

| Path | Contents |
| --- | --- |
| `src/engine/` | The calculation. Pure TypeScript, no React, fully tested |
| `src/data/boxes.ts` | Stock boxes, internal loss, box penalty |
| `src/data/shipping.ts` | Weight and size limits and cubed-weight rule per shipping mode |
| `src/App.tsx`, `src/ui/` | The page |
| `src/styles.css` | All styling, plain CSS |

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
- No new dependencies without a reason. The page is React and plain CSS only.

## Design direction

The result is drawn like a shipping label: white stock, heavy ink rules,
condensed type (Barlow Condensed) and solid tags for the box codes. Cardboard
brown appears only in the packing drawings. Inputs stay quiet. Keep touch
targets large and numeric keyboards on phones; decimals accept a comma.

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

## The sales prototype

A colleague in sales built a single-file prototype with ChatGPT. It was
reviewed and these ideas were adopted: shipping mode with a weight limit per
box, protection weight per box, internal loss per box dimension, switching
boxes on and off, printing the plan, and the keep-upright option.

Left out so far: several products packed together in one calculation, a 3D
step-by-step view, a "cannot stack on top" option, and editing box sizes on
the page. Its packing method (one orientation per box, plain grid, largest
box first) fits fewer units than this engine and was not reused.

## Open questions

Marked `TO CONFIRM` or `TO CALIBRATE` in `src/data/`. Ask before assuming:

1. Are the box measurements internal or external? `DEFAULT_LOSS_CM` is 0.5 on
   the assumption they are external. It matters: at 0.5 a 40 cm item does not
   fit box P.
2. Is 25 kg the right weight limit per box for carrier shipments? Correios is
   30 kg.
3. Which cubed-weight factor do the carriers in use apply? 300 kg/m³ is set;
   parcel carriers often use 167.
4. For Correios, is cubed weight ignored up to 5 kg or up to 10 kg? Sources
   disagree; 5 is set because it never underestimates.
5. Does sales need several products in one calculation? A middle option is
   several products per order, each packed in its own boxes, with combined
   totals.
6. How much volume is one extra box worth (`BOX_PENALTY_LITERS`)? A cost per
   box plus freight would replace the guess: every box can take a `costBRL`
   and the engine already has a lowest-cost priority.

## Known limits

- Layer packing is a strong heuristic, not a proof of the maximum. It does not
  find interlocked "pinwheel" layouts, so a layer can be one unit short.
- The calculation is geometric only: no fragility, crushing or bulging.
- Orders above 2,000,000 units are bulk-filled before the exact search, so the
  box mix is near-best rather than exact at that size.
- The page has only been checked in a browser with fallback fonts and a
  different bundler. Its look with Barlow loaded, and on a real phone, has not
  been reviewed.
