# packing-calculator

Tela de Calculadora de cubagem.

Internal Best Gift tool. Logistics or sales type in the size and weight of one
unit and the order quantity; the page says which shipping boxes to use, how
many units go in each, how to arrange them, and what the shipment weighs.

Everything runs in the browser. There is no server and nothing is stored
except the shipping settings, which are remembered on each device.

## Run it on your computer

Needs [Node.js](https://nodejs.org) 22.18 or newer.

```
npm install      # once, and again whenever package.json changes
npm run dev      # opens the page at http://localhost:5173, reloads as you edit
npm test         # runs the calculation tests
npm run build    # writes the publishable page to dist/
```

## Where things are

| Path | What it holds |
| --- | --- |
| `src/data/boxes.ts` | The boxes in stock, and two numbers to calibrate |
| `src/data/shipping.ts` | Limits and cubed-weight rules per shipping mode |
| `src/engine/` | The calculation. No interface code, fully tested |
| `src/App.tsx`, `src/ui/` | The page |
| `.github/workflows/` | Automatic checks and publishing |

To change a box, edit `src/data/boxes.ts` and push.

## How it calculates

1. **One layer.** For a flat layer, it tries every way of filling it with full
   rows and columns of units, turning some 90° when that fits more
   (`engine/layer.ts`).
2. **One box.** Layers are stacked. Each layer can stand the unit on a
   different face, and the stack can run along the box's height, length or
   width, whichever holds most. The weight limit then caps the count
   (`engine/fit.ts`).
3. **The order.** Knowing how many units each box holds, it finds the mix of
   box sizes that covers the quantity best (`engine/plan.ts`). "Best" is one of:
   - balanced (default): least volume, where every extra box must save at
     least `BOX_PENALTY_LITERS` litres to be worth it
   - fewest boxes
   - least volume
   - lowest cost, once every box has a `costBRL`

Steps 2 and 3 are exact for what they search. Step 1 is a strong heuristic:
it finds the layouts a person would build by hand, but not interlocked
"pinwheel" layouts, so a layer can occasionally be one unit short of the
theoretical maximum.

## Branches and publishing

- Work on `develop`. Every push there runs the tests (`ci.yml`).
- Open a pull request from `develop` into `main` when a version is ready.
- Merging into `main` publishes the page (`deploy.yml`).

One-time setup before the first publish: in the repository on GitHub, go to
Settings > Pages and set Source to "GitHub Actions".

## To confirm with logistics

These are marked `TO CONFIRM` or `TO CALIBRATE` in `src/data/`:

- Whether the box measurements are internal or external. `DEFAULT_LOSS_CM`
  is 0.5 on the assumption they are external.
- The weight limit per box for carrier shipments (25 kg for now).
- The cubed-weight factor the carriers in use apply (300 kg/m³ for now).
- For Correios, whether cubed weight is ignored up to 5 kg or 10 kg.
- `BOX_PENALTY_LITERS`: how much volume one extra box is worth.
