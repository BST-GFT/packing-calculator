/**
 * How many times its own weight a unit marked "Frágil" can carry in other
 * products, in a box that mixes products, when its "Máx. camadas" is empty.
 * With 3, a 250 g cup can take up to 750 g of lighter products on top, such as
 * folded bags, but not a 900 g mug. Set to 3 by Francesco (2026-10-09):
 * fragile items usually stack 3 or 4 high in a box without trouble.
 *
 * When "Máx. camadas" is filled, it sets the multiple instead: one less than
 * the layers, so a product stacked at most 2 high carries its own weight.
 */
export const FRAGILE_LOAD = 3
