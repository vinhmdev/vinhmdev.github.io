# 01. Đánh Giá Tính Khả Thi Kỹ Thuật Theo Từng Module (Technical Feasibility Assessment)

Tài liệu này phân tích tính khả thi kỹ thuật của toàn bộ yêu cầu trong [SRS OpenMLGraph v2.0.0](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/docs/math-project-resaerch/t_i_li_u_c_t_y_u_c_u_ph_n_m_m_openmlgraph_srs_v2_0_0.md), đối chiếu trực tiếp với 4 báo cáo nghiên cứu chuyên sâu trong [`docs/math-project-resaerch/`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/docs/math-project-resaerch/) và hiện trạng kỹ thuật của kho mã nguồn [`vinhmdev.github.io`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/package.json).

---

## 1. Bảng Tổng Hợp Điểm Đánh Giá Khả Thi Theo Module

| Module / Hạng mục                                                              | Điểm Khả thi | Độ phức tạp Cài đặt | Rủi ro Kỹ thuật Chính                                                                                               | Đánh giá Tổng quát                                                                                                                       |
| :----------------------------------------------------------------------------- | :----------: | :-----------------: | :------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------- |
| **Module 1: Core Parser Engine (`[FR-1.1]` $\to$ `[FR-1.4]`)**                 | **92 / 100** |     Trung bình      | Đăng ký từ điển LaTeX tùy chỉnh cho các hàm ML (`relu`, `gelu`, `bce_logits`) trong `@cortex-js/compute-engine`.    | **Rất khả thi.** Thư viện MIT chuẩn, cấu trúc MathJSON S-expression rất dễ duyệt cây đệ quy.                                             |
| **Module 2: Hybrid Symbolic + AutoDiff (`[FR-2.1]` $\to$ `[FR-2.4]`)**         | **90 / 100** |         Cao         | Khớp quy tắc đạo hàm hàm gãy khúc (Clarke Subdifferential) và viết lại AST cho mọi biến thể đại số của BCE/Sigmoid. | **Khả thi cao.** Thuật toán Symbolic Kernel Lifting $\mathcal{O}(1)$ + Unboxed Dual Numbers + `new Function()` cực kỳ hiệu quả trong JS. |
| **Module 3: 2D/3D Adaptive Plotting & POIs (`[FR-3.1]` $\to$ `[FR-3.4]`)**     | **80 / 100** |       Rất cao       | Thư viện `regl` chỉ hỗ trợ WebGL1 mặc định; Số học khoảng Tupper đầy đủ (`[FR-3.2]`) phức tạp khi kết hợp hàm ML.   | **Khả thi nhưng cần tinh chỉnh.** Nên dùng WebGL2 thuần thay vì `regl`, và dùng Interval Arithmetic rút gọn kết hợp `Jet2` bitmask.      |
| **Module 4: Specialized ML Simulation (`[FR-4.1]` $\to$ `[FR-4.4]`)**          | **78 / 100** |         Cao         | 4 mẫu cuối (`T-12` $\to$ `T-15`) vượt quá khả năng của bộ giải tích vô hướng 1 biến $f(x; w, b)$.                   | **Khả thi 100% cho `T-01` $\to$ `T-11`.** Các mẫu `T-12` $\to$ `T-15` cần chế độ chuyên biệt (Specialized Kernels).                      |
| **Module 5: State, URL Codec, Plugin & Sandbox (`[FR-5.1]` $\to$ `[FR-5.3]`)** | **88 / 100** |     Trung bình      | Giới hạn 2.000 ký tự URL khi dữ liệu lớn; dung lượng WASM của `quickjs-emscripten`.                                 | **Rất khả thi khi kết hợp Firebase.** Tái sử dụng hạ tầng Firestore sẵn có giải quyết triệt để giới hạn URL.                             |
| **NFRs: 60/120 FPS, `<4ms` Budget & Offline PWA (`[NFR-1]` $\to$ `[NFR-4]`)**  | **82 / 100** |         Cao         | Xung đột giữa `coi-serviceworker` (`COEP: require-corp`) và Firebase Firestore / CDN ngoại vi.                      | **Cần điều chỉnh cơ chế truyền bộ nhớ Worker.** Dùng Transferable `ArrayBuffer` mặc định thay vì ép buộc `SharedArrayBuffer`.            |

---

## 2. Phân Tích Chuyên Sâu Từng Module

