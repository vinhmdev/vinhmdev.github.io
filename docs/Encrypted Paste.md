# Encrypted Paste

An end-to-end encrypted pastebin, inspired by [paste.sh](https://github.com/dgl/paste.sh)
but rebuilt on the native Web Crypto API + Firebase Firestore so it runs on
a static GitHub Pages site with no server of our own.

## How it works

```
Browser                              Firestore
───────                              ─────────
1. generate random AES-256 key
2. AES-256-GCM encrypt the note  ──►  store { ct, iv, v, createdAt, expireAt }
3. build link:  /paste/#<id>.<key>        (ciphertext only — never plaintext)
```

- **The key lives only in the URL fragment (`#…`)**, which browsers never
  send to any server. Firebase (and our GitHub Pages host) only ever see
  ciphertext. Lose the fragment → the note is unrecoverable, by design.
- **AES-GCM is authenticated**: a wrong key or altered ciphertext makes
  decryption throw instead of returning garbage.
- Pastes are **immutable** and **self-expiring** (1 day / 1 week / 1 month /
  1 year, chosen at creation).

Source layout: `src/features/encrypted-paste/` (crypto, firestore, UI, i18n),
route at `src/pages/paste/index.astro`, storage rules at `firestore.rules`.

## Why the Firebase key in the bundle is not a secret

The `PUBLIC_FIREBASE_*` values shipped to the browser only *identify* the
project. They are not credentials — Google's own docs say the Web API key is
safe to expose. Access is enforced server-side by `firestore.rules`, not by
hiding the key. (This is the key difference from S3/R2 access keys, which
*are* secrets and must never reach the browser.)

## One-time Firebase setup

The tool reuses the existing Firebase project (same config as Analytics — no
new env vars). To enable it:

1. **Enable Firestore** — Firebase Console → *Build → Firestore Database →
   Create database*. Production mode is fine; the rules below lock it down.
2. **Publish the rules** — copy `firestore.rules` into Console → *Firestore →
   Rules → Publish*, or run `firebase deploy --only firestore:rules`.
3. **Enable TTL cleanup** — Console → *Firestore → TTL → Create policy*, on
   collection `pastes`, field `expireAt`. Firestore then deletes expired
   pastes automatically (deletion can lag a few hours; the client also
   treats already-expired pastes as "not found").

### Optional hardening

- **App Check (reCAPTCHA v3)** — makes the create endpoint accept writes only
  from our own app, cutting off bot abuse. Enable in Console → *App Check*,
  then initialize it in `src/shared/firebase/app.ts`.
- Tighten the `ct.size()` cap in `firestore.rules` if you want smaller pastes.

## Cost

Firestore's free (Spark) tier — 20K writes/day, 50K reads/day, 1 GiB stored —
covers personal use comfortably, so this runs at ~$0. Each created paste is
one write; each open is one read.
