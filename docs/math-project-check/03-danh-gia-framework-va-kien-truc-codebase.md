# 03. Đánh Giá Framework & Kiến Trúc Codebase: Code Tiếp Hay Đổi Framework?

Tài liệu này trả lời trực tiếp câu hỏi trọng tâm: **Chúng ta có thể code tiếp module OpenMLGraph ngay trên kho mã nguồn hiện tại (`vinhmdev.github.io`) hay phải chuyển sang một framework khác?**

---

## 1. Khảo Sát Thực Trạng Kỹ Thuật Kho Mã Nguồn Hiện Tại (`vinhmdev.github.io`)

Qua kiểm tra trực tiếp [`package.json`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/package.json), [`astro.config.mjs`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/astro.config.mjs), [`tsconfig.json`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/tsconfig.json) và cấu trúc thư mục [`src/`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/src/), hệ thống hiện tại có các đặc điểm kỹ thuật sau:

- **Meta-Framework & Bundler:** **Astro `^6.0.2`** kết hợp **Vite** ở tầng dưới (`output: 'static'`), biên dịch ra các trang tĩnh tốc độ cao triển khai trên `https://tools.vinhmdev.com`.
- **Styling & UI:** **Tailwind CSS v4** (`@tailwindcss/vite: ^4.2.1`), hệ thống Dark/Light theme đồng bộ (`@shared/theme/toggle`), đa ngôn ngữ Anh/Việt (`@shared/i18n/runtime.ts`).
- **Các gói phụ thuộc đã cài sẵn có thể tái sử dụng ngay cho OpenMLGraph:**
  - `firebase: ^12.10.0` (Đã cấu hình sẵn Singleton App tại [`src/shared/firebase/app.ts`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/src/shared/firebase/app.ts) và Firestore E2EE Store tại [`src/shared/paste/store.ts`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/src/shared/paste/store.ts)).
  - `katex: ^0.16.45` + `@types/katex: ^0.16.8` (Đã có sẵn để hiển thị công thức toán học tốc độ cao trên Canvas/DOM).
  - `dompurify: ^3.4.2` (Vệ sinh chuỗi HTML/LaTeX an toàn).
  - `typescript: ^5.7.3` (Strict type-checking).
- **Kiến trúc hiện tại:** **Vertical Slice Architecture (VSA)** — Mỗi công cụ nằm gọn trong một thư mục độc lập dưới `src/features/<ten-module>/` và được gắn route tại `src/pages/<ten-route>/index.astro`:
  - `src/features/paste2md/` $\rightarrow$ `src/pages/paste2md/index.astro`
  - `src/features/encrypted-paste/` $\rightarrow$ `src/pages/paste/index.astro`
  - `src/features/llm-hardware-profiler/` $\rightarrow$ `src/pages/llm-hardware-profiler/index.astro`

---

## 2. Phân Tích & So Sánh 3 Phương Án Kiến Trúc

Chúng ta đặt lên bàn cân 3 phương án kiến trúc để xây dựng **OpenMLGraph**:

### Phương án A: Giữ nguyên Astro 6 + Viết UI bằng Vanilla TypeScript (như `llm-hardware-profiler`)

- **Cách làm:** Tạo `src/features/openmlgraph/page.astro` và điều khiển toàn bộ giao diện bằng `document.getElementById` / `document.createElement` thuần giống như [`src/features/llm-hardware-profiler/scripts/app.ts`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/src/features/llm-hardware-profiler/scripts/app.ts) (hiện đã dài `1.064` dòng).
- **Ưu điểm:** Không cần cài thêm thư viện UI (`preact`/`react`).
- **Nhược điểm (Chí mạng đối với OpenMLGraph):**
  - Khác với form tĩnh của `llm-hardware-profiler`, OpenMLGraph có **danh sách biểu thức động** (thêm/xóa/ẩn/hiện công thức), **danh sách thanh trượt sinh/hủy liên tục khi người dùng gõ công thức**, **dải huy hiệu hoán đổi vai trò (`[Data]` $\leftrightarrow$ `[Param]` $\leftrightarrow$ `[Hyperparam]`)**, **bảng điểm dữ liệu tương tác**, và **thanh điều khiển Timeline Scrubber**.
  - Nếu quản lý trạng thái UI đồng bộ phức tạp này bằng DOM thủ công (`querySelector` / `innerHTML`), mã nguồn sẽ phình lên $> 3.500$ dòng code rối rắm, rất dễ phát sinh lỗi mất đồng bộ trạng thái (stale DOM state) hoặc làm mất focus ô nhập `MathLive` khi đang gõ công thức.

---

### Phương án B (KHUYẾN NGHỊ TỐI ƯU): Code tiếp trên Repo Astro 6 hiện tại + Tích hợp `Preact` + `Zustand` cho riêng Slice `openmlgraph`

