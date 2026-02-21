# Picnic Bundles Spec

## What are bundles?

Bundles are multi-pack variants of the same product at volume-discounted prices. Example: Coca-Cola Zero cafeïnevrij available as 1x 1.5L (€2.89), 4x 1.5L (€2.79/each, "Bespaar 40 cent"), 6x 1.5L (€2.69/each, "Bespaar €1.20").

Not all products have bundles. Products with only a promo label like "2e halve prijs" (e.g. Campina kwark) do NOT have bundles — that's a store-wide promotion on the single selling unit, not a multi-pack option.

## Where bundle data lives

Bundle data is in the PDP response from `getProductDetailsPage(productId)`. There is no separate bundles API — the old `bundle-overview-page` endpoint returns 404.

### PDP tree location

```
pdpResponse
  .body.child.child           (nested STATE_BOUNDARY wrappers)
    .children[1]              (root-content BLOCK)
      .children[N]            (one of the top-level sections)
```

The bundle block has `id` matching `product-page-bundles-*` (e.g. `product-page-bundles-10511531`) and `type: "BLOCK"`.

### Bundle block structure

```json
{
  "id": "product-page-bundles-10511531",
  "type": "BLOCK",
  "children": [
    // One STATE_BOUNDARY per bundle variant
    {
      "id": "s1001789",              // selling unit ID
      "type": "STATE_BOUNDARY",
      "child": {
        "type": "PML",
        "id": "product-page-bundle-item-s1001789",
        "content": {
          "type": "SELLING_UNIT_TILE",
          "sellingUnit": {
            "id": "s1001789",
            "name": "zero cafeinevrij",
            "image_id": "488a017f...",
            "max_count": 50
          }
        },
        "pml": { /* PML component tree with price/text */ }
      }
    }
  ]
}
```

### Extracting data from each bundle item

Each `STATE_BOUNDARY` child contains a PML tree with:

| Data | Location | Example |
|---|---|---|
| Selling unit ID | `child.content.sellingUnit.id` | `"s1001789"` |
| Product name | `child.content.sellingUnit.name` | `"zero cafeinevrij"` |
| Image ID | `child.content.sellingUnit.image_id` | `"488a017f..."` |
| Per-unit price (cents) | PML node with `type: "PRICE"`, field `price` | `289` |
| Volume | RICH_TEXT markdown matching `\d.*(?:liter\|ml\|gram\|kg\|stuks?)` | `"1,5 liter"` |
| Unit price | RICH_TEXT markdown matching `€\d+\.\d+/\w+` | `"€1.93/l"` |
| Pack multiplier | RICH_TEXT markdown that is just a number (`/^\d+$/`) | `"4"`, `"6"` |
| Promo/savings text | RICH_TEXT markdown containing "Bespaar" or "korting" | `"Bespaar 40 cent"` |
| Accessibility label | Contains total price: `"naam, voor, X € Y cent"` | `"zero cafeinevrij, voor, 11 € 16 cent"` |

### Markdown color codes

PML RICH_TEXT markdown contains color codes like `#(#333333)text#(#333333)`. Strip with: `md.replace(/#\([^)]+\)/g, "")`.

## Things that are NOT bundles

### "Meer met korting" section
Located in `browsing-container` (identified by analytics `page_section` with `name: "Meer met korting"`). These are **other products from the same brand** that are on promotion — not bundle variants of the current product.

### "Vergelijkbaar" section
Located in `alternatives-container`. These are **similar products from other brands**.

### "2e halve prijs" label
A promotional label on `product-page-labels-{id}`. Means the product itself is on a "buy one get second half price" deal. This is independent of bundles — the product may or may not also have bundle variants.

## Example: product with bundles (Coca-Cola Zero cafeïnevrij)

```
s1001789 | 1,5 liter · €1.93/l  | €2.89 | (no promo — base unit)
s1047511 | 4x · €1.86/l         | €2.79 | Bespaar 40 cent
s1083839 | 6x · €1.79/l         | €2.69 | Bespaar €1.20
```

## Example: product without bundles (Campina magere milde kwark naturel)

No `product-page-bundles-*` block exists in PDP. The "2e halve prijs" is just a label. Parser returns empty array.
