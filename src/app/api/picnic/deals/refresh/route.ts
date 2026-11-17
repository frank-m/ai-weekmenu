import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  getPromotionsOverview,
  getPromotionGroupProducts,
  delay,
  PicnicTwoFactorRequiredError,
} from "@/lib/picnic";
import { PromoProduct } from "@/lib/types";

const DELAY_MS = 500; // conservative delay between promotion-group calls
const MAX_GROUP_CALLS = 40; // hard cap per refresh run

/**
 * Refreshes the deals cache from Picnic's promotions page: one call for the page
 * itself, plus one per multi-product promotion group (capped). Groups are
 * tracked in known_promotions; groups no longer on the page are marked inactive.
 */
export async function POST() {
  try {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    const overview = await getPromotionsOverview();
    const saleMap = new Map<string, PromoProduct>();
    for (const p of overview.products) saleMap.set(p.picnic_id, p);

    // Most recently seen groups first, so a capped run covers the likeliest ones
    const lastSeen = new Map(
      (
        db.prepare("SELECT promotion_id, last_seen_at FROM known_promotions").all() as Array<{
          promotion_id: string;
          last_seen_at: number | null;
        }>
      ).map((r) => [r.promotion_id, r.last_seen_at ?? 0])
    );
    const groups = [...overview.groups].sort(
      (a, b) => (lastSeen.get(b.id) ?? 0) - (lastSeen.get(a.id) ?? 0)
    );

    let callCount = 1; // the promotions page itself
    let groupCalls = 0;
    const seenGroups: Array<{ id: string; seed: string; label: string }> = [];
    for (const group of groups) {
      if (groupCalls >= MAX_GROUP_CALLS) break;
      await delay(DELAY_MS);
      groupCalls++;
      callCount++;
      try {
        const products = await getPromotionGroupProducts(group);
        for (const p of products) {
          if (!saleMap.has(p.picnic_id)) saleMap.set(p.picnic_id, p);
        }
        seenGroups.push({ id: group.id, seed: products[0]?.picnic_id ?? "", label: group.label || group.name });
      } catch (err) {
        if (err instanceof PicnicTwoFactorRequiredError) throw err;
        // Transient failure (rate limit, network) — the group is still listed on
        // the promotions page, so record it as seen without its products
        console.error(`[deals/refresh] promotion group ${group.id} failed:`, err);
        seenGroups.push({ id: group.id, seed: "", label: group.label || group.name });
      }
    }

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
      VALUES (@promotion_id, @seed_picnic_id, @label, @now, @now, 1)
      ON CONFLICT(promotion_id) DO UPDATE SET
        seed_picnic_id = CASE WHEN excluded.seed_picnic_id != '' THEN excluded.seed_picnic_id ELSE seed_picnic_id END,
        label = excluded.label,
        last_seen_at = @now,
        active = 1
    `);

    db.transaction(() => {
      // The promotions page is the complete list: anything not on it has ended
      db.prepare("DELETE FROM sale_cache").run();
      for (const item of Array.from(saleMap.values())) {
        upsertSale.run({
          picnic_id: item.picnic_id,
          name: item.name,
          image_id: item.image_id,
          price: item.price,
          promo_label: item.promo_label,
          fetched_at: now,
        });
      }
      const listedIds = new Set(overview.groups.map((g) => g.id));
      db.prepare("UPDATE known_promotions SET active = 0").run();
      for (const g of seenGroups) {
        upsertPromo.run({ promotion_id: g.id, seed_picnic_id: g.seed, label: g.label, now });
      }
      // Groups listed but skipped by the cap are still active
      const markActive = db.prepare("UPDATE known_promotions SET active = 1 WHERE promotion_id = ?");
      Array.from(listedIds).forEach((id) => markActive.run(id));
    })();

    return NextResponse.json({
      items_found: saleMap.size,
      promotions_checked: groupCalls,
      calls_made: callCount,
      capped: groupCalls < overview.groups.length,
    });
  } catch (err) {
    if (err instanceof PicnicTwoFactorRequiredError) {
      return NextResponse.json({ error: "picnic_2fa_required" }, { status: 401 });
    }
    console.error("[deals/refresh] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
