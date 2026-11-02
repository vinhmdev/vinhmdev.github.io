# TÀI LIỆU ĐẶC TẢ YÊU CẦU PHẦN MỀM & KỸ THUẬT (SRS)
**Dự án:** OpenMLGraph (*ML Math Sandbox — Desmos + GeoGebra + Distill.pub for Machine Learning*)
* **Phiên bản:** v2.0.0 (Production-Ready Specification)
* **Hình thức vận hành:** 100% Client-Side SPA, Offline-First PWA, Zero Server Cost
* **Giấy phép (License):** 100% MIT License

---

## 1. TỔNG QUAN HỆ THỐNG & PHẠM VI SẢN PHẨM

**OpenMLGraph** là công cụ vẽ đồ thị, giải tích toán học và mô phỏng tối ưu hóa chuyên biệt cho Machine Learning (ML) hoạt động hoàn toàn trên trình duyệt. Hệ thống kết hợp khả năng trực quan hóa tham số phản ứng tức thì của **Desmos**, sức mạnh giải tích hình học và đạo hàm biểu tượng của **GeoGebra**, cùng chiều sâu sư phạm trực quan của **Distill.pub** và **3Blue1Brown**.

### Mục tiêu Cốt lõi:
1. **Hỗ trợ toàn diện toán học ML:** Xử lý mượt mà từ các hàm sơ cấp đến các hàm kích hoạt phi trơn ($\text{ReLU}, \text{GELU}, \text{Swish}$), hàm mất mát ($\text{BCE}, \text{Huber}, \text{Hinge}$), đạo hàm riêng và mặt phẳng tối ưu hóa 2D/3D.
2. **Trực quan & Dễ sử dụng tối đa:** Mọi thao tác đều có thể thực hiện qua kéo thả trực tiếp trên mặt phẳng đồ thị (Direct Manipulation), tự động sinh thanh trượt và chọn nhanh qua thư viện mẫu 1-Click.
3. **Miễn phí 100% & Mã nguồn mở hoàn toàn (MIT):** Không phụ thuộc máy chủ tính toán (Zero-Backend), chia sẻ trạng thái trực tiếp qua URL nén và hoạt động ngoại tuyến 100% sau lần tải đầu tiên.

---

## 2. YÊU CẦU PHỤ THUỘC KỸ THUẬT & THƯ VIỆN (`package.json` Requirements)

Để đảm bảo ràng buộc pháp lý **100% MIT License** (loại bỏ hoàn toàn các thư viện dính giấy phép GPL hoặc Source-Available thương mại) và giữ dung lượng tải trang tối thiểu, hệ thống quy định danh mục phụ thuộc chuẩn như sau:

| Nhóm Phụ thuộc | Tên Gói (NPM Package) | Phiên bản Yêu cầu | Giấy phép | Vai trò trong Hệ thống |
| :--- | :--- | :--- | :--- | :--- |
| **UI & State** | `preact` (hoặc `react`) + `zustand` | `^10.19.0` / `^4.5.0` | MIT | Quản lý giao diện phản ứng nhẹ và kho trạng thái đồng bộ. |
| **Math Input** | `mathlive` | `^0.101.0` | MIT | Trình soạn thảo công thức toán học trực quan & copy-paste LaTeX hai chiều. |
| **Symbolic CAS** | `@cortex-js/compute-engine` | `^0.25.0+` | MIT | Phân tích cú pháp sang chuẩn AST **MathJSON**, chuẩn hóa đại số và tính đạo hàm biểu tượng. |
| **3D / WebGL** | `regl` | `^2.1.0` | MIT | Kết xuất WebGL phi trạng thái (stateless) cho bề mặt Loss 3D, đường đồng mức `fwidth()` và trường vector. |
| **Compression** | Native `CompressionStream` + `fflate` | `^0.8.2` | MIT | Nén trạng thái URL chuẩn `deflate-raw` (sử dụng API trình duyệt gốc 0KB, dự phòng bằng `fflate` 4.6KB). |
| **Sandbox WASM** | `quickjs-emscripten` (MicroQuickJS) | `^0.29.0` | MIT | Cô lập thực thi an toàn cho các thuật toán tối ưu hóa tùy chỉnh do người dùng viết. |
| **Build & PWA** | `vite` + `vite-plugin-pwa` | `^5.0.0` / `^0.20.0` | MIT | Đóng gói ứng dụng, tạo Service Worker (Workbox) lưu đệm ngoại tuyến cho `.wasm` và font `.woff2`. |
| **Testing** | `vitest` + `playwright` | `^1.6.0` | MIT | Kiểm thử đơn vị giải tích số học IEEE 754 và kiểm thử hiệu năng khung hình E2E. |

---

## 3. PHÂN TÍCH YÊU CẦU CHỨC NĂNG CHI TIẾT (FUNCTIONAL REQUIREMENTS)

### 3.1. Module 1: Bộ Phân tích Cú pháp, Nhận diện Tham số & Mặt phẳng Đại số (Core Parser Engine)

