# Picnic Bundles, Promotions & Deals Spec

All Picnic access goes through `picnic-api` (5.x), wrapped in `src/lib/picnic.ts`. The library
reads Picnic's app pages, which Picnic serves as either "Fusion" (PML JSON) or RSC (React Server
Components) depending on the page and the app version in `x-picnic-agent`. The library handles
both formats; we no longer parse page trees ourselves (the old `pdp-parser.ts` is gone).

When something here breaks, first check for a newer `picnic-api` release — Picnic changes page
formats often and the library usually follows within days.

## Bundles = price tiers

Bundles are volume prices on **one** product (selling unit), e.g. Coca-Cola Zero:

```
1 stuk     €2,89
vanaf 4    €2,79 each   (Bespaar €0,40)
vanaf 6    €2,69 each   (Bespaar €1,20)
```

Earlier Picnic versions modelled these as separate selling units (one id per multi-pack). Current
pages expose them as `Product.priceRanges: { price, from_quantity }[]` from `catalog.getProduct(id)`.
Products without tiers have `priceRanges: null`.

### Implementation

- `getProductBundles(productId)` in `src/lib/picnic.ts` turns the tiers into `BundleOption[]`
  (sorted by `min_quantity`); fewer than two tiers → no bundles. `price` is the per-unit price of
  the tier; `promo_label` is the computed saving vs. the 1-unit price ("Bespaar €1,20").
- `BundleModal` marks the current tier as the highest one whose `min_quantity` the current quantity
  reaches, and shows the tier total plus the per-unit price.
- Selecting a tier keeps the same `picnic_id` and sets `quantity = max(min_quantity, current)`:
  `PUT /api/picnic/search` (ingredients) or `PUT /api/frequent-items` (frequent items), both of
  which accept an optional `quantity`.
- The cart applies tier prices automatically from the quantity; nothing else to send.

## Promo labels

`Product.promotion` (`{ id, label }`, e.g. "1+1 gratis") from `catalog.getProduct(id)`.

- `getProductPromoLabel(productId)` → `product.promotion?.label ?? null` (null for products that
  no longer exist / aren't available at the address — `ProductNotFoundError`).
- Batch endpoint: `POST /api/picnic/promos` with `{ product_ids: string[] }` (max 20, 250ms apart).
  Labels are fetched live (not stored) since promotions change weekly.
- Search results and promotion tiles carry labels too (`ProductTile.labels`, type `PROMO`); the
  app exposes that as `promo_label` on `RawSearchResult`.

The old "X in bestelling" false positive (cart quantity shown as a label) came from scraping the
PDP labels block and doesn't apply to `promotion`.

## Deals

`POST /api/picnic/deals/refresh` reads the promotions page:

1. `catalog.getPromotions()` — the app's "Acties" tab, as sections (personal promotions,
   "Uitgelicht", one per category, bargain bin). Every tile with a `PROMO` label goes into
   `sale_cache`.
2. Each section also lists **promotion groups** — promotions on several products, e.g. "Korting op
   Alpro". `catalog.getPromotionGroup(id)` returns their products; tiles without their own label
   get the group's label. Max 40 group calls per run, 500ms apart, most-recently-seen first
   (`known_promotions.last_seen_at`).
3. `sale_cache` is replaced on every successful refresh — the promotions page is the complete list.
   `known_promotions.active` = listed on the last refresh.

Not used (yet) but available in the library: `catalog.getCategoryPromotions(categoryId)` and
`catalog.getCheaperAlternatives(productId)`.
