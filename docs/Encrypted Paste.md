# Encrypted Paste & Markdown Share

Two end-to-end encrypted sharing features, inspired by
[paste.sh](https://github.com/dgl/paste.sh) but rebuilt on the native Web
Crypto API + Firebase Firestore so they run on a static GitHub Pages site
with no server of our own:

- **Encrypted Paste** (`/paste/`) — quick immutable (read-only) notes.
- **Paste-to-Markdown share** (`/clipboard2markdown/`) — save the markdown
  you're editing to a link and, if you choose the **editable** mode, let
  anyone with the link open it and save changes back to the _same_ link.
  Read-only shares stay frozen; editing one forks a new link. "My shared
  docs" (with local version snapshots) live in `localStorage` — no account.

Shared code lives in `src/shared/paste/` (crypto, payload, Firestore store);
each tool adds its own UI. Both use the same `pastes` collection + rules.

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
- Expiration is configurable at creation: **1 hour**, **1 day**, **1 week**,
  **1 month** (default), **1 year**, or **Never expires (Permanent)**. Encrypted
  Paste creates immutable read-only notes, while Paste-to-Markdown supports both
  `editable` (in-place updates) and `readonly` modes.

Source layout: `src/features/encrypted-paste/` (crypto, firestore, UI, i18n),
route at `src/pages/paste/index.astro`, storage rules at `firestore.rules`.

## Why the Firebase key in the bundle is not a secret

The `PUBLIC_FIREBASE_*` values shipped to the browser only _identify_ the
project. They are not credentials — Google's own docs say the Web API key is
safe to expose. Access is enforced server-side by `firestore.rules`, not by
hiding the key. (This is the key difference from S3/R2 access keys, which
_are_ secrets and must never reach the browser.)

## One-time Firebase setup

The tool reuses the existing Firebase project (same config as Analytics — no
new env vars). To enable it:

1. **Enable Firestore** — Firebase Console → _Build → Firestore Database →
   Create database_. Production mode is fine; the rules below lock it down.
2. **Publish the rules** — copy `firestore.rules` into Console → _Firestore →
   Rules → Publish_, or run `firebase deploy --only firestore:rules`.
   > ⚠️ The rules are now **v2** (they add the `mode` field and allow
   > content-only updates to `editable` pastes). If you published an earlier
   > version, **re-publish** — otherwise editable saves are rejected.
3. **Enable TTL cleanup** — Console → _Firestore → TTL → Create policy_, on
   collection `pastes`, field `expireAt`. Firestore then deletes expired
   pastes automatically (deletion can lag a few hours; the client also
   treats already-expired pastes as "not found").
   > **Permanent pastes (`expireAt: null`)**: Firestore's TTL policy only acts on
   > documents where the designated TTL field contains a past `Timestamp`. Documents
   > with `expireAt: null` are ignored by the TTL policy and are never deleted.

### Optional hardening

- **App Check (reCAPTCHA v3)** — makes the create endpoint accept writes only
  from our own app, cutting off bot abuse. Enable in Console → _App Check_,
  then initialize it in `src/shared/firebase/app.ts`.
- Tighten the `ct.size()` cap in `firestore.rules` if you want smaller pastes.

## Cost & Storage Considerations

- **Free tier usage**: Firestore's free (Spark) tier — 20K writes/day, 50K reads/day,
  1 GiB stored — covers personal use comfortably, so this runs at ~$0. Each created
  paste is one write; each open is one read.
- **Permanent storage impact**: Documents with `expireAt: null` remain stored
  indefinitely in Firestore until manually deleted via the Firebase Console,
  gradually consuming quota against the 1 GiB limit.
- **Key security**: Decryption keys reside exclusively in the `#` fragment and
  local client history (`localStorage`), never reaching Firestore or the host server.
  For permanent pastes, the capability URL remains valid indefinitely; always use
  trusted channels when sharing permanent links, and choose short expiration lifetimes
  (such as 1 hour) for confidential or temporary information.