* **[FR-1.1] Nhập liệu Công thức Toán học & LaTeX Hai chiều:**
  * Hỗ trợ nhập liệu dạng văn bản tự do qua ô nhập công thức (ví dụ: `1 / (1 + exp(-w * x - b))`), qua bàn phím ảo ký hiệu toán học trực quan, hoặc **dán (paste) trực tiếp mã LaTeX** (ví dụ: `\frac{1}{1 + e^{-wx - b}}`).
  * Hệ thống kiểm tra lỗi cú pháp (Syntax Check) theo thời gian thực, hiển thị vị trí lỗi ngay lập tức nếu thiếu ngoặc hoặc sai cấu trúc toán học mà không làm gián đoạn khung vẽ hiện tại.
  * Mọi biểu thức hợp lệ được chuyển đổi tức thì sang cấu trúc cây cú pháp trừu tượng chuẩn **MathJSON** (dạng mảng tiền tố S-expression, ví dụ: `["Add", ["Multiply", "w", "x"], "b"]`).

* **[FR-1.2] Thuật toán Phân loại Cây Cú pháp (AST) 5 Nhóm Ký hiệu:**
  * **Nhóm 1 — Hằng số cố định (Locked Constants):** $e, \pi$ (`ExponentialE`, `Pi`) — khóa cứng giá trị toán học chuẩn xác theo IEEE 754, không sinh thanh trượt.
  * **Nhóm 2 — Hàm số & Toán tử ML dựng sẵn (Built-in Primitives):**
    * Toán học cơ bản: $\sin, \cos, \tan, \exp, \ln, \log, \sqrt{\cdot}, |\cdot|, \text{sign}, \max, \min, \text{erf}$.
    * Hàm kích hoạt ML: $\text{sigmoid}, \text{relu}, \text{leaky\_relu}, \text{elu}, \text{tanh}, \text{swish}, \text{gelu}, \text{softplus}, \text{softmax}$.
    * Hàm mất mát & Giải tích suy rộng: $\text{huber}, \text{hinge}, \text{bce\_logits}, \text{heaviside } H(x), \text{dirac } \delta(x)$.
  * **Nhóm 3 — Biến số dữ liệu / Trục tọa độ (Data & Axis Variables):** Mặc định nhận diện $x$ (hoặc $x, y$) làm biến độc lập trên mặt phẳng Không gian Dữ liệu.
  * **Nhóm 4 — Tham số mô hình (Tunable Model Parameters):** Tự động bóc tách các ký hiệu trọng số và độ chệch ($w, w_1, w_2, b, \theta, \mu, \sigma$) để sinh thanh trượt động và làm trục tọa độ cho Không gian Hàm Loss.
  * **Nhóm 5 — Siêu tham số điều khiển (Hyperparameters):** Nhận diện các ký hiệu điều khiển quá trình học và hình thái hàm ($\eta, \alpha, \beta, \lambda, \gamma, \delta, \tau$) để gắn vào bảng điều khiển mô phỏng.

* **[FR-1.3] Hệ thống Quản lý Thanh trượt (Parameter Sliders):**
  * Mỗi tham số thuộc Nhóm 4 và Nhóm 5 khi được phát hiện sẽ tự động được cấp một thanh trượt điều khiển (`input type="range"`) với miền giá trị mặc định $[-5, 5]$, bước nhảy $0.05$ (riêng các siêu tham số dương như $\eta, \lambda, \tau$ có miền mặc định $[0.001, 2.0]$).
  * Cho phép người dùng chỉnh sửa trực tiếp cận `Min`, `Max`, `Step` và bật chế độ **Play/Pause Animation** (với tùy chọn đảo chiều lặp lại hoặc chạy một chiều, tốc độ $0.5\times \rightarrow 4\times$) để quan sát sự biến thiên động của đồ thị.

* **[FR-1.4] Huy hiệu Hoán đổi Vai trò Biến $\leftrightarrow$ Tham số (Role-Swapping Badges):**
  * Cung cấp dải huy hiệu tương tác (Interactive Badges) hiển thị ngay dưới ô nhập công thức với mã màu ngữ nghĩa: `[Data: x, y]` (Xanh lơ), `[Param: w, b]` (Xanh đậm), `[Hyperparam: η, λ]` (Tím).
  * Cho phép người dùng nhấp vào bất kỳ huy hiệu nào để hoán đổi vai trò linh hoạt giữa 3 chế độ khung nhìn:
    1. **Chế độ Suy luận (Inference View):** Đặt $x$ làm trục hoành để khảo sát hình dáng hàm dự đoán $\hat{y} = f(x; w, b)$ khi kéo thanh trượt $w, b$.
    2. **Chế độ Tối ưu hóa (Optimization View):** Đặt trọng số $w$ (hoặc cặp $w_1, w_2$) làm trục tọa độ chính để quan sát trực tiếp đồ thị hàm mất mát $\mathcal{L}(w, b)$.
    3. **Chế độ Không gian Kép (Dual-Space View):** Hiển thị đồng thời cả hai hệ trục trên hai khung nhìn song song có liên kết thời gian thực.

---

### 3.2. Module 2: Giải tích Lai (Symbolic + AutoDiff) & Bảo vệ Số học IEEE 754

