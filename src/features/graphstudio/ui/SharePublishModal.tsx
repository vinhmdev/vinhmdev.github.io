/**
 * 3-Tab Hybrid Share & Publish Modal [FR-5.2, AC-05]:
 * - Tab 1: Cloud Link (Firebase E2EE AES-256-GCM `#<pasteId>.<aesKey>` via `@shared/paste/*`)
 * - Tab 2: Publish to Community Gallery (Firestore `public_graphs` `#g.<graphId>`)
 * - Tab 3: Stateless Offline URL (`#v2.dr.<deflate-base64url>` <= 2,000 chars) & JSON Export
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { isFirebaseConfigured } from '@shared/firebase/config';
import { encrypt, generateKey, keyToString } from '@shared/paste/crypto';
import { encodePayload } from '@shared/paste/payload';
import { createPaste, type PasteMode } from '@shared/paste/store';
import { createDocStore } from '@shared/paste-share/history';
import {
  publishToCommunityGallery,
  type PublicGraphCategory,
} from '../state/firebase-gallery-store';
import { downloadStateJsonFile } from '../state/local-persistence';
import type { GraphStoreState } from '../state/store';
import { encodeStateToUrlHashSync } from '../state/url-codec';
import { IconClose } from './icons';

const docHistoryStore = createDocStore('graphstudio:docs');

interface ShareModalProps {
  storeState: GraphStoreState;
  onToast: (msg: string) => void;
}

export function SharePublishModal({
  storeState,
  onToast,
}: ShareModalProps): JSX.Element | null {
  if (!storeState.shareModalOpen) return null;

  const { graph } = storeState;
  const [activeTab, setActiveTab] = useState<'e2ee' | 'gallery' | 'stateless'>('e2ee');
  const [e2eeMode, setE2eeMode] = useState<PasteMode>('editable');
  const [ttlDays, setTtlDays] = useState(30);
  const [title, setTitle] = useState(graph.title || 'Interactive Math Graph');
  const [author, setAuthor] = useState('VinhMDev');
  const [category, setCategory] = useState<PublicGraphCategory>('activation');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);

  const statelessHash = encodeStateToUrlHashSync(graph);
  const statelessFullUrl =
    typeof location !== 'undefined'
      ? `${location.origin}${location.pathname}${statelessHash}`
      : `/graphstudio/${statelessHash}`;

  const handleCreateE2eeLink = async (): Promise<void> => {
    if (!isFirebaseConfigured) {
      onToast('Firebase is not configured in environment variables.');
      return;
    }
    setBusy(true);
    try {
      const serialized = JSON.stringify({ ...graph, title });
      const key = generateKey();
      const keyStr = keyToString(key);
      const enc = await encrypt(encodePayload(title, serialized), key);
      const pasteId = await createPaste(enc, { ttlDays, mode: e2eeMode });
      const url = `${location.origin}${location.pathname}#${pasteId}.${keyStr}`;

      const now = Date.now();
      docHistoryStore.saveDoc(
        {
          id: pasteId,
          key: keyStr,
          title,
          url,
          mode: e2eeMode,
          createdAt: now,
          updatedAt: now,
          expireAt: now + ttlDays * 86400_000,
        },
        serialized
      );

      storeState.setSessionMode('cloud_e2ee', {
        id: pasteId,
        keyStr,
        mode: e2eeMode,
        isDirty: false,
      });
      if (e2eeMode === 'editable') {
        history.replaceState(null, '', `#${pasteId}.${keyStr}`);
      }
      setGeneratedUrl(url);
      onToast('Encrypted Cloud Link created!');
    } catch {
      onToast('Failed to create Cloud Link.');
    } finally {
      setBusy(false);
    }
  };

  const handlePublishGallery = async (): Promise<void> => {
    if (!isFirebaseConfigured) {
      onToast('Firebase is not configured in environment variables.');
      return;
    }
    setBusy(true);
    try {
      const id = await publishToCommunityGallery({
        title,
        author,
        category,
        description,
        primaryLatex: graph.expressions[0]?.latex ?? 'f(x)',
        payload: statelessHash,
        ttlDays: 365,
      });
      const url = `${location.origin}${location.pathname}#g.${id}`;
      storeState.setSessionMode('public_gallery', null);
      history.replaceState(null, '', `#g.${id}`);
      setGeneratedUrl(url);
      onToast('Published to Community Gallery!');
    } catch {
      onToast('Failed to publish to Community Gallery.');
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (txt: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(txt);
      onToast('Copied link to clipboard!');
    } catch {
      onToast('Failed to copy link.');
    }
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div class="w-full max-w-lg rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl flex flex-col overflow-hidden text-xs">
        <div class="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <h3 class="font-bold text-sm">Share &amp; Publish Graph</h3>
          <button
            type="button"
            onClick={() => storeState.setShareModalOpen(false)}
            class="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <IconClose />
          </button>
        </div>

        {/* 3 Mode Tabs */}
        <div class="grid grid-cols-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-100/60 dark:bg-neutral-950">
          <button
            type="button"
            onClick={() => {
              setActiveTab('e2ee');
              setGeneratedUrl(null);
            }}
            class={`py-2 font-semibold ${
              activeTab === 'e2ee'
                ? 'border-b-2 border-orange-500 text-orange-600 dark:text-orange-400 bg-white dark:bg-neutral-900'
                : 'text-neutral-500'
            }`}
          >
            1. Cloud E2EE Link
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('gallery');
              setGeneratedUrl(null);
            }}
            class={`py-2 font-semibold ${
              activeTab === 'gallery'
                ? 'border-b-2 border-orange-500 text-orange-600 dark:text-orange-400 bg-white dark:bg-neutral-900'
                : 'text-neutral-500'
            }`}
          >
            2. Community Gallery
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('stateless');
              setGeneratedUrl(null);
            }}
            class={`py-2 font-semibold ${
              activeTab === 'stateless'
                ? 'border-b-2 border-orange-500 text-orange-600 dark:text-orange-400 bg-white dark:bg-neutral-900'
                : 'text-neutral-500'
            }`}
          >
            3. Offline URL / JSON
          </button>
        </div>

        <div class="p-4 flex flex-col gap-3">
          {activeTab === 'e2ee' && (
            <>
              <p class="text-neutral-500">
                End-to-end encrypted (AES-256-GCM) in your browser. Supports up to 900 KB of data
                points and in-place collaborative saving.
              </p>
              <input
                type="text"
                value={title}
                onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
                placeholder="Graph title"
                class="w-full px-3 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent"
              />
              <div class="flex items-center gap-3">
                <label class="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="e2ee-mode"
                    checked={e2eeMode === 'editable'}
                    onChange={() => setE2eeMode('editable')}
                  />
                  <span>Editable (update same link)</span>
                </label>
                <label class="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="e2ee-mode"
                    checked={e2eeMode === 'readonly'}
                    onChange={() => setE2eeMode('readonly')}
                  />
                  <span>Read-only (frozen)</span>
                </label>
              </div>
              <div class="flex items-center justify-between">
                <span>Expiration TTL:</span>
                <select
                  value={ttlDays}
                  onChange={(e) => setTtlDays(Number((e.target as HTMLSelectElement).value))}
                  class="px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800"
                >
                  <option value={1}>1 Day</option>
                  <option value={7}>7 Days</option>
                  <option value={30}>30 Days</option>
                  <option value={365}>1 Year</option>
                </select>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleCreateE2eeLink()}
                class="w-full py-2 rounded-lg bg-orange-500 text-white font-semibold hover:bg-orange-600 disabled:opacity-50"
              >
                {busy ? 'Encrypting...' : 'Encrypt & Create Cloud Link'}
              </button>
            </>
          )}

          {activeTab === 'gallery' && (
            <>
              <p class="text-neutral-500">
                Share publicly with everyone in the GraphStudio Community Gallery (`public_graphs`).
              </p>
              <div class="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={title}
                  onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
                  placeholder="Title (3-120 chars)"
                  class="px-2.5 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent"
                />
                <input
                  type="text"
                  value={author}
                  onInput={(e) => setAuthor((e.target as HTMLInputElement).value)}
                  placeholder="Author name"
                  class="px-2.5 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent"
                />
              </div>
              <select
                value={category}
                onChange={(e) =>
                  setCategory((e.target as HTMLSelectElement).value as PublicGraphCategory)
                }
                class="px-2.5 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800"
              >
                <option value="activation">Activations &amp; Gradients</option>
                <option value="loss">Loss Functions &amp; Outliers</option>
                <option value="optimization">Optimization &amp; Schedules</option>
                <option value="probability">Probability &amp; Bayes</option>
                <option value="boundary">Decision Boundaries &amp; Kernels</option>
                <option value="custom">Custom Exploration</option>
              </select>
              <textarea
                rows={2}
                value={description}
                onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
                placeholder="Brief mathematical description..."
                class="px-2.5 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void handlePublishGallery()}
                class="w-full py-2 rounded-lg bg-orange-500 text-white font-semibold hover:bg-orange-600 disabled:opacity-50"
              >
                {busy ? 'Publishing...' : 'Publish to Community Gallery'}
              </button>
            </>
          )}

          {activeTab === 'stateless' && (
            <>
              <p class="text-neutral-500">
                Zero-backend deflate-raw compressed URL (`#v2.dr.*`,{' '}
                <b>{statelessHash.length} chars</b> &le; 2,000 budget). Works 100% offline.
              </p>
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={statelessFullUrl}
                  class="flex-1 px-2.5 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 font-mono text-[11px]"
                />
                <button
                  type="button"
                  onClick={() => void copyText(statelessFullUrl)}
                  class="px-3 py-1.5 rounded bg-orange-500 text-white font-semibold"
                >
                  Copy URL
                </button>
              </div>
              <button
                type="button"
                onClick={() => downloadStateJsonFile(graph)}
                class="w-full py-1.5 rounded border border-neutral-300 dark:border-neutral-700 font-semibold hover:border-orange-500"
              >
                Download .json Session File
              </button>
            </>
          )}

          {generatedUrl && (
            <div class="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-2">
              <input
                type="text"
                readOnly
                value={generatedUrl}
                class="flex-1 bg-transparent font-mono text-[11px] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void copyText(generatedUrl)}
                class="px-2.5 py-1 rounded bg-emerald-600 text-white font-semibold"
              >
                Copy
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
