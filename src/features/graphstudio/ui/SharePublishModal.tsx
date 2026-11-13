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
import { getPlottableExpressions } from '../state/expression-kind';
import { t } from '../scripts/i18n-client';
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
        primaryLatex: getPlottableExpressions(graph.expressions)[0]?.latex ?? 'f(x)',
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
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4">
      <div class="w-full max-w-lg max-h-[90vh] rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl flex flex-col overflow-hidden text-xs">
        <div class="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          <h3 class="font-bold text-sm">{t('share_modal_title')}</h3>
          <button
            type="button"
            onClick={() => storeState.setShareModalOpen(false)}
            class="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <IconClose />
          </button>
        </div>

        {/* 3 Mode Tabs */}
        <div class="grid grid-cols-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-100/60 dark:bg-neutral-950 shrink-0 text-[11px] sm:text-xs">
          <button
            type="button"
            onClick={() => {
              setActiveTab('e2ee');
              setGeneratedUrl(null);
            }}
            class={`py-2 px-1 font-semibold truncate ${
              activeTab === 'e2ee'
                ? 'border-b-2 border-orange-500 text-orange-600 dark:text-orange-400 bg-white dark:bg-neutral-900'
                : 'text-neutral-500'
            }`}
          >
            {t('share_tab_e2ee')}
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('gallery');
              setGeneratedUrl(null);
            }}
            class={`py-2 px-1 font-semibold truncate ${
              activeTab === 'gallery'
                ? 'border-b-2 border-orange-500 text-orange-600 dark:text-orange-400 bg-white dark:bg-neutral-900'
                : 'text-neutral-500'
            }`}
          >
            {t('share_tab_gallery')}
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('stateless');
              setGeneratedUrl(null);
            }}
            class={`py-2 px-1 font-semibold truncate ${
              activeTab === 'stateless'
                ? 'border-b-2 border-orange-500 text-orange-600 dark:text-orange-400 bg-white dark:bg-neutral-900'
                : 'text-neutral-500'
            }`}
          >
            {t('share_tab_stateless')}
          </button>
        </div>

        <div class="p-4 flex flex-col gap-3 overflow-y-auto">
          {activeTab === 'e2ee' && (
            <>
              <p class="text-neutral-500">{t('share_e2ee_desc')}</p>
              <input
                type="text"
                value={title}
                onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
                placeholder={t('share_title_placeholder')}
                class="w-full px-3 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent"
              />
              <div class="flex flex-wrap items-center gap-3">
                <label class="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="e2ee-mode"
                    checked={e2eeMode === 'editable'}
                    onChange={() => setE2eeMode('editable')}
                  />
                  <span>{t('share_mode_editable')}</span>
                </label>
                <label class="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="e2ee-mode"
                    checked={e2eeMode === 'readonly'}
                    onChange={() => setE2eeMode('readonly')}
                  />
                  <span>{t('share_mode_readonly')}</span>
                </label>
              </div>
              <div class="flex items-center justify-between gap-2">
                <span>{t('share_ttl_label')}</span>
                <select
                  value={ttlDays}
                  onChange={(e) => setTtlDays(Number((e.target as HTMLSelectElement).value))}
                  class="px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800"
                >
                  <option value={1}>{t('share_ttl_1d')}</option>
                  <option value={7}>{t('share_ttl_7d')}</option>
                  <option value={30}>{t('share_ttl_30d')}</option>
                  <option value={365}>{t('share_ttl_1y')}</option>
                </select>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleCreateE2eeLink()}
                class="w-full py-2 rounded-lg bg-orange-500 text-white font-semibold hover:bg-orange-600 disabled:opacity-50"
              >
                {busy ? t('share_e2ee_busy') : t('share_e2ee_submit')}
              </button>
            </>
          )}

          {activeTab === 'gallery' && (
            <>
              <p class="text-neutral-500">{t('share_gallery_desc')}</p>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={title}
                  onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
                  placeholder={t('share_gallery_title_placeholder')}
                  class="px-2.5 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent"
                />
                <input
                  type="text"
                  value={author}
                  onInput={(e) => setAuthor((e.target as HTMLInputElement).value)}
                  placeholder={t('share_author_placeholder')}
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
                <option value="activation">{t('share_cat_activation')}</option>
                <option value="loss">{t('share_cat_loss')}</option>
                <option value="optimization">{t('share_cat_optimization')}</option>
                <option value="probability">{t('share_cat_probability')}</option>
                <option value="boundary">{t('share_cat_boundary')}</option>
                <option value="custom">{t('share_cat_custom')}</option>
              </select>
              <textarea
                rows={2}
                value={description}
                onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
                placeholder={t('share_desc_placeholder')}
                class="px-2.5 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void handlePublishGallery()}
                class="w-full py-2 rounded-lg bg-orange-500 text-white font-semibold hover:bg-orange-600 disabled:opacity-50"
              >
                {busy ? t('share_gallery_busy') : t('share_gallery_submit')}
              </button>
            </>
          )}

          {activeTab === 'stateless' && (
            <>
              <p class="text-neutral-500">
                {t('share_stateless_desc').replace('{n}', String(statelessHash.length))}
              </p>
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={statelessFullUrl}
                  class="flex-1 min-w-0 px-2.5 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 font-mono text-[11px]"
                />
                <button
                  type="button"
                  onClick={() => void copyText(statelessFullUrl)}
                  class="shrink-0 px-3 py-1.5 rounded bg-orange-500 text-white font-semibold"
                >
                  {t('share_copy_url')}
                </button>
              </div>
              <button
                type="button"
                onClick={() => downloadStateJsonFile(graph)}
                class="w-full py-1.5 rounded border border-neutral-300 dark:border-neutral-700 font-semibold hover:border-orange-500"
              >
                {t('share_download_json')}
              </button>
            </>
          )}

          {generatedUrl && (
            <div class="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-2">
              <input
                type="text"
                readOnly
                value={generatedUrl}
                class="flex-1 min-w-0 bg-transparent font-mono text-[11px] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void copyText(generatedUrl)}
                class="shrink-0 px-2.5 py-1 rounded bg-emerald-600 text-white font-semibold"
              >
                {t('share_copy_short')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