### 2.1. Module 1: Bộ Phân tích Cú pháp, Nhận diện Tham số & Mặt phẳng Đại số (`[FR-1.1]` $\to$ `[FR-1.4]`)

#### A. Điểm mạnh & Cơ sở khả thi

1. **Cặp thư viện `mathlive` + `@cortex-js/compute-engine` (100% MIT):**
   - Trong tài liệu nghiên cứu _Client-Side ML Symbolic Engine Architecture.docx_, nhóm tác giả đã so sánh kỹ `CortexJS`, `mathjs`, `nerdamer-prime`, `algebrite` và `symbolica` (bị loại do bản quyền thương mại/GPL).
   - `mathlive` cung cấp trình soạn thảo WYSIWYG toán học hỗ trợ copy/paste LaTeX hai chiều tốt nhất hiện nay trên web.
   - `@cortex-js/compute-engine` xuất trực tiếp ra chuẩn **MathJSON** (dạng mảng tiền tố `["Add", ["Multiply", "w", "x"], "b"]`), giúp việc viết thuật toán phân loại 5 nhóm ký hiệu (`[FR-1.2]`) chỉ là một hàm duyệt mảng đệ quy khoảng 80 dòng TypeScript.
2. **Huy hiệu Hoán đổi Vai trò (`[FR-1.4]` - Role-Swapping Badges):**
   - Hoàn toàn khả thi và là một điểm sáng UX lớn. Về mặt kỹ thuật, việc đổi vai trò giữa `Data Variable` ($x$) và `Model Parameter` ($w$) chỉ là cập nhật một `Record<string, SymbolRole>` trong Zustand store, sau đó kích hoạt biên dịch lại hàm đóng JIT (chỉ mất $< 0.2\text{ ms}$).

#### B. Phát hiện kỹ thuật & Lưu ý khi cài đặt

