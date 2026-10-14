# packing-calculator

Tela de Calculadora de cubagem.

Internal Best Gift tool. Logistics or sales type in the size and weight of one
unit and the order quantity; the page says which shipping boxes to use, how
many units go in each, how to arrange them, and what the shipment weighs.

Live at **https://embalagem.bestgift.workers.dev**. The calculation runs in
the browser. A small server on Cloudflare keeps the saved propostas (an order
with its products and the plan) in a database; saved propostas never change.
Each device also remembers its own shipping mode, protection and boxes
switched off.

Each proposta has a **Frete** section for the carrier's quote: carrier, its
price, the ideal price for the customer (1.4 times it), the price charged, the
day of the quote, the tracking code once posted, and the quote itself as an
image or PDF. It can be filled in when the proposta is saved or later with
"Atualizar frete"; every version is kept and the rest of the proposta never
changes. The files are kept in Cloudflare R2.

The version is in the bottom right corner of the page; it comes from
`version` in `package.json`.

**Administração** (link at the bottom of the start screen) is behind the admin
password. There the admin can correct a saved proposta's number or
responsável, delete a proposta for good, and change the settings everyone
uses: the boxes in stock, the weight and size limits and cubed-weight rules,
the default folga, how much weight a fragile product carries, how much one
extra box is worth, the carriers offered for freight and the 1.4 factor.

## Run it on your computer

Needs [Node.js](https://nodejs.org) 22.18 or newer.

```
npm install       # once, and again whenever package.json changes
npm run db:local  # once: creates a local test database for saving propostas
npm run dev       # opens the page at http://localhost:5173, reloads as you edit
npm test          # runs the tests
npm run build     # writes the publishable page and server to dist/
```

To try the admin area on your computer, copy `.dev.vars.example` to
`.dev.vars` and pick a test password there. `.dev.vars` is never committed.

## Where things are

| Path | What it holds |
| --- | --- |
| `src/data/` | Factory settings: boxes in stock (internal measurements), limits and cubed-weight rules per shipping mode, tuning values |
| `src/settings/` | The settings in use: their checks and loading them from the server |
| `src/engine/` | The calculation. No interface code, fully tested |
| `src/App.tsx`, `src/ui/` | The page; `src/ui/Admin.tsx` the admin area |
| `src/proposal/`, `worker/`, `migrations/` | Saved propostas and settings: their format, the server, the database tables |
| `.github/workflows/` | Automatic checks; the old GitHub Pages address forwards to the new one |

Boxes, limits and the other settings are changed in Administração and apply
to everyone at once; each save keeps the previous version in the database.
`src/data/` holds the factory values, used until the admin first saves (and
offered by "Voltar aos valores de fábrica").

## The admin password

It is a secret in Cloudflare, never in this repo (which is public). To set or
change it, in the Cloudflare dashboard: Workers & Pages → **embalagem** →
Settings → Variables and Secrets → Add → type **Secret**, name
`ADMIN_PASSWORD`. Changing it logs out everyone who is logged in. The
preview at `develop-embalagem…` has its own, set with
`npx wrangler preview secret put ADMIN_PASSWORD --name develop`. Ten wrong
tries in a minute from one connection are refused for a minute.

## How it calculates

1. **One layer.** For a flat layer, it tries every way of filling it with full
   rows and columns of units, turning some 90° when that fits more
   (`engine/layer.ts`).
2. **One box.** Layers are stacked. Each layer can stand the unit on a
   different face, and the stack can run along the box's height, length or
   width, whichever holds most. With a "Máximo de camadas", only flat layers
   are stacked, up to that number. The weight limit then caps the count
   (`engine/fit.ts`). No unit hangs over empty space: every unit off the floor
   rests on at least 75% of its base (`engine/support.ts`).
3. **The order.** Knowing how many units each box holds, it finds the mix of
   box sizes that covers each product's quantity best (`engine/plan.ts`).
   "Best" is one of:
   - least volume (default)
   - fewest boxes, then least volume
   - balanced: least volume, where every extra box must save at least
     `BOX_PENALTY_LITERS` litres to be worth it
   - lowest cost, once every box has a `costBRL`
4. **Several products.** Each product fills its own boxes as above. What is
   left over of each is mixed into shared boxes when that saves boxes, packed
   unit by unit with products marked "Frágil" on top. Then a box of
   leftovers is emptied into the room other boxes leave, when all of it fits
   there; what is already in those boxes stays put. Other products may rest
   on a fragile one up to (Máx. camadas − 1) times its weight, or
   `FRAGILE_LOAD` (3) times when Máx. camadas is empty, set in
   `src/data/products.ts` (`engine/shipment.ts`, `engine/mixed.ts`).

Steps 2 and 3 are exact for what they search. Steps 1 and 4 are heuristics:
step 1 finds the layouts a person would build by hand, but not interlocked
"pinwheel" layouts, so a layer can occasionally be one unit short of the
theoretical maximum.

## Branches and publishing

- Work on `develop`. Every push there runs the tests (`ci.yml`), and Cloudflare
  builds a preview at `develop-embalagem.bestgift.workers.dev`, which has its
  own test database.
- Open a pull request from `develop` into `main` when a version is ready.
- Merging into `main` publishes: Cloudflare builds and deploys it on its own.
- A change to the database tables goes in a new file in `migrations/`, applied
  to the real and preview databases with `npm run db:remote` before the code
  that needs it is published: before merging into `main`.
- Raise `version` in `package.json` with each batch that goes to `main`.

## To confirm with logistics

These are marked `TO CONFIRM` or `TO CALIBRATE` in `src/data/`. Once known,
set them in Administração:

- The cubed-weight factor the carriers in use apply (300 kg/m³ for now).
- For Correios, whether cubed weight is ignored up to 5 kg or 10 kg.
- `BOX_PENALTY_LITERS`: how much volume one extra box is worth.
