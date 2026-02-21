import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getPromoProductsFromPDP, delay } from "@/lib/picnic";
import { PromoProduct } from "@/lib/types";

interface FrequentItem {
  picnic_id: string;
  name: string;
  image_id: string;
  price: number;
}

interface KnownPromotion {
  promotion_id: string;
  seed_picnic_id: string;
  label: string;
}

export async function POST() {
  try {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    const frequentItems = db
      .prepare("SELECT picnic_id, name, image_id, price FROM frequent_items")
      .all() as FrequentItem[];

    const knownPromotions = db
      .prepare("SELECT promotion_id, seed_picnic_id, label FROM known_promotions")
      .all() as KnownPromotion[];

    // Track promotion_ids refreshed this run
    const refreshedPromoIds = new Set<string>();

    // Collected sale products keyed by picnic_id (last write wins on duplicates)
    const saleMap = new Map<string, Omit<PromoProduct, "promotion_id"> & { fetched_at: number }>();

    // Queued promotion upserts: promotion_id → partial row
    interface PromoUpsert {
      seed_picnic_id?: string;
      label?: string;
      active: number;
      last_seen_at: number | null;
    }
    const promoUpserts = new Map<string, PromoUpsert>();

    // ── Phase 1: Seed from frequent items ──────────────────────────────────────
    for (let i = 0; i < frequentItems.length; i++) {
      const item = frequentItems[i];
      try {
        const { selfLabel, promoProducts } = await getPromoProductsFromPDP(item.picnic_id);

        // If the frequent item itself is on sale, add it to the cache
        if (selfLabel) {
          saleMap.set(item.picnic_id, {
            picnic_id: item.picnic_id,
            name: item.name,
            image_id: item.image_id,
            price: item.price,
            promo_label: selfLabel,
            fetched_at: now,
          });
        }

        // Process "Meer met korting" products
        for (const p of promoProducts) {
          saleMap.set(p.picnic_id, { ...p, fetched_at: now });

          if (!refreshedPromoIds.has(p.promotion_id)) {
            refreshedPromoIds.add(p.promotion_id);
            const existing = knownPromotions.find(
              (k) => k.promotion_id === p.promotion_id
            );
            if (!existing) {
              // New promotion discovered — use this product as seed
              promoUpserts.set(p.promotion_id, {
                seed_picnic_id: p.picnic_id,
                label: p.promo_label,
                active: 1,
                last_seen_at: now,
              });
            } else {
              promoUpserts.set(p.promotion_id, { active: 1, last_seen_at: now });
            }
          }
        }
      } catch (err) {
        console.error(`[deals/refresh] Phase 1 failed for ${item.picnic_id}:`, err);
      }

      if (i < frequentItems.length - 1) await delay(250);
    }

    // ── Phase 2: Check all known promotions not yet refreshed ─────────────────
    const phase2 = knownPromotions.filter(
      (k) => !refreshedPromoIds.has(k.promotion_id)
    );

    for (let i = 0; i < phase2.length; i++) {
      const known = phase2[i];
      try {
        const { promoProducts } = await getPromoProductsFromPDP(known.seed_picnic_id);

        const matching = promoProducts.filter(
          (p) => p.promotion_id === known.promotion_id
        );

        if (matching.length > 0) {
          for (const p of matching) {
            saleMap.set(p.picnic_id, { ...p, fetched_at: now });
          }
          promoUpserts.set(known.promotion_id, { active: 1, last_seen_at: now });
          refreshedPromoIds.add(known.promotion_id);
        } else {
          promoUpserts.set(known.promotion_id, { active: 0, last_seen_at: null });
        }
      } catch (err) {
        console.error(
          `[deals/refresh] Phase 2 failed for promo ${known.promotion_id}:`,
          err
        );
        promoUpserts.set(known.promotion_id, { active: 0, last_seen_at: null });
      }

      if (i < phase2.length - 1) await delay(250);
    }

    // ── Persist to DB ──────────────────────────────────────────────────────────
    const upsertSale = db.prepare(`
      INSERT INTO sale_cache (picnic_id, name, image_id, price, promo_label, fetched_at)
      VALUES (@picnic_id, @name, @image_id, @price, @promo_label, @fetched_at)
      ON CONFLICT(picnic_id) DO UPDATE SET
        name = excluded.name,
        image_id = excluded.image_id,
        price = excluded.price,
        promo_label = excluded.promo_label,
        fetched_at = excluded.fetched_at
    `);

    const upsertPromo = db.prepare(`
      INSERT INTO known_promotions (promotion_id, seed_picnic_id, label, first_seen_at, last_seen_at, active)
      VALUES (@promotion_id, @seed_picnic_id, @label, @first_seen_at, @last_seen_at, @active)
      ON CONFLICT(promotion_id) DO UPDATE SET
        last_seen_at = CASE WHEN @last_seen_at IS NOT NULL THEN @last_seen_at ELSE last_seen_at END,
        active = @active
    `);

    db.transaction(() => {
      for (const item of Array.from(saleMap.values())) {
        upsertSale.run(item);
      }

      for (const [promotion_id, u] of Array.from(promoUpserts.entries())) {
        const existing = knownPromotions.find((k) => k.promotion_id === promotion_id);
        upsertPromo.run({
          promotion_id,
          seed_picnic_id: u.seed_picnic_id ?? existing?.seed_picnic_id ?? "",
          label: u.label ?? existing?.label ?? "",
          first_seen_at: now,
          last_seen_at: u.last_seen_at ?? null,
          active: u.active,
        });
      }
    })();

    return NextResponse.json({
      items_found: saleMap.size,
      promotions_checked: refreshedPromoIds.size,
      promotions_known: knownPromotions.length + promoUpserts.size - knownPromotions.length,
    });
  } catch (err) {
    console.error("[deals/refresh] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
