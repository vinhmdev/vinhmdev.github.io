# 02. Đánh Giá Đủ / Thiếu Tính Năng & Phân Tích Khoảng Trống (Feature Gap Analysis)

Tài liệu này thực hiện kiểm toán chéo (Cross-Audit) giữa:

1. Tài liệu đặc tả yêu cầu phần mềm [OpenMLGraph SRS v2.0.0](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/docs/math-project-resaerch/t_i_li_u_c_t_y_u_c_u_ph_n_m_m_openmlgraph_srs_v2_0_0.md).
2. Bốn báo cáo nghiên cứu chuyên sâu trong [`docs/math-project-resaerch/`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/docs/math-project-resaerch/).
3. Yêu cầu mở rộng thực tế của dự án: **Cho phép người dùng lưu dữ liệu vào Firebase và chia sẻ với mọi người**.

---

## 1. Tổng Quan Phân Loại Tính Năng

| Nhóm Đánh Giá                                              |        Số lượng Hạng mục         | Tóm tắt Nhận định                                                                                                                                                                                        |
| :--------------------------------------------------------- | :------------------------------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **✅ Đã Đủ & Thiết kế Xuất sắc (Well-Specified)**          |           11 hạng mục            | Các tính năng giải tích vô hướng 1D/2D, đạo hàm dưới-gradient, bảo vệ IEEE 754, lấy mẫu thích ứng, Khung nhìn Kép, Cuộc đua 4 Bộ tối ưu hóa, Mẫu `T-01` $\to$ `T-11`.                                    |
| **⚠️ Mâu thuẫn Nội tại trong SRS (Internal Gaps)**         | 4 kịch bản (`T-12` $\to$ `T-15`) | Danh mục mẫu ở Mục 5 yêu cầu các tính năng đa chiều, ma trận mạng nơ-ron và biểu đồ ROC-AUC chưa từng được đặc tả trong các Module 1, 2, 3, 4.                                                           |
| **❌ Còn Thiếu so với Yêu cầu Thực tế (Missing Features)** |         6 tính năng lớn          | Thiếu Lưu trữ & Chia sẻ qua **Firebase Firestore**, thiếu Thư viện Cộng đồng (Public Gallery), thiếu Import CSV Dataset, thiếu Export ảnh/đồ thị cho bài giảng, thiếu UX Mobile/Tablet, thiếu Undo/Redo. |
| **🔧 Quá tải / Có thể Tinh giản ở MVP (Over-Engineered)**  |            3 hạng mục            | Hộp cát `quickjs-emscripten` WASM ở giai đoạn đầu, Số học khoảng Tupper đầy đủ 3 thành phần, và `coi-serviceworker` bắt buộc.                                                                            |

---

## 2. Phân Tích Các Mâu Thuẫn Nội Tại Giữa SRS Mục 3 (Modules) và Mục 5 (15 Templates)

