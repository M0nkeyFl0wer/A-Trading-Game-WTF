import { generateKeyPairSync, sign, verify } from 'crypto';
import fs from 'fs';
import path from 'path';
import { logger } from './logger';

const KEY_DIR = path.join(__dirname, '..', 'data');
const PRIVATE_KEY_PATH = path.join(KEY_DIR, 'server.key');
const PUBLIC_KEY_PATH = path.join(KEY_DIR, 'server.pub');

let privateKey: string;
let publicKey: string;

/**
 * Load an existing Ed25519 keypair from disk, or generate and persist a new one.
 * Private key is written with 0600 permissions; public key with 0644.
 */
function initKeys(): void {
  if (!fs.existsSync(KEY_DIR)) {
    fs.mkdirSync(KEY_DIR, { recursive: true });
  }

  if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
    privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf-8');
    publicKey = fs.readFileSync(PUBLIC_KEY_PATH, 'utf-8');
    logger.info('Loaded existing Ed25519 keypair');
  } else {
    const pair = generateKeyPairSync('ed25519');
    privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }) as string;
    fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
    fs.writeFileSync(PUBLIC_KEY_PATH, publicKey, { mode: 0o644 });
    logger.info('Generated new Ed25519 keypair');
  }
}

initKeys();

// ---------------------------------------------------------------------------
// Signing primitives
// ---------------------------------------------------------------------------

/**
 * Sign a message with the server's Ed25519 private key.
 * Returns the signature as a base64 string.
 */
export function signMessage(message: string): string {
  return sign(null, Buffer.from(message), privateKey).toString('base64');
}

/**
 * Verify a signature against the server's public key.
 */
export function verifySignature(message: string, signature: string): boolean {
  return verify(null, Buffer.from(message), publicKey, Buffer.from(signature, 'base64'));
}

/**
 * Get the server's public key in PEM format for client-side verification.
 */
export function getPublicKey(): string {
  return publicKey;
}

// ---------------------------------------------------------------------------
// Signed receipts
// ---------------------------------------------------------------------------

export interface SignedReceipt {
  data: Record<string, unknown>;
  timestamp: number;
  /** Ed25519 signature of the canonical JSON of { ...data, timestamp }, base64-encoded. */
  signature: string;
}

/**
 * Build a canonical JSON string from an object by sorting its top-level keys.
 * This ensures the same data always produces the same serialisation,
 * which is critical for deterministic signature verification.
 */
function canonicalise(obj: Record<string, unknown>): string {
  const sorted = Object.keys(obj).sort();
  return JSON.stringify(obj, sorted);
}

/**
 * Create a signed receipt for an order, cancellation, or settlement.
 *
 * The receipt embeds the original data, a millisecond-precision timestamp,
 * and an Ed25519 signature over the canonical JSON of `{ ...data, timestamp }`.
 */
export function createSignedReceipt(data: Record<string, unknown>): SignedReceipt {
  const timestamp = Date.now();
  const canonical = canonicalise({ ...data, timestamp });
  const signature = signMessage(canonical);
  return { data, timestamp, signature };
}
