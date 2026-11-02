# Báo Cáo Đánh Giá Toàn Diện Dự Án OpenMLGraph (v2.0.0)

> **Phạm vi tài liệu:** Đánh giá khả thi kỹ thuật, phân tích đủ/thiếu tính năng (Gap Analysis), quyết định kiến trúc Framework (tiếp tục trên codebase hiện tại hay chuyển framework khác), và thiết kế hệ thống lưu trữ/chia sẻ qua **Firebase Firestore** cho module mới **OpenMLGraph** trên kho mã nguồn [`vinhmdev.github.io`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/package.json).

---

## 1. Danh Mục Tài Liệu Đánh Giá Trong Thư Mục Này

Bộ tài liệu đánh giá được chia thành 5 tệp chuyên biệt để dễ dàng tra cứu theo từng quyết định kỹ thuật:

1. **[`README.md`](./README.md) (Tài liệu này):** Tổng quan điều hành (Executive Summary), tóm tắt 4 kết luận cốt lõi và lộ trình triển khai theo giai đoạn (Phased Roadmap).
2. **[`01-danh-gia-kha-thi-ky-thuat.md`](./01-danh-gia-kha-thi-ky-thuat.md):** Đánh giá tính khả thi kỹ thuật chi tiết cho từng Module (`Module 1` $\rightarrow$ `Module 5`) và các yêu cầu phi chức năng (`NFR-1` $\rightarrow$ `NFR-4`), đối chiếu trực tiếp với 4 tài liệu nghiên cứu gốc trong [`docs/math-project-resaerch/`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/docs/math-project-resaerch/).
3. **[`02-danh-gia-du-thieu-tinh-nang.md`](./02-danh-gia-du-thieu-tinh-nang.md):** Phân tích khoảng trống tính năng (Feature Gap Analysis) — chỉ ra các tính năng đã đủ, các tính năng bị dư thừa/quá tải (over-engineered), các mâu thuẫn nội tại giữa danh mục 15 mẫu (`T-01` $\rightarrow$ `T-15`) với Engine lõi, và các tính năng thực tế còn thiếu.
4. **[`03-danh-gia-framework-va-kien-truc-codebase.md`](./03-danh-gia-framework-va-kien-truc-codebase.md):** Đánh giá kiến trúc: **Có thể code tiếp trên nền tảng Astro 6 + Vite + TypeScript hiện tại hay phải chuyển sang framework khác?** Phân tích ưu/nhược điểm và đề xuất cấu trúc thư mục Vertical Slice (`src/features/openmlgraph/`).
5. **[`04-kien-truc-luu-tru-firebase-va-chia-se.md`](./04-kien-truc-luu-tru-firebase-va-chia-se.md):** Thiết kế kiến trúc cho phép người dùng **lưu dữ liệu vào Firebase và chia sẻ với mọi người**, kế thừa và mở rộng hạ tầng [`src/shared/paste/`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/src/shared/paste/store.ts), [`src/shared/paste-share/`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/src/shared/paste-share/share.ts) và [`firestore.rules`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/firestore.rules) sẵn có trong dự án.

---

## 2. Tóm Tắt Điều Hành: 4 Câu Trả Lời Cốt Lõi

### 2.1. Đánh giá Tính Khả Thi (Feasibility): **KHẢ THI CAO (85/100) — Nhưng cần hiệu chỉnh 4 điểm nghẽn kỹ thuật**

Kiến trúc toán học và đồ họa trong [SRS v2.0.0](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/docs/math-project-resaerch/t_i_li_u_c_t_y_u_c_u_ph_n_m_m_openmlgraph_srs_v2_0_0.md) có nền tảng lý thuyết rất vững chắc (Symbolic Kernel Lifting $\mathcal{O}(1)$ kết hợp Số Kép Phẳng `Float64Array`, lấy mẫu thích ứng không gian màn hình, vẽ đường đồng mức bằng đạo hàm phần cứng `fwidth()`). Tuy nhiên, khi đưa vào thực tế triển khai trên trình duyệt và kết hợp với Firebase, có **4 rủi ro kỹ thuật bắt buộc phải điều chỉnh**:

| #     | Điểm nghẽn trong SRS v2.0.0                                                                       |      Mức độ rủi ro       | Giải pháp hiệu chỉnh thực tế                                                                                                                                                                                                                                                                                                                   |
| :---- | :------------------------------------------------------------------------------------------------ | :----------------------: | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **`coi-serviceworker` (`COEP: require-corp`) xung đột với Firebase & CDN** (`[NFR-1]`, `[NFR-3]`) |      🔴 **Rất cao**      | Không bật `COEP: require-corp` toàn cục vì sẽ chặn kết nối tới Firebase Firestore, Google Fonts và jsDelivr CDN. Sử dụng **Transferable `ArrayBuffer` (Ping-Pong Double Buffering)** qua `postMessage` (tốn $< 0.02\text{ ms}$) làm cơ chế mặc định giữa Main Thread và Web Worker thay vì bắt buộc `SharedArrayBuffer`.                       |
| **2** | **Thư viện `regl` (`^2.1.0`) chỉ hỗ trợ WebGL 1.0 mặc định và cũ** (Mục 2 & `[FR-3.4]`)           |    🟠 **Trung bình**     | `regl` viết cho WebGL 1.0 (cần bật extension `OES_standard_derivatives` và `ANGLE_instanced_arrays`). Khuyến nghị dùng **WebGL2 thuần (Native WebGL2 API / wrapper mỏng ~200 dòng TS)** để hỗ trợ sẵn GLSL ES 3.00 (`fwidth()`, `gl.drawArraysInstanced()`) với 0 dependency.                                                                  |
| **3** | **Độ phức tạp của Số học Khoảng Tupper đầy đủ (`[FR-3.2]`)**                                      |    🟠 **Trung bình**     | Cài đặt Tupper Interval Arithmetic đầy đủ cho mọi hàm ML mất nhiều tuần nhưng chỉ giải quyết bài toán ngắt nét tại tiệm cận ($1/x, \tan x, H(x)$). Nên triển khai **Interval Arithmetic rút gọn kết hợp Branch Bitmask** của `Jet2` (vốn đã có trong `[FR-3.3]`) để vừa bắt điểm gãy (`ReLU`, `abs`) vừa ngắt bước nhảy (`sign`, `heaviside`). |
| **4** | **Hộp cát `quickjs-emscripten` WASM (`[FR-5.3]`) nặng (~400KB+)**                                 | 🟡 **Thấp - Trung bình** | Đưa `quickjs-emscripten` sang chế độ **Lazy-Load (Dynamic Import)** chỉ tải khi người dùng mở tính năng viết Custom JS Optimizer, tuyệt đối không nạp vào bundle khởi động ban đầu.                                                                                                                                                            |

---

### 2.2. Đánh giá Đủ / Thiếu Tính Năng (Feature Completeness & Gap Analysis)

- **Những phần ĐÃ ĐẦY ĐỦ và xuất sắc trong SRS:**
  - Đường ống nhập liệu LaTeX hai chiều (`MathLive` + `@cortex-js/compute-engine` + `KaTeX`).
  - Phân loại AST 5 nhóm ký hiệu & Huy hiệu hoán đổi vai trò (`Role-Swapping Badges`).
  - Giải tích lai Symbolic + AutoDiff (`Jet2`), quy tắc dưới-gradient (Clarke Subdifferential) và viết lại AST chống tràn số IEEE 754 (`SafeSigmoid`, `SafeSoftplus`, `BCEWithLogits`).
  - Khung nhìn Không gian Kép (Data Space $\leftrightarrow$ Parameter/Loss Space) và "Cuộc đua 4 Bộ tối ưu hóa" (`SGD`, `Momentum/NAG`, `RMSProp`, `Adam`).
- **Mâu thuẫn nội tại lớn nhất (THIẾU trong Engine nhưng lại YÊU CẦU ở Danh mục Mẫu `T-12` $\rightarrow$ `T-15`):**
  - Các Module 1, 2, 3 thiết kế bộ giải tích cho **hàm vô hướng 1 biến đầu vào** $\hat{y} = f(x; w, b)$ và mặt phẳng Loss **2 tham số** $\mathcal{L}(w_1, w_2)$.
  - Nhưng các mẫu **`T-12` (Batch Norm)**, **`T-13` (Phân lớp 2D $x_1, x_2$ + Đường cong ROC-AUC)**, **`T-14` (SVM Kernel 2D Rings $\to$ 3D RBF)** và **`T-15` (Mạng Nơ-ron 2 tầng MLP $\mathbf{W}_1 \in \mathbb{R}^{2\times 2}$ gấp không gian cho bài toán XOR)** đòi hỏi **biến đầu vào đa chiều $(x_1, x_2)$**, **đại số ma trận nhỏ**, và **chế độ vẽ biến dạng lưới (Topological Grid Warping) / đường cong ROC** chưa hề được đặc tả trong `[FR-1]` $\rightarrow$ `[FR-4]`.
