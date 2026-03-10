import { getDb } from "./db";

export function getExclusions(): string[] {
  const rows = getDb()
    .prepare("SELECT name FROM exclusions ORDER BY name")
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

export function addExclusion(name: string): void {
  getDb()
    .prepare("INSERT OR IGNORE INTO exclusions (name) VALUES (?)")
    .run(name.toLowerCase().trim());
}

export function removeExclusion(name: string): void {
  getDb()
    .prepare("DELETE FROM exclusions WHERE name = ?")
    .run(name.toLowerCase().trim());
}