* **[FR-2.1] Tự động Giải và Vẽ Đạo hàm Bậc 1 & Bậc 2 ($f'(x), f''(x)$) cho cả Hàm Trơn và Hàm Phi Trơn:**
  * Tích hợp bộ giải tích Symbolic để tự động tính công thức đạo hàm bậc 1 và bậc 2 chính xác từ biểu thức gốc (không dùng sai phân hữu hạn $\frac{f(x+h)-f(x-h)}{2h}$ vốn gây nhiễu số học).
  * Cho phép bật/tắt hiển thị đường cong đạo hàm $f'(x)$ (nét đứt) và $f''(x)$ (nét chấm gạch) cùng công thức LaTeX tường minh ngay trên giao diện.
  * **Xử lý đạo hàm các hàm ML gãy khúc (Piecewise/Non-Smooth Functions):**
    * Áp dụng quy tắc dưới-gradient (Clarke Subdifferential) cho $\text{ReLU}(u) \xrightarrow{d/du} H(u)$ và $|u| \xrightarrow{d/du} \text{sign}(u)$. Hỗ trợ chuyển đổi quy ước tại điểm gãy $u = 0$: $H(0) = 0, \text{sign}(0) = 0$ (chuẩn huấn luyện PyTorch/JAX giúp bảo toàn nghiệm thưa cho Lasso $L_1$) hoặc $H(0) = 0.5$ (chuẩn đối xứng hình học).
    * Đối với đạo hàm bậc 2 tại điểm gãy ($\frac{d^2}{dx^2}\text{ReLU}(x) = \delta(x)$, $\frac{d^2}{dx^2}|x| = 2\delta(x)$): hiển thị đúng ký hiệu hàm suy rộng Dirac delta $\delta(x)$ ở khung công thức, đồng thời sử dụng **nhân làm trơn thích ứng theo độ rộng pixel** ($\tau = 2 \cdot \Delta x_{\text{pixel}}$) khi vẽ đồ thị và tính Hessian:
      $$\delta_\tau(u) = \frac{1}{\tau}\sigma\!\left(\frac{u}{\tau}\right)\!\left(1 - \sigma\!\left(\frac{u}{\tau}\right)\right)$$

* **[FR-2.2] Tiếp tuyến Động & Ý nghĩa Hình học:**
  * Khi người dùng di chuột hoặc kéo một điểm thăm dò trên đường cong tại hoành độ $x_0$, hệ thống vẽ đường tiếp tuyến $y = f'(x_0)(x - x_0) + f(x_0)$ kèm theo tam giác vuông hiển thị tỷ số độ dốc $\frac{\Delta y}{\Delta x}$.
  * Tại các đỉnh nhọn không khả vi (như $x_0 = 0$ của $\text{ReLU}(x)$ hoặc $|x|$), hiển thị thêm dải quạt mờ biểu diễn toàn bộ tập hợp dưới-vi phân (subdifferential fan, ví dụ đoạn hệ số góc $[0, 1]$ cho $\text{ReLU}$).

* **[FR-2.3] Đạo hàm Riêng theo Trọng số ($\frac{\partial \mathcal{L}}{\partial w}, \frac{\partial \mathcal{L}}{\partial b}$) & Nâng Hạt nhân Biểu tượng (Symbolic Kernel Lifting):**
  * Hỗ trợ tính và hiển thị công thức đạo hàm riêng phần theo các tham số trọng số để minh họa tường minh quy tắc dây chuyền (Chain Rule) trong thuật toán Backpropagation.
  * **Cơ chế chống bùng nổ biểu thức (Anti-Expression Swell):** Khi tính đạo hàm trên tập dữ liệu gồm $N$ điểm $(x_i, y_i)$, hệ thống chỉ thực hiện đạo hàm biểu tượng một lần duy nhất trên hạt nhân mẫu đơn $\ell(x, y; w, b)$ với độ phức tạp $\mathcal{O}(1)$, sau đó khử biểu thức con chung (CSE DAG) và biên dịch JIT bằng **Số Kép Phẳng (Unboxed Dual Numbers)** để tính tổng trung bình $\frac{1}{N}\sum_{i=1}^N \nabla_{w,b}\ell_i$ trong vòng lặp `Float64Array`.

* **[FR-2.4] Bộ Viết lại AST Bảo vệ Số học IEEE 754 (Pre-Differentiation Numerical Stability Pass):**
  * Trước khi tính đạo hàm hoặc biên dịch ra hàm thực thi, hệ thống tự động quét cây MathJSON để hợp nhất các cấu trúc dễ gây tràn số (`Infinity`) hoặc vô định (`NaN`):
    * Tự động chuyển $\frac{1}{1 + e^{-z}} \rightarrow \text{SafeSigmoid}(z)$ (tính $\frac{1}{1+e^{-z}}$ khi $z \ge 0$ và $\frac{e^z}{1+e^z}$ khi $z < 0$).
    * Tự động chuyển $\ln(1 + e^z) \rightarrow \text{SafeSoftplus}(z) = \max(0, z) + \text{log1p}(e^{-|z|})$.
    * Tự động hợp nhất biểu thức Binary Cross-Entropy $-y\ln(\sigma(z)) - (1-y)\ln(1-\sigma(z)) \rightarrow \text{BCEWithLogits}(y, z) = \max(z, 0) - yz + \text{log1p}(e^{-|z|})$ với đạo hàm theo $z$ rút gọn thành $\sigma(z) - y$.

---

### 3.3. Module 3: Engine Đồ họa 2D/3D Thích ứng, Giải tích Khoảng & Điểm Đáng chú ý (POIs)

* **[FR-3.1] Lấy mẫu Đệ quy Thích ứng Không gian Màn hình (Adaptive Screen-Space Sampler):**
  * Thay thế phương pháp chia lưới đều bằng thuật toán chia nhỏ đệ quy nhị phân từ $64$ đoạn hạt giống lệch pha tỷ lệ vàng (ngăn chặn hiện tượng chồng phổ Nyquist trên các hàm dao động nhanh như $\sin(1/x)$).
  * Điều kiện dừng đệ quy được tính trực tiếp trong tọa độ pixel màn hình: bình phương khoảng cách vuông góc từ điểm giữa đến dây cung $d_\perp^2 \le 0.45^2\text{ px}^2$ và độ lệch góc giữa hai đoạn liên tiếp $\cos^2\theta \ge \cos^2(5.5^\circ)$, đảm bảo bắt chính xác các đỉnh nhọn của $\text{ReLU}, |x|$ mà không bị vạt tù góc.

* **[FR-3.2] Phát hiện Điểm Kỳ dị & Tiệm cận bằng Số học Khoảng Tupper $(\text{val}, \text{def}, \text{cont})$:**
  * Đánh giá biểu thức chứa phép chia, căn thức, logarit hoặc hàm bước nhảy bằng bộ ba khoảng giá trị $\text{val}$, cờ miền xác định $\text{def}$ và cờ tính liên tục $\text{cont}$.
  * Tự động chèn điểm ngắt đa tuyến (`NaN` break) để không vẽ các đường thẳng đứng nối sai qua tiệm cận đứng ($1/x, \tan x$) hoặc qua điểm nhảy gián đoạn của hàm bước Heaviside $H(x), \text{sign}(x)$.

* **[FR-3.3] Tự động Phát hiện và Ghim "Điểm Đáng chú ý" (Points of Interest - POIs):**
  * Sử dụng đại số **Số Siêu Kép bậc 2 (`Jet2`) kèm chữ ký nhánh bitmask** kết hợp **Thuật toán tìm nghiệm Brent** (độ chính xác $10^{-12}$) để tự động hiển thị các chấm tương tác tại:
    * Nghiệm của hàm số ($f(x) = 0$) và giao điểm với trục tung ($x = 0$).
    * Cực đại và cực tiểu địa phương trơn ($f'(x) = 0$).
    * Điểm uốn nơi độ cong đổi dấu ($f''(x) = 0$).
    * **Điểm gãy từng phần (Piecewise Kinks)** nơi chữ ký nhánh thay đổi (ví dụ đỉnh $(0, 0)$ của $\text{ReLU}(x)$, $|x|$ hoặc điểm gãy $\pm\delta$ của Huber Loss).

* **[FR-3.4] Khung nhìn Lai Canvas 2D + WebGL2 (`regl`) cho Không gian 3D:**
  * Kết hợp lớp **HTML5 Canvas 2D** ở tầng trên (vẽ đường cong sắc nét, tiếp tuyến, điểm dữ liệu và nhãn KaTeX) với lớp **WebGL2 (`regl`)** ở tầng dưới để hiển thị bề mặt hàm Loss 3D $\mathcal{L}(w_1, w_2)$.
  * Đường đồng mức (Contour Lines / Isolines) được tính toán trực tiếp trong Fragment Shader bằng hàm đạo hàm màn hình phần cứng `fwidth()` (tiêu tốn $0\text{ ms}$ CPU), kết hợp vẽ $2.500$ mũi tên trường vector $-\nabla \mathcal{L}$ bằng một lệnh GPU Instancing duy nhất.

---

### 3.4. Module 4: Mô phỏng Chuyên biệt cho Machine Learning

* **[FR-4.1] Khung nhìn Không gian Kép Đồng bộ (Coordinated Dual-Space Viewport):**
  * Giao diện chia đôi hiển thị song song **Không gian Dữ liệu (Data Space - Trái)** và **Không gian Tham số / Hàm Loss (Parameter/Loss Space - Phải)**.
  * **Gắn kết hai chiều thời gian thực (Bi-Directional Binding):**
    * Kéo vị trí hạt trọng số $(w, b)$ trên bản đồ đồng mức ở Khung phải sẽ làm xoay và dịch chuyển tức thì đường dự đoán $\hat{y} = f(x; w, b)$ ở Khung trái.
    * Kéo một điểm dữ liệu $(x_i, y_i)$ ở Khung trái (ví dụ tạo điểm ngoại lai - outlier) sẽ làm biến dạng tức thì địa hình đường đồng mức và dịch chuyển đáy cực tiểu của hàm Loss ở Khung phải ở tốc độ 60 FPS.
  * **Liên kết Quét chọn (Linked Brushing):** Khi di chuột lên một điểm dữ liệu $(x_i, y_i)$ ở Khung trái, Khung phải làm nổi bật mặt phẳng mất mát riêng phần $\ell_i(w, b)$ và vector lực kéo $-\nabla_{w,b}\ell_i$ của riêng mẫu dữ liệu đó.

* **[FR-4.2] Trình mô phỏng Hạt lăn Gradient Descent & "Cuộc đua Bộ tối ưu hóa" (Optimizer Race):**
  * Cho phép click thả một hạt thử nghiệm đơn lẻ hoặc dùng **Vòng Xuất phát Đồng thời (Drop-Ring Launcher)** để thả cùng lúc 4 hạt đại diện cho 4 thuật toán tối ưu hóa từ cùng một tọa độ xuất phát:
    1. **Vanilla SGD (Màu Đỏ):** Cập nhật $w_{t+1} = w_t - \eta \nabla \mathcal{L}(w_t)$, hiển thị mũi tên hướng ngược đạo hàm tức thời.
    2. **SGD + Momentum / Nesterov NAG (Màu Cam):** Cập nhật với hệ số quán tính $\beta$, hiển thị đuôi sao chổi biểu thị vector vận tốc tích lũy $v_t$ và điểm thăm dò nhìn trước cho NAG.
    3. **RMSProp (Màu Xanh lơ):** Hiển thị vòng hào quang elip thích ứng co giãn theo nghịch đảo căn bậc hai của bình phương đạo hàm trung bình trượt.
    4. **Adam (Màu Xanh đậm):** Kết hợp cả đuôi quán tính ($m_t$) và vòng hào quang thích ứng ($v_t$), hỗ trợ công tắc bật/tắt Hiệu chỉnh Độ chệch ($\hat{m}_t, \hat{v}_t$).
  * Trang bị **Thanh trượt Thời gian Huấn luyện (Timeline Scrubber)** cho phép người dùng kéo tua ngược hoặc xuôi qua từng bước lặp $t \in [0, T]$ để phân tích chi tiết quỹ đạo hội tụ.

* **[FR-4.3] Bảng Điểm Dữ liệu Tương tác, Tính Loss Tự động & Hình học Điều chuẩn ($L_1 / L_2$):**
  * Cho phép chấm từng điểm, kéo thả điểm dữ liệu $(x_i, y_i)$, hoặc dùng **Cọ Phun Dữ liệu (Data Brush)** để tạo nhanh đám mây điểm trên mặt phẳng. Hỗ trợ phân tách trực quan tập **Huấn luyện (Hình tròn đặc)** và tập **Kiểm tra (Vòng tròn rỗng)**.
  * Vẽ đoạn thẳng sai số dư (residuals $r_i = y_i - \hat{y}_i$) cùng hình vuông diện tích sai số $r_i^2$ (độ mờ $0.25$), đồng thời tính và hiển thị trực tiếp giá trị MSE, MAE, Huber hoặc BCE Loss theo thời gian thực.
  * **Tương tác Ranh giới Điều chuẩn Hình học:** Trên Khung nhìn Tham số, hiển thị miền ràng buộc **Hình thoi $L_1$ (Lasso)** hoặc **Hình tròn $L_2$ (Ridge)** tại gốc tọa độ $(0, 0)$ có thể nắm kéo trực tiếp bán kính để quan sát tiếp điểm với đường đồng mức hàm Loss (minh họa trực quan cách đỉnh nhọn của Hình thoi $L_1$ triệt tiêu trọng số về đúng bằng $0$).

* **[FR-4.4] Thư viện 15 Mẫu Toán học ML (1-Click Templates):**
  * Cung cấp menu chọn nhanh 15 kịch bản tương tác kinh điển bao phủ 5 chủ đề lớn (chi tiết tại Mục 5): *Hàm kích hoạt & Triệt tiêu đạo hàm*, *Hàm mất mát & Độ bền với Outlier*, *Phân phối xác suất & KL Divergence*, *Lịch trình Learning Rate & Batch Norm*, và *Ranh giới quyết định, SVM Kernel & Không gian gập MLP*.

---

### 3.5. Module 5: Lưu trữ Trạng thái, Chia sẻ Zero-Backend & Hệ sinh thái Mở rộng

* **[FR-5.1] Lưu trữ Cục bộ với `localStorage` & Nút Save / Auto-save:**
  * Nút **"Save"** trên thanh công cụ cho phép lưu toàn bộ trạng thái phiên làm việc hiện tại (danh sách biểu thức, vai trò ký hiệu, giá trị và cận của thanh trượt, vị trí zoom/pan của 2 khung nhìn, tọa độ các điểm dữ liệu và cấu hình bộ tối ưu) vào `localStorage` dưới khóa `openmlgraph_requirements_v1` (và tự động đồng bộ sang khóa cấu trúc mở rộng `openmlgraph_state_v2`).
  * Hỗ trợ cơ chế **Auto-save** (tự động lưu bản nháp sau mỗi $500\text{ ms}$ nghỉ thao tác) và khôi phục tức thì khi mở lại trình duyệt.

* **[FR-5.2] Xuất File `.json` & Chia sẻ qua URL Hash Nén ($\le 2.000$ ký tự):**
  * Cung cấp tính năng tải xuống file sao lưu `.json` chuẩn hóa và nạp lại (Import) qua kéo thả file.
  * **Đường ống Nén URL Không Máy chủ (Zero-Backend URL Pipeline):**
    * Chuyển đổi trạng thái sang cấu trúc **Compact Positional Array JSON** (loại bỏ các khóa chuỗi lặp lại, làm phẳng mảng điểm dữ liệu hoặc lượng tử hóa `Uint16` theo khung nhìn).
    * Nén dữ liệu bằng luồng gốc `CompressionStream('deflate-raw')` kết hợp mã hóa `Base64URL` không ký tự đệm (`omitPadding: true`), đóng gói vào URL Hash theo định dạng có phiên bản: `#v2.dr.<payload>`.
    * Đảm bảo một trạng thái phức tạp gồm $3$ hàm số, $5$ thanh trượt và $200$ điểm dữ liệu luôn có độ dài URL $\approx 1.420 - 1.450$ ký tự, nằm dưới ngưỡng giới hạn an toàn tuyệt đối **$2.000$ ký tự** của mọi trình duyệt và nền tảng nhắn tin.
    * Tích hợp hệ thống **Di trú Schema Đơn hướng (Unidirectional Schema Migration $v_1 \rightarrow v_2 \rightarrow v_n$)** để các liên kết chia sẻ cũ hoạt động vĩnh viễn khi nâng cấp phiên bản mới.
    * Cập nhật URL bằng `window.history.replaceState()` có debounce $300\text{ ms}$ khi kéo thanh trượt để không làm tràn lịch sử nút "Back" của trình duyệt.

* **[FR-5.3] Kiến trúc Plugin Khai báo & Hộp cát Bảo mật (Community Extensibility):**
  * Cung cấp 3 giao diện khai báo định kiểu mạnh (`defineMathFunction`, `defineOptimizer`, `defineLesson`) tự động đăng ký qua `import.meta.glob`, cho phép cộng đồng mã nguồn mở đóng góp hàm kích hoạt, bộ tối ưu hóa hoặc bài giảng mới chỉ bằng **1 file độc lập** mà không cần sửa mã nguồn lõi.
  * Mọi đoạn mã bộ tối ưu hóa JavaScript tùy chỉnh được chia sẻ qua URL phải được thực thi cô lập bên trong hộp cát **MicroQuickJS WASM** (có bộ ngắt thời gian thực thi chống vòng lặp vô hạn và chặn hoàn toàn truy cập DOM/Network).

---

## 4. YÊU CẦU PHI CHỨC NĂNG (NON-FUNCTIONAL REQUIREMENTS)

* **[NFR-1] Hiệu năng Thời gian thực & Đa luồng (Performance & Concurrency):**
  * **Tốc độ khung hình:** Đảm bảo đạt tối thiểu **60 FPS** (chu kỳ $16.67\text{ ms}$) và tương thích **120 FPS** ($8.33\text{ ms}$) trên màn hình tần số quét cao.
  * **Ngân sách tính toán lại (Recalculation Budget):** Tổng thời gian tính toán lại $1.000+$ điểm dữ liệu, lấy mẫu thích ứng $5$ đồ thị hàm số, trích xuất điểm POI và cập nhật lưới Loss 3D khi kéo thanh trượt phải **dưới $4.0\text{ ms}$** (mục tiêu thiết kế đạt $\approx 1.75\text{ ms}$).
  * **Kiến trúc Không Khóa (Zero UI Jank):** Toàn bộ tác vụ phân tích CAS, lấy mẫu và chạy vòng lặp Gradient Descent phải thực thi trên **Compute Web Worker** và đồng bộ với luồng chính qua bộ nhớ đệm kép **`SharedArrayBuffer` + `Atomics`** (tự động hạ cấp an toàn sang `Transferable ArrayBuffer` nếu ứng dụng bị nhúng trong thẻ `<iframe>` không có header COEP).

* **[NFR-2] Độ chính xác Giải tích & Xử lý Ngoại lệ Toán học (Mathematical Robustness):**
  * Tự động phát hiện và ngắt nét vẽ chính xác tại các điểm kỳ dị (asymptotes) khi hàm tiến tới $\pm\infty$ hoặc trả về `NaN`.
  * Không bao giờ xảy ra lỗi tràn số `NaN` khi tính hàm mất mát $\text{BCE}$ hoặc đạo hàm $\text{Sigmoid}$ ở các giá trị đầu vào lớn ($|z| > 50$ đến $|z| = 800$).
  * Tích hợp **Bộ bảo vệ Phân kỳ (Divergence Guard)**: Khi người dùng đặt Learning Rate $\eta$ quá lớn khiến quỹ đạo Gradient Descent vượt ngưỡng $\|w_t\| > 10^6$, hệ thống dừng hạt tại biên và hiển thị cảnh báo trực quan thay vì làm treo khung vẽ.

* **[NFR-3] Tính sẵn sàng Ngoại tuyến (Offline-First PWA Ready):**
  * Vận hành hoàn toàn ngoại tuyến 100% sau lần tải trang đầu tiên.
  * Toàn bộ tệp nhị phân `.wasm`, mã nguồn `.js/.css` và bộ font toán học `.woff2` (của KaTeX/MathLive) phải được đóng gói nội bộ (self-hosted) và lưu đệm trước (Precache) qua Service Worker.
  * Tích hợp `coi-serviceworker` để tự động kích hoạt chế độ cô lập nguồn chéo (`Cross-Origin-Opener-Policy: same-origin` và `Cross-Origin-Embedder-Policy: require-corp`) ngay trên các nền tảng lưu trữ tĩnh miễn phí như GitHub Pages.

* **[NFR-4] Trải nghiệm Người dùng & Phân cấp Thị giác (UX & Visual Hierarchy):**
  * Áp dụng quy chuẩn **Phân lớp Độ mờ Nhận thức (Opacity Layering)**: đối tượng tương tác chính (đường mô hình, hạt tối ưu) có độ mờ $1.0$; đối tượng ngữ cảnh (hình vuông sai số dư, miền ràng buộc $L_1/L_2$, đường đạo hàm phụ) có độ mờ $0.35$; lưới tọa độ nền có độ mờ $0.15$.

---

## 5. DANH MỤC 15 MẪU TOÁN HỌC ML CHUẨN (SPECIFICATION CHO `[FR-4.4]`)

Mỗi mẫu trong thư viện 1-Click Templates khi được kích hoạt sẽ tự động nạp biểu thức LaTeX, cấu hình miền thanh trượt và sinh tập điểm dữ liệu mẫu tương ứng:

| Mã Mẫu | Tên Mẫu 1-Click (Template Title) | Biểu thức Lõi Mặc định | Trọng tâm Trực quan hóa |
| :--- | :--- | :--- | :--- |
| **T-01** | Sigmoid, Tanh & Triệt tiêu Đạo hàm | $f(x) = \sigma(w \cdot x + b)$ | Quan sát đỉnh đạo hàm $\sigma'(x) \le 0.25$ và sự suy giảm mũ qua nhiều tầng. |
| **T-02** | Họ ReLU: LeakyReLU, ELU, Swish & GELU | $f(x) = \max(\alpha x, x)$ vs. $\text{GELU}(x)$ | Hiện tượng "Dead ReLU" khi trọng số âm và cách độ dốc $\alpha$ hoặc cổng mượt cứu hạt tối ưu. |
| **T-03** | Softmax với Nhiệt độ $\tau$ | $p_i = \frac{e^{z_i / \tau}}{\sum_j e^{z_j / \tau}}$ | Chuyển đổi liên tục từ phân phối đều ($\tau \rightarrow \infty$) sang hàm nhọn $\text{argmax}$ ($\tau \rightarrow 0^+$). |
| **T-04** | Đọ sức Hàm Loss: MSE vs. MAE vs. Huber | $\ell_\delta(r) = \text{Huber}(y - (wx+b), \delta)$ | Kéo 1 điểm dữ liệu thành Outlier để thấy MSE bị kéo lệch mạnh còn MAE và Huber giữ vững đường khớp. |
| **T-05** | Binary Cross-Entropy vs. MSE Phân loại | $\mathcal{L}(w,b) = \text{BCE}(y, \sigma(wx+b))$ | So sánh vùng đồng bằng phẳng lì (plateau) của MSE với mặt chảo lồi dốc đứng của BCE. |
| **T-06** | Hinge Loss & Khoảng lề Cực đại SVM | $\ell(x,y) = \max(0, 1 - y(wx+b))$ | Chứng minh chỉ các điểm nằm trong hành lang lề (Support Vectors) mới tạo ra lực kéo đạo hàm. |
| **T-07** | Ước lượng Hợp lý Cực đại (Gaussian MLE) | $p(x;\mu,\sigma) = \frac{1}{\sigma\sqrt{2\pi}}e^{-\frac{(x-\mu)^2}{2\sigma^2}}$ | Kéo đỉnh và độ rộng hình chuông để tối đa hóa tổng Log-Likelihood trên mặt phẳng $(\mu, \sigma)$. |
| **T-08** | Phân kỳ KL Thuận vs. Nghịch ($D_{\text{KL}}$) | $D_{\text{KL}}(P \parallel Q)$ vs. $D_{\text{KL}}(Q \parallel P)$ | Minh họa tính chất *Mean-seeking* (bao phủ 2 đỉnh) so với *Mode-seeking* (bám 1 đỉnh). |
| **T-09** | Cập nhật Hậu nghiệm Bayes (Beta-Bernoulli) | $P(\theta \mid D) \propto \theta^{\alpha+k-1}(1-\theta)^{\beta+n-k-1}$ | Quan sát đường Posterior dịch chuyển từ Prior về phía tần suất thực nghiệm khi thêm dữ liệu. |
| **T-10** | Ngưỡng Phân kỳ Learning Rate ($\eta > 2/\lambda_{\max}$) | $\mathcal{L}(w) = \frac{1}{2}\lambda w^2$ | Thử nghiệm 3 chế độ: hội tụ đơn điệu, nhảy zig-zag tắt dần, và phân kỳ nổ tung. |
| **T-11** | Cosine Annealing & Warm Restarts | $\eta_t = \eta_{\min} + \frac{1}{2}(\eta_{\max}-\eta_{\min})(1+\cos\frac{T_{\text{cur}}}{T_i}\pi)$ | Cách nhịp bật tăng tốc độ học giúp hạt tối ưu nhảy thoát khỏi hố cực tiểu cục bộ xấu. |
| **T-12** | Batch Normalization & Làm tròn Địa hình Loss | $\hat{z} = \gamma \frac{z - \mu_B}{\sqrt{\sigma_B^2 + \epsilon}} + \beta$ | Bật Batch Norm để biến hẻm núi elip hẹp thành các đường đồng mức tròn đồng tâm dễ tối ưu. |
| **T-13** | Logistic Regression & Đường cong ROC-AUC | $\hat{p} = \sigma(w_1 x_1 + w_2 x_2 + b) \ge \tau$ | Kéo ngưỡng phân lớp $\tau \in [0, 1]$ ở Khung trái và xem điểm sáng chạy trên đường cong ROC ở Khung phải. |
| **T-14** | Thủ thuật Hạt nhân SVM (2D Rings $\rightarrow$ 3D RBF) | $\phi(x_1, x_2) = \exp(-\gamma(x_1^2 + x_2^2))$ | Nâng dữ liệu hai vòng tròn đồng tâm 2D lên ngọn đồi 3D để cắt tách bằng một mặt phẳng phẳng. |
| **T-15** | Mạng Nơ-ron 2 Tầng & Phép Gấp Không gian | $h = \tanh(\mathbf{W}_1 \mathbf{x} + \mathbf{b}_1)$ | Biến dạng lưới tọa độ nền liên tục để biến bài toán XOR thành khả phân tuyến tính. |

---

## 6. MA TRẬN KIỂM THỬ & TIÊU CHÍ NGHIỆM THU (ACCEPTANCE CRITERIA)

Hệ thống chỉ được công nhận đạt chuẩn **Production-Ready (v2.0.0)** khi vượt qua toàn bộ 6 bài kiểm thử nghiệm thu định lượng dưới đây:

1. **Kiểm thử Giải tích Phi trơn & Điểm gãy (`[AC-01]`):**
   * *Thao tác:* Nhập hàm `relu(x)` và `abs(x - 2)`, bật hiển thị đạo hàm bậc 1, bậc 2 và điểm POI.
   * *Kết quả kỳ vọng:* Đồ thị vẽ đỉnh nhọn tuyệt đối tại $(0,0)$ và $(2,0)$ (không bị vạt tù góc khi zoom); chấm POI tự động ghim đúng tọa độ điểm gãy với sai số $< 10^{-10}$; đường tiếp tuyến tại điểm gãy không bị lỗi `NaN`.
2. **Kiểm thử Chống Tràn số IEEE 754 (`[AC-02]`):**
   * *Thao tác:* Chọn mẫu Logistic Regression với hàm mất mát Binary Cross-Entropy, kéo thanh trượt trọng số $w = 100$ trên điểm dữ liệu $x = 10, y = 1$ (khiến logit $z = 1000$).
   * *Kết quả kỳ vọng:* Giá trị Loss trả về đúng $0.0$ và đạo hàm trả về $0.0$, tuyệt đối không xuất hiện `NaN` hay `-Infinity`.
3. **Kiểm thử Tiệm cận & Bước nhảy (`[AC-03]`):**
   * *Thao tác:* Nhập hàm `1 / (x - 1)` và `sign(x)`.
   * *Kết quả kỳ vọng:* Không có đường kẻ dọc giả nối giữa $-\infty$ và $+\infty$ tại $x = 1$, cũng như không có vách đứng nối giữa $-1$ và $1$ tại $x = 0$.
4. **Kiểm thử Hiệu năng Kéo Thanh trượt Không gian Kép (`[AC-04]`):**
   * *Thao tác:* Khởi tạo $200$ điểm dữ liệu trên Khung trái, bật bản đồ đồng mức Loss + trường vector + cuộc đua 4 hạt tối ưu ở Khung phải, sau đó kéo liên tục một điểm dữ liệu hoặc thanh trượt $w$.
   * *Kết quả kỳ vọng:* Chrome DevTools Performance ghi nhận thời gian xử lý mỗi khung hình $< 4.0\text{ ms}$, tốc độ khung hình duy trì ổn định ở $60\text{ FPS}$ (không có Long Tasks $> 50\text{ ms}$ trên Main Thread).
5. **Kiểm thử Ngân sách Độ dài URL & Lưu trữ (`[AC-05]`):**
   * *Thao tác:* Tạo $3$ biểu thức LaTeX, $5$ thanh trượt và $200$ điểm dữ liệu tương tác, nhấn nút **"Save"** và nút **"Share URL"**.
   * *Kết quả kỳ vọng:* Dữ liệu được lưu vào `localStorage` dưới khóa `openmlgraph_requirements_v1` / `openmlgraph_state_v2`; chuỗi URL Hash sinh ra có độ dài $< 2.000$ ký tự và khôi phục chính xác $100\%$ trạng thái khi mở trên một tab ẩn danh mới.
6. **Kiểm thử Vận hành Ngoại tuyến Hoàn toàn (`[AC-06]`):**
   * *Thao tác:* Tải ứng dụng lần đầu, sau đó ngắt hoàn toàn kết nối mạng (chuyển sang chế độ Offline trong DevTools) và tải lại trang (`F5`).
   * *Kết quả kỳ vọng:* Ứng dụng khởi động tức thì dưới $1\text{ giây}$, toàn bộ ký hiệu toán học LaTeX hiển thị sắc nét (không bị lỗi mất font) và bộ giải tích + WebGL hoạt động đầy đủ.