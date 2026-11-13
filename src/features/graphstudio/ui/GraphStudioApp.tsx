/**
 * Root GraphStudio Preact Island Component.
 *
 * Bridges Astro Static Header events (`#share-btn`, `#mydocs-btn`, `themechange`, `langchange`),
 * 3-Tier URL Hash Router (`#v2.dr.*`, `#<pasteId>.<aesKey>`, `#g.<graphId>`),
 * Drag-and-Drop `.json` import, and the Compute Web Worker.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { isFirebaseConfigured } from '@shared/firebase/config';
import { decrypt, encrypt, keyFromString } from '@shared/paste/crypto';
import { decodePayload, encodePayload } from '@shared/paste/payload';
import { fetchPaste, updatePaste } from '@shared/paste/store';
import {
  evaluateEmpiricalLossAndGrad,
  packDataset,
} from '../core/simulation/loss-evaluator';
import { runCustomOptimizerTrajectoryInWasm } from '../extensions/quickjs-sandbox';
import { exportDualViewportPng } from '../renderers/image-exporter';
import { fetchCommunityGraph } from '../state/firebase-gallery-store';
import { classifyUrlHash } from '../state/hash-router';
import { createInitialGraphState, graphStore, type GraphStoreState } from '../state/store';
import {
  decodeStateFromUrlHashSync,
  encodeStateToUrlHashSync,
  migrateSchemaToV2,
} from '../state/url-codec';
import { executeComputeJob } from '../worker/compute.worker';
import type { ComputeJobRequest, ComputeJobResponse } from '../worker/protocol';
import { CommunityGalleryDrawer } from './CommunityGalleryDrawer';
import { CustomOptimizerModal } from './CustomOptimizerModal';
import { DataTablePanel } from './DataTablePanel';
import { DualViewportPanel } from './DualViewportPanel';
import { ExpressionSidebar } from './ExpressionSidebar';
import { FunctionLibraryDrawer } from './FunctionLibraryDrawer';
import { MobileSheetHandle } from './MobileSheetHandle';
import type { SheetSnapTier } from './mobile-sheet-gesture';
import { OptimizerRaceBar } from './OptimizerRaceBar';
import { SharePublishModal } from './SharePublishModal';
import { ToolbarSubheader } from './ToolbarSubheader';
import { t } from '../scripts/i18n-client';
import { getPlottableExpressions } from '../state/expression-kind';

const SIDEBAR_MIN_WIDTH_PX = 280;
const SIDEBAR_MAX_WIDTH_PX = 520;
const SIDEBAR_WIDTH_STORAGE_KEY = 'graphstudio:sidebar-width:v1';

function readStoredSidebarWidth(): number | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    if (Number.isFinite(raw) && raw >= SIDEBAR_MIN_WIDTH_PX && raw <= SIDEBAR_MAX_WIDTH_PX) {
      return Math.round(raw);
    }
  } catch {
    /* ignore storage restrictions */
  }
  return null;
}

function writeStoredSidebarWidth(widthPx: number | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (widthPx === null) {
      localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY);
    } else {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(widthPx)));
    }
  } catch {
    /* ignore storage restrictions */
  }
}