- **Cách làm:**
  - Giữ nguyên kho mã nguồn `vinhmdev.github.io` (Astro 6 + Vite).
  - Tạo route mới tại `src/pages/openmlgraph/index.astro` (hoặc `/math-sandbox/`) sử dụng chung `BaseLayout.astro`, Header, Theme Dark/Light, i18n và hạ tầng Firebase sẵn có.
  - Cài bổ sung **`preact` (`~3.5 KB` gzipped) + `@astrojs/preact` + `zustand` (`~1.2 KB` gzipped)** — đúng 100% theo quy định tại [Mục 2 của SRS v2.0.0](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/docs/math-project-resaerch/t_i_li_u_c_t_y_u_c_u_ph_n_m_m_openmlgraph_srs_v2_0_0.md#L26).
  - Chỉ mount component `<OpenMLGraphApp client:only="preact" />` bên trong trang `/openmlgraph/`, hoàn toàn **không làm tăng dù chỉ 1 byte JS** cho các công cụ hiện có (`paste2md`, `paste`, `llm-hardware-profiler`).
  - Tách bạch rõ 2 tầng:
    1. **Tầng UI Phản ứng (Preact + Zustand — chạy ở 60Hz khi state cấu trúc đổi):** Quản lý Sidebar biểu thức, Sliders, Role Badges, Template Picker, Modal Share Firebase, My Saved Graphs Drawer.
    2. **Tầng Engine Toán & Đồ họa (Pure TypeScript + Web Worker + Canvas 2D + WebGL2 — chạy ở 60–120 FPS):** Hoàn toàn độc lập với Preact. Khi người dùng kéo thanh trượt hoặc kéo điểm dữ liệu trên Canvas, sự kiện đi thẳng vào vòng lặp `requestAnimationFrame` và bộ nhớ `Float64Array` để đạt ngân sách $< 4.0\text{ ms}$ mà không kích hoạt Preact re-render toàn cây DOM.

---

### Phương án C: Chuyển sang một Framework khác / Tách Repo SPA riêng (Next.js, React Vite độc lập, SvelteKit...)

- **Cách làm:** Tạo một dự án mới hoàn toàn bằng Vite + React/Svelte hoặc Next.js bên ngoài Astro.
- **Tại sao KHÔNG NÊN chọn Phương án C?**
  1. **Bản thân Astro 6 ĐÃ LÀ Vite ở bên dưới:** Mọi tính năng mà một ứng dụng Vite SPA có — bao gồm Web Workers (`new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`), `import.meta.glob` cho hệ thống Plugin (`[FR-5.3]`), hỗ trợ gói `.wasm`, cấu hình Vite plugin trong `astro.config.mjs` — đều hoạt động y hệt 100% trong Astro 6!
  2. **Lãng phí hạ tầng dùng chung sẵn có:** Tách sang framework khác đồng nghĩa với việc phải viết lại từ đầu hệ thống Firebase Singleton (`src/shared/firebase/`), mã hóa AES-256-GCM (`src/shared/paste/`), giao diện Share/Drawer (`src/shared/paste-share/`), Theme Dark/Light, Cookie Consent, SEO Head và quy trình CI/CD GitHub Pages.
  3. **Phá vỡ tính thống nhất của hệ sinh thái `tools.vinhmdev.com`:** Giữ chung trong một repo giúp người dùng chuyển đổi liền mạch giữa _LLM Hardware Estimator_, _Paste to Markdown_, _Encrypted Paste_ và _OpenMLGraph_.

---

## 3. Bảng So Sánh Quyết Định Kỹ Thuật

| Tiêu chí Đánh giá                                       |         Phương án A: Astro 6 + Vanilla TS         |  Phương án B: Astro 6 + Preact Island + Zustand (Khuyến nghị)   | Phương án C: Đổi sang Framework khác (React SPA / Next.js riêng) |
| :------------------------------------------------------ | :-----------------------------------------------: | :-------------------------------------------------------------: | :--------------------------------------------------------------: |
| **Tái sử dụng Firebase, Theme, i18n, Layout sẵn có**    |                 ✅ Tối đa (100%)                  |                      ✅ **Tối đa (100%)**                       |                 ❌ Phải viết/cấu hình lại từ đầu                 |
| **Khả năng bảo trì UI phức tạp (Sliders, Badges, AST)** | ❌ Kém (Code DOM thủ công dễ phình $>3.500$ dòng) |        ✅ **Xuất sắc (Declarative UI + Zustand store)**         |                              ✅ Tốt                              |
| **Đạt hiệu năng `<4ms` / 60–120 FPS (`[NFR-1]`)**       |                      ✅ Đạt                       | ✅ **Đạt (Bypass VDOM khi drag qua Zustand transient updates)** |                              ✅ Đạt                              |
| **Tương thích yêu cầu `package.json` của SRS v2.0.0**   |           ⚠️ Thiếu `preact` + `zustand`           |              ✅ **Khớp 100% chuẩn SRS (100% MIT)**              |             ⚠️ Dư thừa nếu dùng Next.js / React nặng             |
| **Ảnh hưởng tới tốc độ tải các trang công cụ cũ**       |                 ✅ 0 KB ảnh hưởng                 |      ✅ **0 KB ảnh hưởng (Isolate trong `/openmlgraph/`)**      |                      N/A (Khác repo/build)                       |
| **Hỗ trợ Vite Web Worker, WASM, `import.meta.glob`**    |                   ✅ Hỗ trợ gốc                   |         ✅ **Hỗ trợ gốc qua `astro.config.mjs` (Vite)**         |                          ✅ Hỗ trợ gốc                           |

> **🔥 KẾT LUẬN KIẾN TRÚC:**
> **Chúng ta hoàn toàn CÓ THỂ và NÊN CODE TIẾP ngay trên kho mã nguồn Astro 6 + Vite hiện tại theo Phương án B** (tích hợp thêm `preact` + `zustand` làm Island cho trang `/openmlgraph/`, giữ toàn bộ lõi giải tích, đồ họa 2D/3D và lưu trữ Firebase bằng TypeScript thuần).

---

## 4. Thiết Kế Cấu Trúc Thư Mục Đề Xuất (`src/features/openmlgraph/`)

Tuân thủ nghiêm ngặt quy tắc trong [`AGENTS.md`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/AGENTS.md) (_"Keep code modular. Do not bundle massive changes into single files if they can be decoupled"_) và kiến trúc Vertical Slice của repo:

```text
src/
├── pages/
│   └── openmlgraph/
│       └── index.astro                 # Route entry mỏng, nhúng BaseLayout & OpenMLGraph page
├── shared/
│   ├── firebase/                       # [SẴN CÓ] Singleton Firebase App & Config
│   ├── paste/                          # [SẴN CÓ] Mã hóa AES-256-GCM & Firestore Store
│   └── paste-share/                    # [SẴN CÓ] Modal Share, Status Bar & Local Doc History
└── features/
    └── openmlgraph/
        ├── page.astro                  # Shell trang OpenMLGraph (Header, Share/Gallery buttons, Mount root)
        ├── i18n/
        │   ├── en.json                 # Từ điển tiếng Anh cho OpenMLGraph
        │   └── vi.json                 # Từ điển tiếng Việt cho OpenMLGraph
        ├── styles/
        │   └── openmlgraph.css         # Styles chuyên biệt & biến màu ngữ nghĩa (Opacity Layering)
        ├── core/                       # TẦNG 1: PURE TS MATH & CAS ENGINE (Zero UI dependencies)
        │   ├── parser/
        │   │   ├── cortex-setup.ts     # Khởi tạo ComputeEngine & đăng ký 16 hàm ML vào latexDictionary
        │   │   ├── ast-classifier.ts   # Phân loại 5 nhóm ký hiệu [FR-1.2]
        │   │   └── stability-pass.ts   # Viết lại AST chống tràn số IEEE 754 (SafeSigmoid, BCEWithLogits) [FR-2.4]
        │   ├── calculus/
        │   │   ├── symbolic-diff.ts    # Đạo hàm bậc 1/2 & Clarke Subdifferential (H(x), sign, Dirac) [FR-2.1]
        │   │   ├── dual-jet2.ts        # Số Siêu Kép bậc 2 (Jet2 + branchMask) & Unboxed Dual Numbers [FR-2.3]
        │   │   └── jit-compiler.ts     # Biên dịch AST + LICM + CSE sang JS Closure (new Function)
        │   ├── geometry/
        │   │   ├── adaptive-sampler.ts # Lấy mẫu đệ quy không gian màn hình 64 hạt giống tỷ lệ vàng [FR-3.1]
        │   │   ├── interval-guard.ts   # Phát hiện kỳ dị/tiệm cận & ngắt đa tuyến NaN [FR-3.2]
        │   │   └── poi-finder.ts       # Trích xuất nghiệm, cực trị, điểm uốn & điểm gãy bằng Brent [FR-3.3]
        │   └── simulation/
        │       ├── optimizers.ts       # SGD, Momentum/NAG, RMSProp, Adam + Divergence Guard [FR-4.2]
        │       ├── loss-Evaluator.ts   # Tính lưới Loss 128x128, Vector Field 50x50 & Linked Brushing [FR-4.1]
        │       └── special-kernels.ts  # Nhân chuyên biệt cho BatchNorm (T-12), ROC (T-13), RBF (T-14), MLP (T-15)
        ├── renderers/                  # TẦNG 2: HIGH-FPS RENDERING ENGINE (Canvas 2D + WebGL2)
        │   ├── canvas2d-renderer.ts    # Vẽ đường cong 2D, tiếp tuyến, hình vuông sai số r_i^2, miền L1/L2
        │   ├── webgl2-surface.ts       # Vẽ mặt Loss 3D + fwidth() Contours + GPU Instanced Vector Arrows [FR-3.4]
        │   └── viewport-controller.ts  # Quản lý ma trận Zoom/Pan đồng bộ 2 khung nhìn & Hit-testing
        ├── worker/                     # TẦNG 3: WEB WORKER & MEMORY CONCURRENCY
        │   ├── compute.worker.ts       # Worker xử lý lấy mẫu & quỹ đạo tối ưu hóa
        │   └── double-buffer.ts        # Ping-Pong Transferable ArrayBuffer (tự nâng cấp lên SAB nếu có) [NFR-1]
        ├── state/                      # TẦNG 4: STATE, URL CODEC & FIREBASE SHARING
        │   ├── store.ts                # Kho trạng thái Zustand (hỗ trợ transient subscription cho 60-120 FPS)
        │   ├── url-codec.ts            # Nén #v2.dr.<payload> bằng CompressionStream('deflate-raw') [FR-5.2]
        │   └── firebase-graph-share.ts # Lưu & Chia sẻ đồ thị qua Firebase Firestore (E2EE + Public Gallery)
        ├── extensions/                 # TẦNG 5: DECLARATIVE PLUGINS & 15 TEMPLATES
        │   ├── contracts.ts            # defineMathFunction, defineOptimizer, defineLesson [FR-5.3]
        │   └── templates/              # 15 mẫu 1-Click (T-01 đến T-15) tự động nạp qua import.meta.glob [FR-4.4]
        └── ui/                         # TẦNG 6: PREACT REACTIVE UI COMPONENTS
            ├── OpenMLGraphApp.tsx      # Root Island component
            ├── ExpressionSidebar.tsx   # Danh sách ô nhập MathLive + Role-Swapping Badges + Parameter Sliders
            ├── DualViewportPanel.tsx   # Khung nhìn chia đôi Data Space (Trái) & Parameter/Loss Space (Phải)
            ├── OptimizerRaceBar.tsx    # Drop-Ring Launcher + Timeline Scrubber + L1/L2 Regularization toggles
            └── CommunityGalleryModal.tsx # Thư viện khám phá & chia sẻ đồ thị cộng đồng trên Firebase
```

---

## 5. Danh Sách Gói NPM Cần Cài Bổ Sung Vào `package.json`

So với [`package.json` hiện tại](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/package.json) (đã có `astro`, `firebase`, `katex`, `tailwindcss`, `typescript`), chúng ta chỉ cần cài thêm các gói chuẩn **100% MIT License** sau:

| Gói NPM                      | Phiên bản                | Giấy phép | Mục đích & Ghi chú                                                                                                                             |
| :--------------------------- | :----------------------- | :-------: | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| `preact` + `@astrojs/preact` | `^10.25.0` / `^4.0.0`    |    MIT    | Quản lý giao diện phản ứng siêu nhẹ (~3.5 KB) cho riêng trang OpenMLGraph.                                                                     |
| `zustand`                    | `^5.0.0` (hoặc `^4.5.0`) |    MIT    | Quản lý kho trạng thái đồng bộ, hỗ trợ đọc trạng thái không qua re-render (`getState()` / `subscribe`) trong vòng lặp `requestAnimationFrame`. |
| `mathlive`                   | `^0.101.0+`              |    MIT    | Ô nhập công thức toán học trực quan & copy-paste LaTeX hai chiều (`[FR-1.1]`).                                                                 |
| `@cortex-js/compute-engine`  | `^0.25.0+`               |    MIT    | Phân tích cú pháp sang AST MathJSON và tính đạo hàm biểu tượng (`[FR-1.1]`, `[FR-2.1]`).                                                       |
| `fflate`                     | `^0.8.2`                 |    MIT    | Dự phòng nén `deflate-raw` đồng bộ siêu nhẹ (4.6 KB) bên cạnh `CompressionStream` gốc (`[FR-5.2]`).                                            |
| `vitest` (devDependency)     | `^2.1.0+`                |    MIT    | Kiểm thử đơn vị cho giải tích số học IEEE 754, đạo hàm `Jet2` và bộ nén URL (`[AC-01..05]`).                                                   |

_(Lưu ý: Như đã phân tích ở File 01, khuyến nghị dùng **Native WebGL2 wrapper nội bộ** thay cho `regl` để hỗ trợ gốc GLSL ES 3.00 mà không phát sinh thêm dependency, và chỉ cài `quickjs-emscripten` ở Phase 4 dưới dạng dynamic import)._
