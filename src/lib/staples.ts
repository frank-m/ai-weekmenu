import { getDb } from "./db";

export const DEFAULT_STAPLES = [
  "zout",
  "peper",
  "olijfolie",
  "boter",
  "zonnebloemolie",
  "knoflook",
  "uien",
  "suiker",
  "bloem",
  "melk",
  "eieren",
  "rijst",
  "pasta",
  "tomatenpuree",
  "sojasaus",
  "azijn",
  "mosterd",
  "honing",
  "paprikapoeder",
  "komijnpoeder",
  "kerriepoeder",
  "oregano",
  "tijm",
  "laurierblad",
  "bouillonblokjes",
];

function seedStaples(): void {
  const db = getDb();
  // Seed exactly once (tracked in settings) — checking COUNT(*)==0 would
  // resurrect all defaults after a user deliberately empties the list
  const seeded = db
    .prepare("SELECT value FROM settings WHERE key = 'staples_seeded'")
    .get() as { value: string } | undefined;
  if (!seeded) {
    const insert = db.prepare("INSERT OR IGNORE INTO staples (name) VALUES (?)");
    const tx = db.transaction(() => {
      const count = db.prepare("SELECT COUNT(*) as cnt FROM staples").get() as { cnt: number };
      if (count.cnt === 0) {
        for (const name of DEFAULT_STAPLES) {
          insert.run(name);
        }
      }
      db.prepare(
        "INSERT INTO settings (key, value) VALUES ('staples_seeded', '1') ON CONFLICT(key) DO NOTHING"
      ).run();
    });
    tx();
  }
}

export function getStaples(): string[] {
  seedStaples();
  const rows = getDb()
    .prepare("SELECT name FROM staples ORDER BY name")
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

export function addStaple(name: string): void {
  getDb()
    .prepare("INSERT OR IGNORE INTO staples (name) VALUES (?)")
    .run(name.toLowerCase().trim());
}

export function removeStaple(name: string): void {
  getDb()
    .prepare("DELETE FROM staples WHERE name = ?")
    .run(name.toLowerCase().trim());
}
