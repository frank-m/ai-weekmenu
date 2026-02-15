import Cryptr from "cryptr";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const KEY_FILE = path.join(process.cwd(), ".encryption-key");

let cryptrInstance: Cryptr | null = null;

function getEncryptionKey(): string {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) return envKey;

  if (fs.existsSync(KEY_FILE)) {
    return fs.readFileSync(KEY_FILE, "utf-8").trim();
  }

  const key = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
  return key;
}

function getCryptr(): Cryptr {
  if (!cryptrInstance) {
    cryptrInstance = new Cryptr(getEncryptionKey());
  }
  return cryptrInstance;
}

export function encryptValue(plaintext: string): string {
  return getCryptr().encrypt(plaintext);
}

export function decryptValue(encrypted: string): string {
  return getCryptr().decrypt(encrypted);
}

export function isEncrypted(value: string): boolean {
  try {
    getCryptr().decrypt(value);
    return true;
  } catch {
    return false;
  }
}
