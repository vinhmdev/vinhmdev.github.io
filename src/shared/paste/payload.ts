/**
 * Paste payload (de)serialization.
 *
 * Title + body are encrypted together as one JSON blob so the title is
 * end-to-end encrypted too (Firestore only sees ciphertext) and still
 * travels to whoever opens the link. Kept separate from crypto.ts, which
 * stays a plain string-in/string-out cipher.
 */
export interface PastePayload {
  title: string;
  body: string;
}

/** Serialize a payload to the string that gets encrypted. */
export function encodePayload(title: string, body: string): string {
  return JSON.stringify({ v: 1, title, body });
}

/**
 * Parse a decrypted payload string. Falls back to treating the whole string
 * as the body (title empty) if it is not the expected JSON shape — keeps old
 * or hand-made pastes readable.
 */
export function decodePayload(raw: string): PastePayload {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && typeof obj.body === 'string') {
      return { title: typeof obj.title === 'string' ? obj.title : '', body: obj.body };
    }
  } catch {
    /* not JSON — treat as plain body below */
  }
  return { title: '', body: raw };
}
