/**
 * Explore Examples, My Saved Graphs & Community Gallery Drawer.
 *
 * - Tab 1 ("Examples"): Searchable & filterable library of 23+ Math & ML scenarios
 *   (removed from the main toolbar to keep the studio uncluttered).
 * - Tab 2 ("My Graphs"): Local history up to 40 docs x 12 version snapshots
 *   via `createDocStore('graphstudio:docs')`.
 * - Tab 3 ("Community"): Lists the latest 30 published graphs from Firestore
 *   `public_graphs` with 1-click Load / Fork.
 */
import katex from 'katex';
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { isFirebaseConfigured } from '@shared/firebase/config';
import { createDocStore, type MyDoc } from '@shared/paste-share/history';
import { ALL_EXPLORE_TEMPLATES, isMathTemplateId } from '../extensions/templates';
import { t } from '../scripts/i18n-client';
import {
  listCommunityGraphs,
  type PublicGraphItem,
} from '../state/firebase-gallery-store';
import type { GraphStoreState } from '../state/store';
import { decodeStateFromUrlHashSync, migrateSchemaToV2 } from '../state/url-codec';
import { IconClose, IconTrash } from './icons';

const docHistoryStore = createDocStore('graphstudio:docs');

function renderCardKaTeX(latex: string): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode: false });
  } catch {
    return latex;
  }
}

interface DrawerProps {
  storeState: GraphStoreState;
  onToast: (msg: string) => void;
}

const EXAMPLE_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'math', label: '📐 Math & Calculus' },
  { id: 'activation', label: '⚡ Activations' },
  { id: 'loss', label: '🎯 Loss Functions' },
  { id: 'probability', label: '🎲 Probability & Bayes' },
  { id: 'schedule_norm', label: '🚀 LR & BatchNorm' },
  { id: 'boundary_kernel', label: '🌐 2D/3D Boundaries' },
] as const;

