import Database from "better-sqlite3";
import path from "path";
import { CREATE_TABLES } from "./schema";
import { encryptValue, decryptValue } from "./encryption";

const SENSITIVE_KEYS = ["gemini_api_key", "picnic_password"];

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = process.env.DB_PATH || path.join(process.cwd(), "weekmenu.db");
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(CREATE_TABLES);
    migrateRecipesWeekIdNullable(db);
  }
  return db;
}

function migrateRecipesWeekIdNullable(db: Database.Database): void {
  const columns = db.pragma("table_info(recipes)") as Array<{
    name: string;
    notnull: number;
  }>;
  const weekIdCol = columns.find((c) => c.name === "week_id");
  if (weekIdCol && weekIdCol.notnull === 1) {
    db.pragma("foreign_keys = OFF");
    db.exec(`
      CREATE TABLE recipes_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_id INTEGER,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        servings INTEGER NOT NULL,
        prep_time TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        night_number INTEGER NOT NULL DEFAULT 0,
        source_recipe_id INTEGER,
        FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE CASCADE
      );
      INSERT INTO recipes_new SELECT * FROM recipes;
      DROP TABLE recipes;
      ALTER TABLE recipes_new RENAME TO recipes;
    `);
    db.pragma("foreign_keys = ON");
  }
}

function tryDecrypt(value: string): string {
  try {
    return decryptValue(value);
  } catch {
    // Old plaintext value — return as-is, will be encrypted on next write
    return value;
  }
}

export function getSetting(key: string): string | undefined {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  if (!row) return undefined;
  if (SENSITIVE_KEYS.includes(key)) {
    return tryDecrypt(row.value);
  }
  return row.value;
}

export function setSetting(key: string, value: string): void {
  const storedValue = SENSITIVE_KEYS.includes(key)
    ? encryptValue(value)
    : value;
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, storedValue);
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb()
    .prepare("SELECT key, value FROM settings")
    .all() as { key: string; value: string }[];
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = SENSITIVE_KEYS.includes(row.key)
      ? tryDecrypt(row.value)
      : row.value;
  }
  return settings;
}
