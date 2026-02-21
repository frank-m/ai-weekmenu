import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const STALE_SECONDS = 48 * 60 * 60; // 48 hours

interface SaleCacheRow {
  picnic_id: string;
  name: string;
  image_id: string;
  price: number;
  promo_label: string;
  fetched_at: number;
}

export async function GET() {
  try {
    const db = getDb();
    const cutoff = Math.floor(Date.now() / 1000) - STALE_SECONDS;

    const items = db
      .prepare(
        `SELECT picnic_id, name, image_id, price, promo_label, fetched_at
         FROM sale_cache
         WHERE fetched_at > ?
         ORDER BY promo_label ASC, name ASC`
      )
      .all(cutoff) as SaleCacheRow[];

    const lastRefreshed =
      (
        db
          .prepare("SELECT MAX(fetched_at) as ts FROM sale_cache")
          .get() as { ts: number | null }
      ).ts ?? null;

    const knownCount = (
      db.prepare("SELECT COUNT(*) as n FROM known_promotions").get() as { n: number }
    ).n;

    return NextResponse.json({ items, lastRefreshed, knownPromotionCount: knownCount });
  } catch (err) {
    console.error("[deals] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
