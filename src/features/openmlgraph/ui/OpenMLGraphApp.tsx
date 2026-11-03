/**
 * Root OpenMLGraph Preact Island Component.
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
import { OptimizerRaceBar } from './OptimizerRaceBar';
import { SharePublishModal } from './SharePublishModal';
import { ToolbarSubheader } from './ToolbarSubheader';

export default function OpenMLGraphApp(): JSX.Element {
  const [storeState, setStoreState] = useState<GraphStoreState>(() => graphStore.getState());
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('dark')
      : true
  );
  const [, setLangTick] = useState(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [mobileSheetOpen, setMobileSheetOpen] = useState<boolean>(true);

  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);
  const wasmSeqRef = useRef(0);
  const leftCanvasRef = useRef<HTMLCanvasElement>(null);
  const rightGlCanvasRef = useRef<HTMLCanvasElement>(null);
  const rightOverlayCanvasRef = useRef<HTMLCanvasElement>(null);

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
        .register('/openmlgraph-sw.js', { updateViaCache: 'none' })
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
    for (const [k, sl] of Object.entries(g.sliders)) {
      paramValues[k] = sl.value;
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
      expressions: g.expressions,
      paramValues,
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
    const onDocsClick = (): void => graphStore.getState().setGalleryDrawerOpen(true);
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
        onToast={showToast}
        onExportPng={() =>
          exportDualViewportPng({
            leftCanvas: leftCanvasRef.current,
            rightGlCanvas: rightGlCanvasRef.current,
            rightOverlayCanvas: rightOverlayCanvasRef.current,
            title: storeState.graph.title,
            primaryLatex: storeState.graph.expressions[0]?.latex ?? 'f(x)',
            isDark,
          })
        }
      />

      {/* Main Workspace: Mobile puts Graph on Top + Collapsible Bottom Sheet; Desktop puts Left Sidebar + Right Dual Viewport */}
      <div class="flex-1 flex flex-col-reverse md:flex-row min-h-0 overflow-hidden">
        <div class="w-full md:w-80 lg:w-96 shrink-0 flex flex-col border-t md:border-t-0 md:border-r border-neutral-200 dark:border-neutral-800 bg-neutral-50/75 dark:bg-neutral-900/75">
          {/* Mobile Bottom-Sheet Collapse / Expand Bar (< 768px) */}
          <div class="flex md:hidden items-center justify-between px-3 py-1.5 bg-neutral-100/90 dark:bg-neutral-900 border-b border-neutral-200/80 dark:border-neutral-800 text-xs">
            <button
              type="button"
              onClick={() => setMobileSheetOpen((prev) => !prev)}
              aria-expanded={mobileSheetOpen}
              class="flex items-center gap-2 font-semibold text-neutral-700 dark:text-neutral-200"
            >
              <span class="w-6 h-1 rounded-full bg-neutral-300 dark:bg-neutral-700" />
              <span>
                𝑓(x) ({storeState.graph.expressions.length})
                {Object.keys(storeState.graph.sliders).length > 0
                  ? ` • Sliders (${Object.keys(storeState.graph.sliders).length})`
                  : ''}
              </span>
              <span class="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 text-[10px] font-bold">
                {mobileSheetOpen ? '▾ Hide' : '▴ Show'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                storeState.addExpression();
                setMobileSheetOpen(true);
              }}
              class="px-2 py-0.5 rounded bg-orange-500 text-white font-semibold text-[11px]"
            >
              + f(x)
            </button>
          </div>

          <aside
            class={`w-full overflow-y-auto transition-all ${
              mobileSheetOpen
                ? 'max-h-[40vh] md:max-h-none block'
                : 'hidden md:block md:max-h-none'
            } flex-1`}
          >
            <ExpressionSidebar storeState={storeState} />
            <DataTablePanel storeState={storeState} />
          </aside>
        </div>

        <DualViewportPanel
          storeState={storeState}
          isDark={isDark}
          leftCanvasRef={leftCanvasRef}
          rightGlCanvasRef={rightGlCanvasRef}
          rightOverlayCanvasRef={rightOverlayCanvasRef}
        />
      </div>

      {/* Bottom 4-Optimizer Race Bar (Shown in ML Optimization / Dual-Space modes) */}
      {storeState.workspaceMode === 'ml' && storeState.graph.viewMode !== 'inference' && (
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

      {/* Toast Notification */}
      {toastMsg && (
        <div class="fixed bottom-14 right-4 z-50 px-3.5 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-xs font-semibold shadow-lg">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
