/**
 * Client-side encryption for the paste tool.
 *
 * Model (same spirit as paste.sh): the browser encrypts the note with a
 * random AES-256 key BEFORE anything leaves the device. Only ciphertext is
 * stored server-side; the key travels in the URL fragment (`#…`), which
 * browsers never send to any server. Without the fragment, neither our
 * backend nor Firebase can read the content.
 *
 * Uses the native Web Crypto API (AES-GCM) — no third-party crypto library.
 * AES-GCM is authenticated, so tampering with the ciphertext makes
 * decryption throw rather than return garbage.
 */

const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // 96-bit nonce, the standard size for AES-GCM

/** Encode bytes as URL-safe base64 (no padding) — safe in a URL fragment. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode URL-safe base64 back to bytes. */
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Ciphertext + nonce, both base64url-encoded for storage. */
export interface Encrypted {
  ct: string;
  iv: string;
}

/** Generate a fresh random AES-256 key. */
export function generateKey(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(KEY_BYTES));
}

/** Serialize a key for the URL fragment. */
export function keyToString(key: Uint8Array): string {
  return toBase64Url(key);
}

/** Parse a key back from the URL fragment. Throws if it is the wrong size. */
export function keyFromString(text: string): Uint8Array<ArrayBuffer> {
  const key = fromBase64Url(text);
  if (key.length !== KEY_BYTES) throw new Error('Invalid key length');
  return key;
}

function importKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/** Encrypt UTF-8 text with the given key and a fresh random nonce. */
export async function encrypt(plaintext: string, key: Uint8Array<ArrayBuffer>): Promise<Encrypted> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cryptoKey = await importKey(key);
  const buffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    new TextEncoder().encode(plaintext)
  );
  return { ct: toBase64Url(new Uint8Array(buffer)), iv: toBase64Url(iv) };
}

/**
 * Decrypt an {@link Encrypted} payload. Throws if the key is wrong or the
 * ciphertext was tampered with (AES-GCM authentication failure).
 */
export async function decrypt(enc: Encrypted, key: Uint8Array<ArrayBuffer>): Promise<string> {
  const cryptoKey = await importKey(key);
  const buffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(enc.iv) },
    cryptoKey,
    fromBase64Url(enc.ct)
  );
  return new TextDecoder().decode(buffer);
}