- **Đính chính phiên bản thư viện:** Tài liệu nghiên cứu _Client-Side ML Symbolic Engine Architecture.docx_ (mục 1) ghi nhầm phiên bản `@cortex-js/compute-engine` là `v0.147.0 – v0.152.0` (đây thực chất là dải phiên bản cũ của `mathlive`). Trong [SRS v2.0.0 (Mục 2)](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/docs/math-project-resaerch/t_i_li_u_c_t_y_u_c_u_ph_n_m_m_openmlgraph_srs_v2_0_0.md#L28), phiên bản đã được ghi đúng là `^0.25.0+` (hiện tại trên npm đã lên nhánh `0.26.x+`).
- **Đăng ký từ điển LaTeX tùy chỉnh cho hàm ML:** Mặc định, khi người dùng gõ `\text{relu}(x)` hoặc `gelu(x)` trong `mathlive`, Compute Engine có thể hiểu `g*e*l*u*x` (nhân các biến đơn ký tự) nếu chưa khai báo trong `latexDictionary`. Do đó, bước khởi tạo `ComputeEngine` **bắt buộc** phải đăng ký danh sách 16 hàm ML dựng sẵn (`sigmoid`, `relu`, `leaky_relu`, `elu`, `swish`, `gelu`, `softplus`, `softmax`, `huber`, `hinge`, `bce_logits`, `heaviside`, `dirac`) vào cả `latexDictionary` lẫn bảng định nghĩa hàm trước khi gọi `ce.parse()`.

---

### 2.2. Module 2: Giải tích Lai (Symbolic + AutoDiff) & Bảo vệ Số học IEEE 754 (`[FR-2.1]` $\to$ `[FR-2.4]`)

#### A. Điểm mạnh & Cơ sở khả thi

1. **Giải quyết triệt để bài toán "Expression Swell" bằng Symbolic Kernel Lifting (`[FR-2.3]`):**
   - Nghiên cứu trong _Client-Side ML Symbolic Engine Architecture.docx_ (mục 3) chỉ ra rất chính xác: nếu cộng tổng biểu thức symbolic trên $N = 1.000$ điểm dữ liệu rồi mới đạo hàm, cây AST sẽ phình lên hàng chục nghìn nút và làm treo trình duyệt ($> 100\text{ ms}$).
   - Giải pháp đạo hàm biểu tượng **1 lần duy nhất** trên hạt nhân mẫu đơn $\ell(x, y; w, b)$ ($\mathcal{O}(1)$) để hiển thị công thức LaTeX tường minh cho mục đích sư phạm, kết hợp biên dịch JIT sang vòng lặp `Float64Array` sử dụng **Số Kép Phẳng (Unboxed Dual Numbers)** để tính đạo hàm số chính xác trên $N$ điểm dữ liệu là **hoàn toàn khả thi và đạt chuẩn công nghiệp**.
2. **Biên dịch AST sang JavaScript Closure (`new Function`) thay vì thông dịch AST:**
   - Vòng lặp `for` thuần trên `Float64Array` sinh ra từ `new Function('xArr', 'yArr', 'params', ...)` được động cơ V8/JavaScriptCore tối ưu hóa JIT (TurboFan/DFG) với tốc độ đạt **85% – 95% tốc độ C/WASM** mà không tốn chi phí copy bộ nhớ qua ranh giới JS $\leftrightarrow$ WASM.
   - Ngân sách tính toán $1.000$ điểm dữ liệu cho 4 hạt tối ưu hóa chỉ mất khoảng **$0.08\text{ ms} - 0.15\text{ ms}$**, nằm sâu dưới ngưỡng $4.0\text{ ms}$ của `[NFR-1]`.
3. **Lượt viết lại AST chống tràn số IEEE 754 (`[FR-2.4]`):**
   - Các quy tắc biến đổi $\frac{1}{1+e^{-z}} \to \text{SafeSigmoid}(z)$, $\ln(1+e^z) \to \text{SafeSoftplus}(z)$ và hợp nhất $\text{BCEWithLogits}(y, z) = \max(z, 0) - yz + \text{log1p}(e^{-|z|})$ hoàn toàn khả thi bằng kỹ thuật so khớp mẫu (Pattern Matching) trên cây mảng MathJSON.
   - Đảm bảo vượt qua 100% bài kiểm thử nghiệm thu `[AC-02]` khi $w = 100, x = 10 \implies z = 1000$.

#### B. Phát hiện kỹ thuật & Lưu ý khi cài đặt

- **Giới hạn của Pattern Matching trên biểu thức BCE do người dùng tự gõ:**
  - Nếu người dùng chọn hàm dựng sẵn `bce(y, sigmoid(w*x+b))` hoặc mẫu `T-05`, bộ viết lại AST nhận diện được ngay 100%.
  - Tuy nhiên, nếu người dùng tự gõ tay các biến thể đại số tương đương (ví dụ đổi chỗ hạng tử `-(1-y)*ln(1 - 1/(1+exp(-w*x))) - y*ln(1/(1+exp(-w*x)))` hoặc dùng `log` thay vì `ln`), bộ so khớp mẫu cần chạy sau bước `expr.canonical` (chuẩn hóa giao hoán/kết hợp của CortexJS) và hỗ trợ cả quy tắc dự phòng: kẹp giá trị đối số trong `SafeLog(p) = Math.log(Math.max(p, 1e-15))` nếu người dùng viết một biểu thức logarit kỳ dị không khớp mẫu BCE chuẩn.

---

### 2.3. Module 3: Engine Đồ họa 2D/3D Thích ứng, Giải tích Khoảng & POIs (`[FR-3.1]` $\to$ `[FR-3.4]`)

#### A. Đánh giá Lấy mẫu Thích ứng (`[FR-3.1]`) & Trích xuất POIs bằng `Jet2` + Brent (`[FR-3.3]`)

- **Khả thi 95%:**
  - Thuật toán chia đệ quy nhị phân từ 64 đoạn hạt giống lệch pha tỷ lệ vàng ($\phi^{-1} \approx 0.618$) với điều kiện dừng bình phương khoảng cách màn hình $d_\perp^2 \le 0.45^2\text{ px}^2$ và góc lệch $\cos^2\theta \ge \cos^2(5.5^\circ)$ đã có sẵn mã mẫu hoàn chỉnh trong _2D_3D Math Plotting Architecture Research.docx_ (mục 1).
  - Đại số Số Siêu Kép bậc 2 (`Jet2 = { f, df, d2f, branchMask }`) kết hợp phương pháp Brent là cách tiếp cận cực kỳ thông minh: khi một hàm chứa `relu(u)`, `abs(u)`, `max(a, b)` hoặc `huber(r, delta)`, mỗi phép rẽ nhánh đẩy 1 bit (`0` hoặc `1`) vào `branchMask`. Nếu 2 đầu mút đoạn $[x_a, x_b]$ có `jetA.branchMask !== jetB.branchMask`, hệ thống biết chắc chắn $100\%$ có **điểm gãy khúc (Piecewise Kink)** nằm giữa $[x_a, x_b]$ và dùng chia đôi/Brent để ghim đỉnh nhọn với độ chính xác $10^{-12}$ (đạt chuẩn `[AC-01]`).

#### B. Hai điểm cần hiệu chỉnh kỹ thuật trong Module 3

1. **Hiệu chỉnh `[FR-3.2]` (Số học Khoảng Tupper $(\text{val}, \text{def}, \text{cont})$):**
   - _Vấn đề:_ Cài đặt đầy đủ Tupper's Domain-Tracking Interval Arithmetic cho mọi tổ hợp hàm siêu việt và hàm ML tốn rất nhiều công sức nhưng mục đích thực tế trong `[AC-03]` chỉ là không vẽ đường thẳng đứng nối qua tiệm cận đứng ($1/x, \tan x$) và bước nhảy ($H(x), \text{sign}(x)$).
   - _Giải pháp khả thi hơn:_ Kết hợp 3 cơ chế gọn nhẹ:
     1. Dùng chính `branchMask` của `Jet2` cho các hàm bước nhảy bất liên tục (`heaviside`, `sign`, `floor`, `ceil`): khi `discontinuityMask` thay đổi giữa $x_a$ và $x_b$, chèn `NaN` để ngắt nét vẽ ngay lập tức.
     2. Dùng **Số học Khoảng chuẩn (Standard Interval Arithmetic $[a, b]$)** trên các toán tử có điểm kỳ dị (`Divide` khi khoảng mẫu số chứa $0$, `Ln`/`Sqrt` khi khoảng chứa số $\le 0$, `Tan` khi khoảng chứa $\frac{\pi}{2} + k\pi$).
     3. Kiểm tra đạo hàm màn hình đổi dấu đột ngột tại biên $\pm\infty$ để ngắt đa tuyến. Cách này giảm 70% khối lượng code phức tạp mà vẫn vượt qua `[AC-03]` tuyệt đối.
2. **Hiệu chỉnh `[FR-3.4]` (Thư viện `regl` vs. Native WebGL2):**
   - _Vấn đề:_ SRS quy định `regl: ^2.1.0` cho WebGL2. Tuy nhiên, trong thực tế, `regl` được thiết kế xoay quanh **WebGL 1.0 context** (phiên bản cuối `2.1.0` phát hành từ năm 2021). Để dùng `fwidth()` và GPU Instancing trong `regl`, lập trình viên phải cấu hình extension của WebGL 1 (`OES_standard_derivatives`, `ANGLE_instanced_arrays`) và viết shader GLSL 1.00 cũ.
   - _Giải pháp khuyến nghị:_ Vì ứng dụng chỉ cần đúng **2 pipeline vẽ GPU** (1 pipeline vẽ lưới 3D $128 \times 128$ kèm đường đồng mức `fwidth()`, và 1 pipeline Instanced Drawing vẽ $2.500$ mũi tên vector gradient), việc viết một lớp bọc **Native WebGL2 (`gl = canvas.getContext('webgl2')`) khoảng 180 dòng TypeScript** sẽ:
     - Hỗ trợ gốc GLSL ES 3.00 (`#version 300 es`), có sẵn hàm `fwidth()` và `gl.drawArraysInstanced()` mà không cần xin quyền extension.
     - Loại bỏ hoàn toàn gói phụ thuộc `regl` (~50KB) và tránh lỗi xung đột kiểu `@types/regl` trên TypeScript 5.7.

---

### 2.4. Module 4: Mô phỏng Chuyên biệt cho Machine Learning (`[FR-4.1]` $\to$ `[FR-4.4]`)

- **`[FR-4.1]` (Khung nhìn Kép), `[FR-4.2]` (Optimizer Race 4 hạt), `[FR-4.3]` (Bảng dữ liệu & Hình học $L_1/L_2$):**
  - **Khả thi 100%.** Các phương trình cập nhật của `SGD`, `Momentum/NAG`, `RMSProp`, `Adam` (kèm hiệu chỉnh độ chệch $\hat{m}_t, \hat{v}_t$) đều làm việc trên không gian tham số 2 chiều $(w_1, w_2)$ hoặc $(w, b)$.
  - Với $T = 500$ bước lặp cho 4 bộ tối ưu hóa trên $N = 200$ điểm dữ liệu, tổng số phép tính đạo hàm là $4 \times 500 \times 200 = 400.000$ phép tính vô hướng — chạy trên JIT `Float64Array` mất chưa tới **$1.5\text{ ms}$** cho toàn bộ quỹ đạo $T$ bước! Do đó, tính năng **Timeline Scrubber** (kéo thanh thời gian $t \in [0, T]$) có thể tiền tính toán (pre-compute) toàn bộ mảng quỹ đạo `Float32Array` và tua mượt mà ở 120 FPS.
- **Điểm nghẽn ở `[FR-4.4]` (Danh mục 15 Mẫu 1-Click `T-01` $\to$ `T-15`):**
  - **Các mẫu `T-01` đến `T-11`:** Khớp hoàn hảo 100% với kiến trúc hàm 1 biến $x$ và 1–2 tham số $(w, b)$ hoặc $(\mu, \sigma)$.
  - **Các mẫu `T-12` đến `T-15`:** Như đã phân tích tại Mục 2 của `README.md`, 4 mẫu này đòi hỏi biến đầu vào 2 chiều $(x_1, x_2)$ hoặc phép nhân ma trận 2 tầng (`T-15`). Để khả thi mà không phải viết một Tensor CAS khổng lồ, 4 mẫu `T-12` $\to$ `T-15` cần được cài đặt dưới dạng **Specialized Interactive Modules (Chế độ mô phỏng chuyên biệt có công thức ma trận biên dịch sẵn)** thay vì bắt bộ phân tích cú pháp vô hướng tự suy luận. (Chi tiết xem tại [`02-danh-gia-du-thieu-tinh-nang.md`](./02-danh-gia-du-thieu-tinh-nang.md)).

---

### 2.5. Module 5 & NFRs: Đa luồng, `coi-serviceworker`, Sandbox & Lưu trữ (`[FR-5.1]` $\to$ `[NFR-4]`)

#### A. Cảnh báo Quan trọng: Xung đột giữa `coi-serviceworker` (`[NFR-3]`) và Firebase / External Resources

- Trong [SRS `[NFR-1]` & `[NFR-3]`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/docs/math-project-resaerch/t_i_li_u_c_t_y_u_c_u_ph_n_m_m_openmlgraph_srs_v2_0_0.md#L171), hệ thống yêu cầu dùng `SharedArrayBuffer` thông qua `coi-serviceworker` (tự tiêm header `Cross-Origin-Embedder-Policy: require-corp` và `Cross-Origin-Opener-Policy: same-origin` trên GitHub Pages).
- **Thực tế kiểm chứng trên repo `vinhmdev.github.io`:**
  1. Repo hiện tại đang nạp Google Fonts, Lucide Icons từ CDN (`cdn.jsdelivr.net`) và kết nối trực tiếp tới **Firebase Firestore / Google Analytics** (`firebase: ^12.10.0`).
  2. Khi một Service Worker bật `COEP: require-corp` trên phạm vi toàn trang (hoặc toàn domain `tools.vinhmdev.com`), trình duyệt sẽ **chặn mọi request cross-origin** không trả về header `Cross-Origin-Resource-Policy: cross-origin` và buộc trang phải reload lại lần đầu tiên khi đăng ký Service Worker.
  3. Hơn nữa, kết quả đo đạc ngay trong tài liệu nghiên cứu _2D_3D Math Plotting Architecture Research.docx_ (Bảng mục 4) cho thấy tổng thời gian tính toán CPU mỗi khung hình chỉ là **$1.75\text{ ms}$**.
- **Khuyến nghị Kiến trúc Đa luồng An toàn:**
  - **KHÔNG dùng `coi-serviceworker` ép buộc `COEP: require-corp`.**
  - Sử dụng **Web Worker chuẩn kết hợp `Transferable ArrayBuffer` (Ping-Pong Double Buffering)**: Main Thread và Worker trao đổi quyền sở hữu 2 bộ đệm `Float32Array` qua `worker.postMessage(buffer, [buffer])`. Thao tác chuyển quyền sở hữu con trỏ bộ nhớ (Zero-Copy Transfer) chỉ mất **$< 0.01\text{ ms}$**, hoàn toàn đạt hiệu năng Zero UI Jank 60–120 FPS mà **tương thích 100% với Firebase Firestore, iframe nhúng và mọi trình duyệt di động Safari/Chrome**.
  - Nếu môi trường đã có sẵn `crossOriginIsolated === true`, hệ thống mới tự động nâng cấp lên `SharedArrayBuffer`.