- **Những tính năng thực tế CÒN THIẾU trong SRS v2.0.0:**
  1. **Lưu trữ đám mây & Chia sẻ qua Firebase Firestore:** SRS v2.0.0 chỉ có `localStorage` và URL Hash $\le 2.000$ ký tự. Thiếu hoàn toàn cơ chế lưu đồ thị lớn ($> 200$ điểm dữ liệu, nhiều biểu thức, bài giảng nhiều bước) lên Firebase, cập nhật tại chỗ (`editable` share link) và thư viện cộng đồng (Public Gallery).
  2. **Nhập/Xuất tập dữ liệu thực tế (CSV / JSON Dataset Import):** Người dùng ML cần dán hoặc tải file `.csv` nhỏ ($N \le 1.000$ dòng) ngoài việc chấm điểm bằng tay.
  3. **Xuất đồ thị chất lượng cao (Export PNG / SVG / GIF-WebM):** Thiết yếu cho giảng viên và sinh viên khi đưa đồ thị vào slide bài giảng hoặc báo cáo.
  4. **Trải nghiệm Cảm ứng / Màn hình nhỏ (Mobile & Tablet Responsive UX):** Khung nhìn chia đôi (Split-Screen) trên màn hình dọc cần chế độ xếp chồng (Vertical Stack / Tabbed Switch) và cử chỉ chạm 2 ngón (Pinch-to-zoom).

---

### 2.3. Đánh giá Code Tiếp Hay Đổi Framework: **CODE TIẾP TRÊN REPO ASTRO 6 HIỆN TẠI (Kết hợp Preact Island + Zustand)**

Qua khảo sát trực tiếp [`package.json`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/package.json) và [`astro.config.mjs`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/astro.config.mjs), kho mã nguồn hiện tại đang sử dụng **Astro `^6.0.2`**, **Vite**, **Tailwind CSS `^4.2.1`**, **TypeScript `^5.7.3`**, **Firebase `^12.10.0`** và **KaTeX `^0.16.45`** theo kiến trúc **Vertical Slice Architecture (VSA)** rất sạch sẽ (`src/features/<tool>/` + `src/pages/<tool>/index.astro`).

- **Kết luận:** **KHÔNG CẦN và KHÔNG NÊN tách sang framework khác** (như Next.js hay tạo repo React SPA rời). Chúng ta hoàn toàn **code tiếp trực tiếp trên repo `vinhmdev.github.io` hiện tại**.
- **Cách thức tích hợp tối ưu nhất:**
  - Giữ nguyên cấu trúc trang Astro tại `src/pages/openmlgraph/index.astro` và `src/features/openmlgraph/`.
  - Cài thêm **`preact` (`~3KB`) + `@astrojs/preact` + `zustand`** (đúng chuẩn MIT trong SRS Mục 2) để quản lý UI phức tạp (danh sách công thức động, thanh trượt tham số, huy hiệu hoán đổi vai trò, thanh tua thời gian Optimizer Race) thay vì viết DOM thủ công bằng `document.getElementById` (vốn sẽ quá tải khi vượt quá 2.000 dòng code như ở `llm-hardware-profiler`).
  - Toàn bộ tầng **Core Math Engine, Symbolic/AutoDiff, Web Worker, Canvas 2D, WebGL2 và Firebase Share** viết bằng **Pure TypeScript** độc lập với UI framework.

---

### 2.4. Kiến Trúc Lưu Trữ Firebase & Chia Sẻ Với Mọi Người

Dự án `vinhmdev.github.io` **đã có sẵn hạ tầng Firebase Firestore rất tốt** tại [`src/shared/firebase/`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/src/shared/firebase/app.ts), [`src/shared/paste/`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/src/shared/paste/store.ts) và [`src/shared/paste-share/`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/src/shared/paste-share/share.ts). Chúng ta sẽ thiết kế kiến trúc **Lưu trữ & Chia sẻ Lai 3 Tầng (3-Tier Hybrid Persistence & Sharing)** cho OpenMLGraph:

1. **Tầng 1 — Lưu Cục bộ Tức thì (`localStorage` + Auto-save 500ms):** Phục vụ thao tác nháp hàng ngày, hoàn toàn ngoại tuyến (`openmlgraph_state_v2` + lịch sử phiên bản cục bộ qua `createDocStore('openmlgraph_docs')`).
2. **Tầng 2 — Chia sẻ Nhanh Không Máy chủ qua URL Hash (`#v2.dr.<payload>`):** Khi đồ thị nhẹ ($\le 200$ điểm dữ liệu, chuỗi nén $< 1.800$ ký tự), cho phép copy URL tức thì khi đang offline.
3. **Tầng 3 — Lưu trữ Đám mây Firebase Firestore & Chia sẻ Cộng đồng:**
   - **Chế độ 3A — Chia sẻ Link Bảo mật E2EE (`Readonly` hoặc `Editable`):** Tái sử dụng trực tiếp mô hình mã hóa AES-256-GCM của `@shared/paste/store.ts` (hoặc collection `graphs`), cho phép lưu trạng thái đồ thị lên tới **900 KB** (hàng nghìn điểm dữ liệu, kịch bản bài giảng, lịch sử hạt tối ưu), hỗ trợ **cập nhật trực tiếp trên cùng 1 link (`editable`)** hoặc **đóng băng (`readonly` / fork)**.
   - **Chế độ 3B — Chia sẻ Công khai (Public Community Gallery — Collection `public_graphs`):** Cho phép người dùng xuất bản (Publish) đồ thị/bài giảng toán ML của họ lên thư viện chung kèm Tiêu đề, Tác giả, Mô tả, Tags (`Activation`, `Loss`, `Optimization`, `SVM`...) để mọi người cùng khám phá, tìm kiếm và Fork về học tập.

---

## 3. Lộ Trình Triển Khai Khuyến Nghị (4 Phases)

| Giai đoạn                                                 | Mục tiêu Cốt lõi                                                     | Hạng mục Triển khai Chính                                                                                                                                                                                                                  | Thời gian Ước tính |
| :-------------------------------------------------------- | :------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------: |
| **Phase 1: Core MVP (2D & Symbolic/AutoDiff)**            | Vẽ hàm ML 2D + Đạo hàm bậc 1/2 + Thanh trượt + Lưu Local/URL         | Khởi tạo slice `src/features/openmlgraph/`, tích hợp `mathlive` + `@cortex-js/compute-engine`, AST Classifier 5 nhóm, `Jet2` Dual Numbers, Adaptive 2D Sampler + POIs trên Canvas 2D, các mẫu `T-01` $\to$ `T-06`.                         |   **2 – 3 tuần**   |
| **Phase 2: Dual-Space & Optimizer Race (3D WebGL)**       | Khung nhìn Kép + Mặt Loss 3D + Cuộc đua 4 Bộ tối ưu + Firebase Share | Tích hợp WebGL2 Loss Surface + `fwidth()` Contours + Vector Field, gắn kết 2 chiều (Bi-directional binding), Optimizer Race (`SGD`, `Momentum`, `RMSProp`, `Adam`), tích hợp **Firebase Share & Public Gallery**, mẫu `T-07` $\to$ `T-11`. |   **2 – 3 tuần**   |
| **Phase 3: Specialized ML Modules (`T-12` $\to$ `T-15`)** | Giải quyết khoảng trống đa biến & mạng nơ-ron nhỏ                    | Bổ sung chế độ vẽ biến dạng lưới 2D (Grid Warping cho `T-15`), đường cong ROC-AUC (`T-13`), 3D Feature Mapping (`T-14`), và chuẩn hóa theo lô (`T-12`).                                                                                    |     **2 tuần**     |
| **Phase 4: Extensibility, Sandbox & PWA Polish**          | Hệ thống Plugin cộng đồng + Hộp cát WASM + Kiểm thử `AC-01..06`      | Lazy-load `quickjs-emscripten` cho Custom Optimizer, hoàn thiện Offline Service Worker caching cho font KaTeX/MathLive, bộ test `vitest` + `playwright`.                                                                                   |   **1 – 2 tuần**   |