export default function GraphStudioApp(): JSX.Element {
  const [storeState, setStoreState] = useState<GraphStoreState>(() => graphStore.getState());
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('dark')
      : true
  );
  const [, setLangTick] = useState(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [mobileSheetTier, setMobileSheetTier] = useState<SheetSnapTier>('half');
  const [mobilePanelSection, setMobilePanelSection] = useState<
    'all' | 'fx' | 'sliders' | 'data'
  >('all');
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState<boolean>(true);
  const [sidebarWidthPx, setSidebarWidthPx] = useState<number | null>(() =>
    readStoredSidebarWidth()
  );
  const [isDesktopLg, setIsDesktopLg] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 1024px)').matches
      : false
  );

  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);
  const wasmSeqRef = useRef(0);
  const leftCanvasRef = useRef<HTMLCanvasElement>(null);
  const rightGlCanvasRef = useRef<HTMLCanvasElement>(null);
  const rightOverlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const sidebarContainerRef = useRef<HTMLDivElement | null>(null);
  const asideScrollRef = useRef<HTMLElement | null>(null);
  const sidebarResizeRef = useRef<{
    pointerId: number;
    startX: number;
    startW: number;
    latestW: number;
  } | null>(null);

  const showToast = (msg: string): void => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 2800);
  };

  // Subscribe to Zustand store
  useEffect(() => {
    return graphStore.subscribe((next) => {
      setStoreState({ ...next });
    });
  }, []);

  // Track Desktop `lg` breakpoint (`>= 1024px`) and global Cmd/Ctrl+Z Undo/Redo shortcuts
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(min-width: 1024px)')
        : null;
    const onMqChange = (ev: MediaQueryListEvent): void => setIsDesktopLg(ev.matches);
    if (mql) {
      setIsDesktopLg(mql.matches);
      mql.addEventListener('change', onMqChange);
    }

    const onGlobalKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.altKey || !(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      const st = graphStore.getState();

      if (key === 'z' && !e.shiftKey) {
        if (st.whiteboardTool !== 'cursor' && st.whiteboardUndoStack.length > 0) {
          e.preventDefault();
          st.undoWhiteboard();
        } else if (st.undoStack.length > 0) {
          e.preventDefault();
          st.undo();
        }
        return;
      }

      if ((key === 'z' && e.shiftKey) || (key === 'y' && !e.metaKey)) {
        if (st.whiteboardTool !== 'cursor' && st.whiteboardRedoStack.length > 0) {
          e.preventDefault();
          st.redoWhiteboard();
        } else if (st.redoStack.length > 0) {
          e.preventDefault();
          st.redo();
        }
      }
    };

    window.addEventListener('keydown', onGlobalKeyDown);
    return () => {
      mql?.removeEventListener('change', onMqChange);
      window.removeEventListener('keydown', onGlobalKeyDown);
    };
  }, []);

  // Initialize Web Worker (with synchronous fallback) + Service Worker registration [AC-06]
  useEffect(() => {
    try {
      const worker = new Worker(
        new URL('../worker/compute.worker.ts', import.meta.url),
        { type: 'module' }
      );
      worker.onmessage = (ev: MessageEvent<ComputeJobResponse>) => {
        if (ev.data?.type === 'FRAME_RESULT') {
          graphStore.getState().applyWorkerResult(ev.data);
        }
      };
      workerRef.current = worker;
    } catch {
      workerRef.current = null;
    }

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/graphstudio-sw.js', { updateViaCache: 'none' })
        .then((reg) => {
          void reg.update();
        })
        .catch(() => {
          /* ignore SW registration errors in dev */
        });
    }

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  // Dispatch compute job whenever `storeState.graph` changes
  useEffect(() => {
    const g = storeState.graph;
    const paramValues: Record<string, number> = {};
    const paramBounds: Record<string, { min: number; max: number }> = {};
    for (const [k, sl] of Object.entries(g.sliders)) {
      paramValues[k] = sl.value;
      paramBounds[k] = { min: sl.min, max: sl.max };
    }

    const dpr =
      typeof window !== 'undefined'
        ? Math.min(Math.max(window.devicePixelRatio || 1, 2), 3)
        : 2;
    const screenWidth = Math.round(
      (leftCanvasRef.current?.clientWidth || 720) * Math.min(dpr, 2)
    );
    const screenHeight = Math.round(
      (leftCanvasRef.current?.clientHeight || 520) * Math.min(dpr, 2)
    );

    const req: ComputeJobRequest = {
      type: 'EVALUATE_FRAME',
      seq: ++seqRef.current,
      expressions: getPlottableExpressions(g.expressions),
      paramValues,
      paramBounds,
      symbolOverrides: g.symbolOverrides,
      subgradConvention: g.subgradConvention,
      leftViewport: g.leftViewport,
      rightViewport: g.rightViewport,
      screenWidth,
      screenHeight,
      dataPoints: g.dataPoints,
      lossKind: g.lossKind,
      regularizationKind: g.regularizationKind,
      regularizationRadius: g.regularizationRadius,
      batchNormEnabled: g.batchNormEnabled,
      optimizerRace: g.optimizerRace,
      hoveredDataPointId: g.hoveredDataPointId,
      surfaceParamW1: g.surfaceParamW1,
      surfaceParamW2: g.surfaceParamW2,
      functionLibrary: g.functionLibrary,
    };

    if (workerRef.current) {
      workerRef.current.postMessage(req);
    } else {
      const res = executeComputeJob(req);
      graphStore.getState().applyWorkerResult(res);
    }
  }, [storeState.graph]);

  // Recompute QuickJS WASM trajectory only when trajectory-defining inputs change (not on every currentStep playback tick)
  const gForWasm = storeState.graph;
  const wasmDelta = gForWasm.sliders['delta']?.value ?? 1.0;
  const wasmLambda = gForWasm.sliders['lambda']?.value ?? 0.1;
  const wasmEta = gForWasm.sliders['eta']?.value ?? 0.08;
  const wasmBeta1 = gForWasm.sliders['beta']?.value ?? 0.9;

  useEffect(() => {
    const g = storeState.graph;
    if (!g.optimizerRace.enabledOptimizers.custom_js || !g.optimizerRace.customJsCode) {
      return;
    }

    const myWasmSeq = ++wasmSeqRef.current;
    const packed = packDataset(g.dataPoints, g.batchNormEnabled);

    void runCustomOptimizerTrajectoryInWasm(
      g.optimizerRace.customJsCode,
      {
        startW1: g.optimizerRace.startW1,
        startW2: g.optimizerRace.startW2,
        steps: g.optimizerRace.steps,
        eta: wasmEta,
        beta1: wasmBeta1,
        beta2: 0.99,
        epsilon: 1e-8,
      },
      (w1, w2) =>
        evaluateEmpiricalLossAndGrad(
          w1,
          w2,
          packed.trainX,
          packed.trainY,
          g.lossKind,
          wasmDelta,
          g.regularizationKind,
          wasmLambda,
          g.subgradConvention
        ),
      50
    ).then((wasmRes) => {
      if (!wasmRes.ok || myWasmSeq !== wasmSeqRef.current) return;
      const curr = graphStore.getState();
      curr.applyWorkerResult({
        curves: curr.curves,
        trainLoss: curr.trainLoss,
        testLoss: curr.testLoss,
        lossGrid: curr.lossGrid,
        minLoss: curr.minLoss,
        maxLoss: curr.maxLoss,
        vectorField: curr.vectorField,
        trajectories: {
          ...curr.trajectories,
          custom_js: wasmRes.trajectory,
        },
        linkedBrushPull: curr.linkedBrushPull,
        computeDurationMs: curr.computeDurationMs,
      });
    });
  }, [
    gForWasm.optimizerRace.enabledOptimizers.custom_js,
    gForWasm.optimizerRace.customJsCode,
    gForWasm.optimizerRace.startW1,
    gForWasm.optimizerRace.startW2,
    gForWasm.optimizerRace.steps,
    gForWasm.dataPoints,
    gForWasm.batchNormEnabled,
    gForWasm.lossKind,
    gForWasm.regularizationKind,
    gForWasm.subgradConvention,
    wasmDelta,
    wasmLambda,
    wasmEta,
    wasmBeta1,
  ]);

  // Wire Header buttons (#share-btn, #mydocs-btn), Theme & Lang events, and Initial / Dynamic URL Hash
  useEffect(() => {
    const onShareClick = (): void => graphStore.getState().setShareModalOpen(true);
    const onDocsClick = (): void => graphStore.getState().setGalleryDrawerOpen(true, 'my_docs');
    const onThemeChange = (e: Event): void => {
      const custom = e as CustomEvent<{ theme: 'dark' | 'light' }>;
      setIsDark(custom.detail?.theme === 'dark');
    };
    const onLangChange = (): void => setLangTick((n) => n + 1);

    const shareBtn = document.getElementById('share-btn');
    const docsBtn = document.getElementById('mydocs-btn');
    shareBtn?.addEventListener('click', onShareClick);
    docsBtn?.addEventListener('click', onDocsClick);
    window.addEventListener('themechange', onThemeChange);
    window.addEventListener('langchange', onLangChange);

    // Check URL Hash route or restore from localStorage
    const resolveHashRoute = async (isInitialLoad: boolean): Promise<void> => {
      const route = classifyUrlHash(location.hash);
      const st = graphStore.getState();

      if (route.mode === 'local_url') {
        const currentHash = encodeStateToUrlHashSync(st.graph);
        if (!isInitialLoad && route.rawHash === currentHash) return;
        const decoded = decodeStateFromUrlHashSync(route.rawHash, st.graph);
        if (decoded) {
          st.setSessionMode('local_url', null);
          st.loadFullState(decoded, false);
          return;
        }
      } else if (route.mode === 'cloud_e2ee' && isFirebaseConfigured) {
        try {
          const stored = await fetchPaste(route.pasteId);
          if (stored) {
            const key = keyFromString(route.aesKey);
            const { title, body } = decodePayload(await decrypt(stored.enc, key));
            const parsed = migrateSchemaToV2(JSON.parse(body), st.graph);
            st.setSessionMode('cloud_e2ee', {
              id: route.pasteId,
              keyStr: route.aesKey,
              mode: stored.mode,
              isDirty: false,
            });
            st.loadFullState({ ...parsed, title: title || parsed.title }, false);
            showToast(`Loaded encrypted cloud graph (${stored.mode})`);
            return;
          }
        } catch {
          showToast('Could not decrypt cloud link');
        }
      } else if (route.mode === 'public_gallery' && isFirebaseConfigured) {
        try {
          const item = await fetchCommunityGraph(route.graphId);
          if (item) {
            const decoded = decodeStateFromUrlHashSync(item.payload, st.graph);
            if (decoded) {
              st.setSessionMode('public_gallery', null);
              st.loadFullState({ ...decoded, title: item.title }, false);
              showToast(`Opened "${item.title}" by ${item.author}`);
              return;
            }
          }
        } catch {
          showToast('Could not load community graph');
        }
      }

      if (isInitialLoad) {
        // Default on entering the web app without a URL hash is always Blank Canvas (T-00)
        st.setSessionMode('local_url', null);
        st.loadFullState(createInitialGraphState('T-00'), false);
      }
    };

    const onHashChange = (): void => {
      void resolveHashRoute(false);
    };
    window.addEventListener('hashchange', onHashChange);

    void resolveHashRoute(true);

    return () => {
      shareBtn?.removeEventListener('click', onShareClick);
      docsBtn?.removeEventListener('click', onDocsClick);
      window.removeEventListener('themechange', onThemeChange);
      window.removeEventListener('langchange', onLangChange);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  const handleSaveCloudInPlace = async (): Promise<void> => {
    const meta = storeState.cloudMeta;
    if (!meta || meta.mode !== 'editable' || !meta.keyStr) return;
    try {
      const key = keyFromString(meta.keyStr);
      const body = JSON.stringify(storeState.graph);
      const enc = await encrypt(encodePayload(storeState.graph.title, body), key);
      await updatePaste(meta.id, enc);
      storeState.setSessionMode('cloud_e2ee', { ...meta, isDirty: false });
      showToast('Updated Cloud E2EE link in place!');
    } catch {
      showToast('Failed to update Cloud link.');
    }
  };

  return (
    <div
      class="flex-1 flex flex-col min-h-0 w-full select-none"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;
        file.text().then((txt) => {
          try {
            const imported = migrateSchemaToV2(JSON.parse(txt), storeState.graph);
            storeState.loadFullState(imported, true);
            showToast('Imported .json session!');
          } catch {
            showToast('Invalid JSON file.');
          }
        });
      }}
    >
      <ToolbarSubheader
        storeState={storeState}
        sidebarOpen={desktopSidebarOpen}
        onToggleSidebar={() => setDesktopSidebarOpen((prev) => !prev)}
        onToast={showToast}
        onExportPng={() =>
          exportDualViewportPng({
            leftCanvas: leftCanvasRef.current,
            rightGlCanvas: rightGlCanvasRef.current,
            rightOverlayCanvas: rightOverlayCanvasRef.current,
            title: storeState.graph.title,
            primaryLatex:
              getPlottableExpressions(storeState.graph.expressions)[0]?.latex ?? 'f(x)',
            isDark,
          })
        }
      />

      {/* Main Workspace: below lg the graph sits on top with a 3-tier bottom sheet + sub-tabs; from lg a resizable left sidebar + dual viewport */}
      <div class="flex-1 flex flex-col-reverse lg:flex-row min-h-0 overflow-hidden">
        <div
          ref={(el) => {
            sidebarContainerRef.current = el;
          }}
          style={
            isDesktopLg && desktopSidebarOpen && sidebarWidthPx !== null
              ? { width: `${sidebarWidthPx}px` }
              : undefined
          }
          class={`relative w-full max-h-[calc(100%-40px)] lg:max-h-none min-h-0 ${
            desktopSidebarOpen
              ? sidebarWidthPx !== null
                ? 'lg:flex'
                : 'lg:w-80 xl:w-96 lg:flex'
              : 'lg:hidden'
          } shrink-0 flex flex-col border-t lg:border-t-0 lg:border-r border-neutral-200 dark:border-neutral-800 bg-neutral-50/75 dark:bg-neutral-900/75`}
        >
          {/* 3-Tier Bottom-Sheet Handle + Sticky Sub-Tabs (< 1024px) */}
          <div class="lg:hidden shrink-0 border-b border-neutral-200/80 dark:border-neutral-800/80 bg-neutral-50 dark:bg-neutral-900">
            <MobileSheetHandle
              tier={mobileSheetTier}
              onTierChange={setMobileSheetTier}
            />

            {mobileSheetTier !== 'collapsed' && (
              <div
                role="tablist"
                aria-label="Panel sections"
                class="grid grid-cols-4 gap-1 px-2 pb-1.5 text-[11px]"
              >
                {(
                  [
                    { id: 'all', label: t('subtab_all') },
                    {
                      id: 'fx',
                      label: `${t('subtab_fx')} (${storeState.graph.expressions.length})`,
                    },
                    {
                      id: 'sliders',
                      label: `${t('subtab_sliders')} (${Object.keys(storeState.graph.sliders).length})`,
                    },
                    {
                      id: 'data',
                      label: `${t('subtab_data')} (${storeState.graph.dataPoints.length})`,
                    },
                  ] as const
                ).map((tabItem) => {
                  const active = mobilePanelSection === tabItem.id;
                  return (
                    <button
                      key={tabItem.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => {
                        setMobilePanelSection(tabItem.id);
                        if (asideScrollRef.current) {
                          asideScrollRef.current.scrollTop = 0;
                        }
                      }}
                      class={`h-6 px-1 rounded font-semibold truncate transition-colors ${
                        active
                          ? 'bg-orange-500 text-white shadow-2xs'
                          : 'bg-neutral-200/70 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100'
                      }`}
                    >
                      {tabItem.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <aside
            ref={(el) => {
              asideScrollRef.current = el;
            }}
            class={`w-full min-h-0 overflow-y-auto overscroll-contain ${
              mobileSheetTier === 'collapsed'
                ? 'hidden lg:block lg:max-h-none'
                : mobileSheetTier === 'full'
                  ? 'max-h-[78vh] lg:max-h-none block'
                  : 'max-h-[40vh] sm:max-h-[44vh] lg:max-h-none block'
            } flex-1`}
          >
            {(isDesktopLg || mobilePanelSection !== 'data') && (
              <ExpressionSidebar
                storeState={storeState}
                visibleSection={
                  !isDesktopLg &&
                  (mobilePanelSection === 'fx' || mobilePanelSection === 'sliders')
                    ? mobilePanelSection
                    : 'all'
                }
              />
            )}
            {(isDesktopLg ||
              mobilePanelSection === 'all' ||
              mobilePanelSection === 'data') && (
              <DataTablePanel storeState={storeState} />
            )}
          </aside>

          {/* Desktop Resizable Right-Edge Splitter (280px – 520px, double-click resets) */}
          {desktopSidebarOpen && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t('resize_sidebar_tooltip')}
              title={t('resize_sidebar_tooltip')}
              onDblClick={() => {
                setSidebarWidthPx(null);
                writeStoredSidebarWidth(null);
              }}
              onPointerDown={(e) => {
                if (e.button !== 0 && e.pointerType === 'mouse') return;
                const currentW =
                  sidebarContainerRef.current?.getBoundingClientRect().width ?? 320;
                sidebarResizeRef.current = {
                  pointerId: e.pointerId,
                  startX: e.clientX,
                  startW: currentW,
                  latestW: currentW,
                };
                try {
                  (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
                } catch {
                  /* ignore synthetic pointerId in tests */
                }
              }}
              onPointerMove={(e) => {
                const sess = sidebarResizeRef.current;
                if (!sess || sess.pointerId !== e.pointerId) return;
                const maxAllowed =
                  typeof window !== 'undefined'
                    ? Math.min(SIDEBAR_MAX_WIDTH_PX, Math.round(window.innerWidth * 0.48))
                    : SIDEBAR_MAX_WIDTH_PX;
                const clamped = Math.min(
                  Math.max(SIDEBAR_MIN_WIDTH_PX, Math.round(sess.startW + (e.clientX - sess.startX))),
                  Math.max(SIDEBAR_MIN_WIDTH_PX, maxAllowed)
                );
                sess.latestW = clamped;
                setSidebarWidthPx(clamped);
              }}
              onPointerUp={(e) => {
                if (sidebarResizeRef.current?.pointerId === e.pointerId) {
                  const finalW = sidebarResizeRef.current.latestW;
                  sidebarResizeRef.current = null;
                  writeStoredSidebarWidth(finalW);
                }
              }}
              onPointerCancel={() => {
                sidebarResizeRef.current = null;
              }}
              class="hidden lg:block absolute top-0 -right-1 bottom-0 w-2 cursor-col-resize z-30 touch-none hover:bg-orange-500/35 active:bg-orange-500/60 transition-colors"
            />
          )}
        </div>

        <DualViewportPanel
          storeState={storeState}
          isDark={isDark}
          leftCanvasRef={leftCanvasRef}
          rightGlCanvasRef={rightGlCanvasRef}
          rightOverlayCanvasRef={rightOverlayCanvasRef}
        />
      </div>

      {/* Bottom 4-Optimizer Race Bar (Shown only when 3D/Contour Loss Surface is visible) */}
      {storeState.graph.viewMode !== 'inference' &&
        storeState.graph.rightViewportMode === 'loss_surface' && (
          <OptimizerRaceBar storeState={storeState} />
        )}

      {/* Active Cloud E2EE Session Status Bar */}
      {storeState.sessionMode === 'cloud_e2ee' && storeState.cloudMeta && (
        <div class="flex items-center justify-between px-4 py-1.5 bg-orange-500/15 border-t border-orange-500/30 text-xs">
          <span>
            Cloud E2EE Session ({storeState.cloudMeta.mode}){' '}
            {storeState.cloudMeta.isDirty ? '• Unsaved edits' : '• Saved'}
          </span>
          <div class="flex items-center gap-2">
            {storeState.cloudMeta.mode === 'editable' && (
              <button
                type="button"
                onClick={() => void handleSaveCloudInPlace()}
                class="px-2.5 py-0.5 rounded bg-orange-500 text-white font-semibold"
              >
                Save to Cloud Link
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                storeState.setSessionMode('local_url', null);
                history.replaceState(null, '', location.pathname);
              }}
              class="px-2 py-0.5 rounded border border-neutral-400"
            >
              Detach
            </button>
          </div>
        </div>
      )}

      {/* Modals & Drawers */}
      <CustomOptimizerModal storeState={storeState} onToast={showToast} />
      <SharePublishModal storeState={storeState} onToast={showToast} />
      <CommunityGalleryDrawer storeState={storeState} onToast={showToast} />
      <FunctionLibraryDrawer storeState={storeState} onToast={showToast} />

      {/* Toast Notification */}
      {toastMsg && (
        <div class="fixed bottom-14 right-4 z-50 pointer-events-none px-3.5 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-xs font-semibold shadow-lg">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