Đây là phát hiện quan trọng nhất khi đối chiếu [Mục 3 (Functional Requirements)](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/docs/math-project-resaerch/t_i_li_u_c_t_y_u_c_u_ph_n_m_m_openmlgraph_srs_v2_0_0.md#L37) với [Mục 5 (Danh mục 15 Mẫu Toán học ML Chuẩn)](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/docs/math-project-resaerch/t_i_li_u_c_t_y_u_c_u_ph_n_m_m_openmlgraph_srs_v2_0_0.md#L188) và tài liệu _Interactive ML Visualization UX Research.docx_:

### 2.1. Bảng Đối Chiếu Khả Năng Đáp Ứng Của Engine Lõi Với 15 Mẫu (`T-01` $\to$ `T-15`)

| Mã Mẫu                  | Tên Mẫu                                                                                    | Khớp với Engine Vô hướng (`FR-1..4`)? | Khoảng trống Kỹ thuật (Gap) & Giải pháp Bổ sung                                                                                                                                                                                                                                                                                                                                                          |
| :---------------------- | :----------------------------------------------------------------------------------------- | :-----------------------------------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`T-01` $\to$ `T-06`** | Sigmoid/Tanh, Họ ReLU/GELU, Softmax $\tau$, MSE/MAE/Huber, BCE, Hinge SVM 1D               |            ✅ **Đủ 100%**             | Không có khoảng trống. Chạy trực tiếp trên bộ giải tích 1 biến $x$ và tham số $(w, b)$.                                                                                                                                                                                                                                                                                                                  |
| **`T-07` $\to$ `T-09`** | Gaussian MLE $(\mu, \sigma)$, Phân kỳ $D_{\text{KL}}$, Hậu nghiệm Bayes Beta-Bernoulli     |             ⚠️ **Đủ 85%**             | **Thiếu toán tử tích phân số học 1D (Numerical Quadrature)** cho `T-08` vì $D_{\text{KL}}(P \parallel Q) = \int_{-\infty}^{\infty} p(x)\ln\frac{p(x)}{q(x)}dx$ cần tính tích phân xác định theo $x$ tại mỗi cặp tham số $(\mu_Q, \sigma_Q)$ để vẽ bề mặt Loss. **Giải pháp:** Bổ sung hàm tích phân Gauss-Legendre 32 điểm vào Compute Kernel.                                                           |
| **`T-10` $\to$ `T-11`** | Ngưỡng phân kỳ Learning Rate ($\eta > 2/\lambda_{\max}$), Cosine Annealing & Warm Restarts |             ✅ **Đủ 95%**             | Cần bổ sung tham số bước thời gian $t$ (`stepIndex`) vào hàm điều khiển Learning Rate $\eta(t)$ trong `[FR-4.2]`.                                                                                                                                                                                                                                                                                        |
| **`T-12`**              | **Batch Normalization & Làm tròn Địa hình Loss**                                           |     ❌ **Thiếu đặc tả trong FR**      | Batch Norm $\hat{z}_i = \gamma \frac{z_i - \mu_B}{\sqrt{\sigma_B^2 + \epsilon}} + \beta$ phụ thuộc vào trung bình $\mu_B$ và phương sai $\sigma_B^2$ của **toàn bộ lô điểm dữ liệu cùng lúc**, do đó **không thể tách thành hạt nhân mẫu đơn độc lập $\ell(x_i, y_i)$** như giả định ở `[FR-2.3]`. **Giải pháp:** Bổ sung bước _Batch Statistics Pre-pass_ ($\mu_B, \sigma_B$) trước vòng lặp tính Loss. |
| **`T-13`**              | **Logistic Regression 2D & Đường cong ROC-AUC**                                            |     ❌ **Thiếu đặc tả trong FR**      | Mẫu này dùng dữ liệu 2 biến đầu vào $(x_1, x_2)$ với nhãn $y \in \{0, 1\}$, và **Khung nhìn Phải hiển thị đường cong ROC $(\text{FPR}(\tau), \text{TPR}(\tau))$** thay vì mặt phẳng Loss $\mathcal{L}(w, b)$. **Giải pháp:** Bổ sung chế độ hiển thị phụ `RightViewportMode = 'loss_surface' \| 'roc_curve' \| 'feature_3d'`.                                                                            |
| **`T-14`**              | **Thủ thuật Hạt nhân SVM (2D Rings $\to$ 3D RBF)**                                         |     ❌ **Thiếu đặc tả trong FR**      | Khung nhìn Phải không vẽ mặt Loss $\mathcal{L}(w_1, w_2)$ mà vẽ **đám mây điểm 3D được nâng chiều $(x_1, x_2, \phi(x_1, x_2))$ cắt bởi mặt phẳng phân lớp phẳng**. **Giải pháp:** Tái sử dụng engine WebGL2 3D của `[FR-3.4]` để vẽ mặt phẳng cắt $z = w_1 x_1 + w_2 x_2 + b$ cùng các hạt dữ liệu 3D.                                                                                                   |
| **`T-15`**              | **Mạng Nơ-ron 2 Tầng & Phép Gấp Không gian (MLP Space Folding)**                           |     ❌ **Thiếu đặc tả trong FR**      | Biểu thức $h = \tanh(\mathbf{W}_1 \mathbf{x} + \mathbf{b}_1)$ là **phép biến đổi ma trận $\mathbb{R}^2 \to \mathbb{R}^2$** trên lưới tọa độ 2D kèm nội suy đồng luân (Homotopy Grid Morphing), không phải đồ thị hàm số $y = f(x)$. **Giải pháp:** Bổ sung 1 module vẽ lưới biến dạng 2D (`GridWarpingCanvas`) chuyên biệt cho `T-15`.                                                                   |

---

## 3. Phân Tích Các Tính Năng Còn Thiếu So Với Yêu Cầu Dự Án Thực Tế

### 3.1. [THIẾU SỐ 1 — QUAN TRỌNG NHẤT] Hệ thống Lưu trữ Đám mây Firebase & Chia sẻ Cộng đồng

- **Hiện trạng trong SRS v2.0.0:**
  - Mục 1 và Mục 3.5 (`[FR-5.1]`, `[FR-5.2]`) định nghĩa hệ thống là _"Zero-Backend"_, chỉ lưu vào `localStorage` và nén vào chuỗi URL Hash (`#v2.dr.<payload>` $\le 2.000$ ký tự).
- **Tại sao chỉ dùng URL Hash là KHÔNG ĐỦ cho yêu cầu thực tế?**
  1. **Vượt trần 2.000 ký tự khi dùng Cọ Phun Dữ liệu (`[FR-4.3]`):** Khi người dùng dùng Data Brush phun $500 - 1.000$ điểm dữ liệu $(x_i, y_i)$, thêm $4$ công thức đạo hàm, ghi chú bài học hoặc viết mã bộ tối ưu hóa tùy chỉnh (`[FR-5.3]`), dung lượng sau nén `deflate-raw` + `Base64URL` sẽ lên tới **$4.500 - 15.000$ ký tự**, vượt xa giới hạn $2.000$ ký tự của `[AC-05]` và bị cắt cụt khi gửi qua Zalo, Messenger, Slack, Discord.
  2. **Không thể cộng tác hoặc cập nhật lại cùng một đường link (`editable` mode):** Với URL tĩnh chứa dữ liệu, mỗi khi giảng viên sửa một lỗi nhỏ trong bài tập đã gửi cho sinh viên, đường link sẽ thay đổi hoàn toàn.
  3. **Không có nơi để người dùng "Share với mọi người" (Community Showcase / Gallery):** Yêu cầu của dự án nêu rõ: _"chúng ta cũng cho phép users lưu dữ liệu của họ vào firebase và share với mọi người"_. Nếu không có Firebase Firestore làm tầng lưu trữ đám mây, người dùng chỉ có thể tự giữ link cá nhân chứ không thể đăng tải mô phỏng lên bảng khám phá chung hay chia sẻ qua link ngắn gọn.
- **Giải pháp bổ sung:** Tích hợp sâu **Firebase Firestore** (chi tiết kiến trúc tại [`04-kien-truc-luu-tru-firebase-va-chia-se.md`](./04-kien-truc-luu-tru-firebase-va-chia-se.md)).

---

### 3.2. [THIẾU SỐ 2] Quản lý Lịch sử Thao tác (`Undo / Redo` Stack)

- **Vấn đề:** Trong một môi trường tương tác trực tiếp (Direct Manipulation) nơi người dùng liên tục kéo điểm dữ liệu thành Outlier, xóa nhầm điểm, hoặc kéo lệch vùng ràng buộc $L_1/L_2$, việc thiếu tổ hợp phím `Ctrl+Z / Cmd+Z` (Undo) và `Ctrl+Y / Cmd+Shift+Z` (Redo) sẽ gây ức chế lớn.
- **Giải pháp bổ sung:** Sử dụng middleware `temporal` (`zundo` — MIT, $< 1\text{ KB}$) trên kho trạng thái `zustand` để lưu tối đa 50 bước lịch sử trạng thái khi kết thúc thao tác kéo (`onPointerUp`).

---

### 3.3. [THIẾU SỐ 3] Nhập Dữ liệu Thực tế (CSV / TSV Paste & Import)

- **Vấn đề:** `[FR-4.3]` chỉ cho phép chấm từng điểm hoặc dùng Cọ Phun Dữ liệu ngẫu nhiên. Trong thực tế học tập và giảng dạy ML, người dùng rất muốn dán nhanh 2 cột dữ liệu `(x, y)` từ Excel / Google Sheets hoặc nạp một file `.csv` nhỏ (ví dụ $50 - 500$ dòng).
- **Giải pháp bổ sung:** Thêm nút **"Import/Paste CSV"** và bảng chỉnh sửa tọa độ $(x_i, y_i)$ dạng lưới gọn nhẹ bên dưới danh sách công thức.

---

### 3.4. [THIẾU SỐ 4] Xuất Đồ thị Chất lượng Cao (Export PNG / SVG / LaTeX Snippet)

- **Vấn đề:** Giảng viên, nghiên cứu sinh và blogger kỹ thuật sử dụng OpenMLGraph sẽ cần xuất hình ảnh đồ thị (kèm chú thích công thức LaTeX và quỹ đạo hội tụ) để chèn vào slide PowerPoint, bài báo LaTeX hoặc bài viết Markdown.
- **Giải pháp bổ sung:**
  - Thêm nút **"Export Image (PNG 2x DPI)"** gộp (composite) lớp WebGL2 (`preserveDrawingBuffer: true` khi chụp) và lớp Canvas 2D + nhãn công thức thành một ảnh PNG độ phân giải cao.
  - Thêm nút **"Copy Embed `<iframe />`"** cho các đồ thị đã lưu lên Firebase.

---

### 3.5. [THIẾU SỐ 5] Thiết kế Đáp ứng cho Thiết bị Di động & Máy tính bảng (Mobile / Touch UX)

- **Vấn đề:** SRS thiết kế bố cục chia đôi màn hình Trái – Phải (`[FR-4.1]`) và phụ thuộc nhiều vào thao tác `hover` chuột (ví dụ: Linked Brushing khi di chuột lên điểm dữ liệu ở `[FR-4.1]`, tiếp tuyến động khi hover ở `[FR-2.2]`). Trên điện thoại hoặc iPad màn hình dọc, hai khung nhìn chia ngang sẽ bị quá hẹp và không có sự kiện hover.
- **Giải pháp bổ sung:**
  - Trên màn hình `< 1024px`: Chuyển sang bố cục **Xếp chồng dọc (Top/Bottom Split)** hoặc **Chuyển tab nhanh (`[Data Space]` | `[Loss Space]` | `[Split]`)**.
  - Thay thế thao tác `hover` trên thiết bị cảm ứng bằng thao tác **Chạm giữ / Chọn điểm (`Tap-to-Select / Touch-Drag`)** kết hợp hỗ trợ `Pinch-to-Zoom` hai ngón tay trên Canvas.

---

### 3.6. [THIẾU SỐ 6] So sánh Đa Khung nhìn cho Quá khớp / Chưa khớp (Train vs. Test Loss Curve)

- **Vấn đề:** Trong tài liệu nghiên cứu _Interactive ML Visualization UX Research.docx_ (Mục 3.2.2), tác giả đề cập đến việc trực quan hóa hiện tượng **Overfitting / Underfitting** thông qua phân tách tập Train (tròn đặc) và tập Test (vòng rỗng). Trong SRS `[FR-4.3]` đã có phân tách chấm tròn đặc/rỗng, nhưng chưa chỉ rõ hiển thị đồng thời **2 giá trị/đường cong $\mathcal{L}_{\text{train}}$ và $\mathcal{L}_{\text{test}}$** trên bảng chỉ số và khung nhìn Loss.
- **Giải pháp bổ sung:** Hiển thị rõ 2 huy hiệu chỉ số thời gian thực `Train Loss` (Nét liền) và `Test Loss` (Nét đứt) ngay trên thanh trạng thái của Khung nhìn Phải.

---

## 4. Các Tính Năng Có Thể Tinh Giản / Hoãn Sang Giai Đoạn Sau (De-scoping cho Phase 1–2)

Để tránh kéo dài thời gian phát triển ban đầu mà không mang lại giá trị tương xứng ngay lập tức, 3 hạng mục sau trong SRS nên được tinh giản hoặc chuyển sang Phase 4:

1. **Hộp cát `quickjs-emscripten` WASM (`[FR-5.3]`):**
   - _Đánh giá:_ 99% người dùng sẽ sử dụng 4 bộ tối ưu hóa chuẩn (`SGD`, `Momentum/NAG`, `RMSProp`, `Adam`) hoặc điều chỉnh biểu thức toán học qua công thức LaTeX (vốn đã an toàn tuyệt đối vì đi qua AST của CortexJS). Chỉ những lập trình viên nâng cao muốn tự viết hàm cập nhật JS tùy chỉnh mới cần hộp cát QuickJS WASM.
   - _Đề xuất:_ Hoãn `quickjs-emscripten` sang **Phase 4** và tải lười (lazy-load) khi người dùng bật tab "Custom Optimizer Script".
2. **Đạo hàm bậc 2 suy rộng Dirac Delta $\delta(x)$ cho các hàm lồng nhau phức tạp (`[FR-2.1]`):**
   - _Đánh giá:_ Việc hiển thị ký hiệu $\delta(x)$ và vẽ xung làm trơn $\delta_\tau(u) = \frac{1}{\tau}\sigma(u/\tau)(1-\sigma(u/\tau))$ rất ấn tượng cho `relu(x)` và `abs(x)` bậc 1. Tuy nhiên, với các hàm hợp lồng nhiều tầng như `relu(sin(x^2) - relu(x))`, quy tắc chuỗi cho phân bố Dirac Delta bậc 2 ($\delta(g(x)) \cdot |g'(x)|$) rất dễ gây nhiễu thị giác trên đồ thị.
   - _Đề xuất:_ Áp dụng xung làm trơn $\delta_\tau$ chuẩn xác cho các hàm gãy khúc cơ bản (`relu`, `leaky_relu`, `abs`, `hinge`, `huber` — đảm bảo pass 100% `[AC-01]`), và tự động dùng đạo hàm bậc 2 của nhân xấp xỉ mượt trên toàn công thức đối với biểu thức lồng nhau phức tạp.
3. **`coi-serviceworker` (`[NFR-3]`):**
   - _Đề xuất:_ Loại bỏ khỏi cấu hình bắt buộc để bảo vệ kết nối Firebase Firestore và tránh hiện tượng reload trang lần đầu trên GitHub Pages; thay bằng `Transferable ArrayBuffer` qua Web Worker.