export function CommunityGalleryDrawer({
  storeState,
  onToast,
}: DrawerProps): JSX.Element | null {
  const [tab, setTab] = useState<'examples' | 'my_docs' | 'community'>(
    () => storeState.galleryInitialTab || 'examples'
  );
  const [exampleCategory, setExampleCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [myDocs, setMyDocs] = useState<MyDoc[]>([]);
  const [communityItems, setCommunityItems] = useState<PublicGraphItem[]>([]);
  const [loadingCommunity, setLoadingCommunity] = useState(false);

  useEffect(() => {
    if (!storeState.galleryDrawerOpen) return;
    setTab(storeState.galleryInitialTab || 'examples');
    setMyDocs(docHistoryStore.getDocs());
  }, [storeState.galleryDrawerOpen, storeState.galleryInitialTab]);

  useEffect(() => {
    if (!storeState.galleryDrawerOpen) return;
    if (tab === 'community' && isFirebaseConfigured) {
      setLoadingCommunity(true);
      listCommunityGraphs(30)
        .then((items) => setCommunityItems(items))
        .catch(() => onToast('Could not fetch community gallery'))
        .finally(() => setLoadingCommunity(false));
    }
  }, [storeState.galleryDrawerOpen, tab]);

  if (!storeState.galleryDrawerOpen) return null;

  const handleLoadCommunityItem = (item: PublicGraphItem): void => {
    const decoded = decodeStateFromUrlHashSync(item.payload, storeState.graph);
    if (decoded) {
      storeState.loadFullState({ ...decoded, title: item.title }, true);
      storeState.setSessionMode('public_gallery', null);
      history.replaceState(null, '', `#g.${item.id}`);
      storeState.setGalleryDrawerOpen(false);
      onToast(`Loaded "${item.title}" by ${item.author}`);
    }
  };

  const handleLoadSavedDoc = (doc: MyDoc): void => {
    const latestSnap = doc.versions[0];
    if (latestSnap?.content) {
      try {
        const restored = migrateSchemaToV2(JSON.parse(latestSnap.content), storeState.graph);
        storeState.setSessionMode('cloud_e2ee', {
          id: doc.id,
          keyStr: doc.key,
          mode: doc.mode,
          isDirty: false,
        });
        storeState.loadFullState({ ...restored, title: doc.title || restored.title }, true);
        history.replaceState(null, '', `#${doc.id}.${doc.key}`);
        storeState.setGalleryDrawerOpen(false);
        onToast(`Restored "${doc.title}"`);
        return;
      } catch {
        /* fallback to hash navigation below */
      }
    }
    location.hash = `#${doc.id}.${doc.key}`;
    storeState.setGalleryDrawerOpen(false);
  };

  const qNorm = searchQuery.trim().toLowerCase();
  const filteredExamples = ALL_EXPLORE_TEMPLATES.filter((tpl) => {
    const isMath = isMathTemplateId(tpl.id);
    if (exampleCategory === 'math' && !isMath) return false;
    if (exampleCategory !== 'all' && exampleCategory !== 'math') {
      if (isMath || tpl.category !== exampleCategory) return false;
    }
    if (!qNorm) return true;
    const titleStr = t(tpl.titleKey).toLowerCase();
    return (
      titleStr.includes(qNorm) ||
      tpl.descKey.toLowerCase().includes(qNorm) ||
      tpl.defaultLatex.toLowerCase().includes(qNorm) ||
      tpl.id.toLowerCase().includes(qNorm)
    );
  });

  const filteredCommunityItems =
    categoryFilter === 'all'
      ? communityItems
      : communityItems.filter((item) => item.category === categoryFilter);

  return (
    <div class="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs">
      <div class="w-full max-w-md h-full bg-white dark:bg-neutral-900 border-l border-neutral-200 dark:border-neutral-800 flex flex-col text-xs shadow-2xl">
        <div class="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <h3 class="font-bold text-sm">{t('mydocs_btn_title')}</h3>
          <button
            type="button"
            onClick={() => storeState.setGalleryDrawerOpen(false)}
            class="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <IconClose />
          </button>
        </div>

        {/* 3-Tab Navigation: Examples | My Graphs | Community */}
        <div class="grid grid-cols-3 border-b border-neutral-200 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => setTab('examples')}
            class={`py-2 font-semibold ${
              tab === 'examples'
                ? 'border-b-2 border-orange-500 text-orange-600 dark:text-orange-400'
                : 'text-neutral-500'
            }`}
          >
            📚 {t('drawer_tab_examples')} ({ALL_EXPLORE_TEMPLATES.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('my_docs')}
            class={`py-2 font-semibold ${
              tab === 'my_docs'
                ? 'border-b-2 border-orange-500 text-orange-600 dark:text-orange-400'
                : 'text-neutral-500'
            }`}
          >
            {t('drawer_tab_mydocs')} ({myDocs.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('community')}
            class={`py-2 font-semibold ${
              tab === 'community'
                ? 'border-b-2 border-orange-500 text-orange-600 dark:text-orange-400'
                : 'text-neutral-500'
            }`}
          >
            {t('drawer_tab_community')}
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-3.5 flex flex-col gap-2.5">
          {tab === 'examples' && (
            <>
              <input
                type="search"
                value={searchQuery}
                onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
                placeholder={t('search_examples_placeholder')}
                class="w-full px-2.5 py-1.5 rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 text-xs focus:border-orange-500 focus:outline-none"
              />

              <div class="flex flex-wrap gap-1 pb-1">
                {EXAMPLE_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setExampleCategory(cat.id)}
                    class={`px-2 py-0.5 rounded border text-[10px] font-semibold transition-colors ${
                      exampleCategory === cat.id
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'border-neutral-300 dark:border-neutral-700 text-neutral-500 hover:border-orange-500'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {filteredExamples.length === 0 ? (
                <p class="text-neutral-500 text-center py-8">
                  No matching scenarios found.
                </p>
              ) : (
                filteredExamples.map((tpl) => {
                  const isActive = storeState.graph.activeTemplateId === tpl.id;
                  const isMath = isMathTemplateId(tpl.id);
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => {
                        storeState.selectTemplate(tpl.id);
                        storeState.setGalleryDrawerOpen(false);
                        onToast(`Loaded "${t(tpl.titleKey)}"`);
                      }}
                      class={`p-3 rounded-lg border text-left transition-colors flex flex-col gap-1.5 ${
                        isActive
                          ? 'border-orange-500 bg-orange-500/5'
                          : 'border-neutral-200 dark:border-neutral-800 hover:border-orange-500'
                      }`}
                    >
                      <div class="flex items-center justify-between gap-2">
                        <span class="font-bold text-neutral-900 dark:text-neutral-100">
                          {t(tpl.titleKey)}
                        </span>
                        <span
                          class={`px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0 ${
                            isMath
                              ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                              : 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
                          }`}
                        >
                          {isMath ? 'Math' : tpl.category}
                        </span>
                      </div>
                      <div
                        class="text-[11px] text-neutral-700 dark:text-neutral-300 overflow-x-auto py-0.5"
                        dangerouslySetInnerHTML={{
                          __html: renderCardKaTeX(tpl.defaultLatex),
                        }}
                      />
                      <p class="text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug">
                        {tpl.descKey}
                      </p>
                    </button>
                  );
                })
              )}
            </>
          )}

          {tab === 'my_docs' && (
            <>
              {myDocs.length === 0 ? (
                <p class="text-neutral-500 text-center py-8">
                  No cloud-shared graphs saved on this device yet.
                </p>
              ) : (
                myDocs.map((doc) => (
                  <div
                    key={doc.id}
                    class="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-2 hover:border-orange-500 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => handleLoadSavedDoc(doc)}
                      class="flex-1 text-left"
                    >
                      <div class="font-bold text-neutral-800 dark:text-neutral-100">
                        {doc.title}
                      </div>
                      <div class="text-[11px] text-neutral-500">
                        {doc.mode} · {doc.versions.length} versions
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        docHistoryStore.removeDoc(doc.id);
                        setMyDocs(docHistoryStore.getDocs());
                      }}
                      class="p-1.5 text-neutral-400 hover:text-red-500"
                    >
                      <IconTrash />
                    </button>
                  </div>
                ))
              )}
            </>
          )}

          {tab === 'community' && (
            <>
              <div class="flex flex-wrap gap-1 pb-1">
                {(['all', 'activation', 'loss', 'probability', 'schedule_norm', 'multivariate'] as const).map(
                  (cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategoryFilter(cat)}
                      class={`px-2 py-0.5 rounded border text-[10px] font-semibold ${
                        categoryFilter === cat
                          ? 'bg-orange-500 text-white border-orange-500'
                          : 'border-neutral-300 dark:border-neutral-700 text-neutral-500'
                      }`}
                    >
                      {cat}
                    </button>
                  )
                )}
              </div>

              {loadingCommunity ? (
                <p class="text-neutral-500 text-center py-8">Loading community graphs...</p>
              ) : filteredCommunityItems.length === 0 ? (
                <p class="text-neutral-500 text-center py-8">
                  No community graphs found or Firebase not configured.
                </p>
              ) : (
                filteredCommunityItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleLoadCommunityItem(item)}
                    class="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 text-left hover:border-orange-500 transition-colors flex flex-col gap-1"
                  >
                    <div class="flex items-center justify-between">
                      <span class="font-bold text-neutral-900 dark:text-neutral-100">
                        {item.title}
                      </span>
                      <span class="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 text-[10px]">
                        {item.category}
                      </span>
                    </div>
                    <div
                      class="text-[11px] text-neutral-600 dark:text-neutral-300 overflow-x-auto"
                      dangerouslySetInnerHTML={{
                        __html: renderCardKaTeX(item.primaryLatex),
                      }}
                    />
                    <div class="text-[10px] text-neutral-400">by {item.author}</div>
                  </button>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
