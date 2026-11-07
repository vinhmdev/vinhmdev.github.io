# GraphStudio — Xung đột tên hàm với ký hiệu LaTeX

Nov 7, 2026 · @Vinh

## Bối cảnh

Parser của GraphStudio coi một số chữ Hy Lạp là tên hàm, nên cùng một cách viết LaTeX có thể ra hai nghĩa khác nhau mà không báo lỗi. Vấn đề lộ ra khi làm Paper LaTeX Importer: công thức LayerNorm `\gamma \frac{x-\mu}{\sqrt{\sigma^2+\epsilon}}` bị parse thành hàm Gamma Γ(·) thay vì γ nhân phân số.

GraphStudio có hai tầng hàm:

| Tầng | Nội dung | Bật/tắt | Thêm/sửa/xoá | Tài liệu trong UI |
| --- | --- | --- | --- | --- |
| Thư viện fx (`DEFAULT_FUNCTION_LIBRARY`) | 6 hàm dựng sẵn: Attention, SwiGLU, GeGLU, RMSNorm, LayerNorm, RoPE + hàm người dùng tự định nghĩa | Có, từng hàm hoặc tất cả | Có | Chỉ có danh sách hàm |
| Hàm nguyên thuỷ của parser (`ML_FUNCTION_HEADS`) | 63 tên: sin, relu, softmax, erf, sum, gamma, sigma, delta… | Không, cố định trong code | Không | Không có |

Xung đột nằm ở tầng 2. Kết quả dưới đây đo bằng `parseLatexToMathJson` trên nhánh `feat/graphstudio-latex-import`.

## Vấn đề 1: ký hiệu trùng tên hàm nguyên thuỷ

Có 3 chữ Hy Lạp (γ, σ, δ) và chữ Latin `H` bị hiểu là hàm khi đứng ngay trước dấu `(`. `\frac{…}` và `\left(` cũng dính, vì bộ chuẩn hoá đổi chúng thành `(` trước khi parse.

| Viết | Parser hiểu là | Người viết thường muốn |
| --- | --- | --- |
| `\gamma(x+1)`, `\gamma \frac{x}{2}` | hàm Gamma Γ(·) | γ · (…), tham số scale |
| `\sigma(x)`, `\sigma (x - \mu)` | Sigmoid | ML: sigmoid. Thống kê: σ · (…), độ lệch chuẩn |
| `\delta(x)`, `\delta \left(x+1\right)` | Dirac delta | Vật lý: Dirac. ML: δ · (…), sai số |
| `H(x)`, `H (x+1)` | Heaviside | Có thể là tham số H |
| `\gamma x`, `\sigma^2 x` | phép nhân (đúng) | phép nhân |
| `\beta(x+1)`, `\lambda(x+1)`, `\mu(x+1)` | phép nhân | phép nhân |

Hai điểm bất nhất:

- Cùng dạng `\<chữ Hy Lạp>(…)` nhưng β, λ, μ ra phép nhân, còn γ, σ, δ ra hàm. Không có cảnh báo nào.
- Ký hiệu chuẩn LaTeX của hàm Gamma là `\Gamma` (chữ hoa) thì lại báo lỗi, trong khi `\gamma` (chữ thường) bị chiếm làm tên hàm.

γ là lỗi rõ ràng. σ và δ thì đa nghĩa thật sự: nghĩa đúng phụ thuộc vào lĩnh vực của công thức.

## Vấn đề 2: chữ Hy Lạp chưa được hỗ trợ

Bộ chuẩn hoá chỉ biết 12 ký hiệu: σ θ μ η α β λ γ δ ε τ π. Mọi chữ Hy Lạp khác đều báo lỗi `Unexpected character '\'`, kể cả khi dùng như tham số đơn giản.

Đã thử và xác nhận báo lỗi: `\Gamma(x)`, `\phi(x)`, `\omega x`, `\rho x`, `\kappa x`, `\nu x`, `\xi x`.

Các chữ thường gặp trong paper ML nhưng chưa thử (giả định cũng lỗi theo cùng cơ chế): `\psi`, `\zeta`, `\chi`, `\varphi`, `\vartheta`, `\Sigma`, `\Theta`, `\Phi`, `\Psi`, `\Omega`, `\Delta`, `\Lambda`.

Importer hiện chỉ vá riêng `\Phi(x)`, đổi thành dạng erf của hàm phân phối chuẩn.

## Ảnh hưởng và vị trí trong code

Lỗi nguy hiểm nhất là lỗi im lặng: đồ thị vẫn vẽ ra và không có cảnh báo, chỉ có nghĩa là sai.

- LayerNorm gõ tay: `\gamma \frac{x-\mu}{…}` vẽ ra Γ(·) thay vì γ · (…). Đường cong sai hoàn toàn về hình dạng.
- Công thức thống kê như `\sigma (x-\mu)` vẽ ra sigmoid.
- Link chia sẻ và graph đã lưu: mọi thay đổi ngữ nghĩa sẽ làm graph cũ đổi hình khi mở lại.
- Importer đang vá tạm trường hợp γ bằng cách chèn `\cdot`. Gõ tay thì chưa được vá.

| Vị trí | Vai trò |
| --- | --- |
| `core/parser/cortex-setup.ts:41` `ML_FUNCTION_HEADS` | Bảng tên hàm nguyên thuỷ; dòng 70 `gamma`, 75 `sigma`, 93 `H`, 95 `delta` |
| `core/parser/cortex-setup.ts:446` `greekMap` | Đổi `\gamma` → `gamma`…; chỉ có 12 chữ Hy Lạp |
| `core/parser/cortex-setup.ts:576` `isKnownFunctionName` | Quyết định `tên(` là lời gọi hàm hay phép nhân |
| `core/parser/latex-importer.ts:408` `SEMANTIC_PREFIXES` | Vá tạm γ trong importer, bỏ được khi sửa tận gốc |

Các đường dẫn tính từ `src/features/graphstudio/`, trên nhánh `feat/graphstudio-latex-import`.

## Hướng xử lý (đã thống nhất 07/11/2026)

Đã chốt: γ/Γ phân biệt bằng chữ hoa/thường theo chuẩn LaTeX; σ, δ, H dùng một checkbox, mặc định giữ nghĩa hàm.

1. **`\Gamma(x)` là hàm Gamma, `\gamma` luôn là chữ Hy Lạp.** Không cần checkbox cho cặp này. `\Gamma` hiện đang báo lỗi nên hỗ trợ nó là thêm mới; không template hay preset nào dùng `\gamma(` theo nghĩa hàm (đã kiểm tra). Gõ ASCII `gamma(x)` (không có `\`) vẫn là hàm Gamma, giống `sin(x)`. Sau bước này bỏ được bản vá γ trong importer.
   - Khi sửa, bộ chuẩn hoá phải đổi `\gamma` sang một dạng luôn là ký hiệu, vì hiện `\gamma` và `gamma` cho cùng một kết quả.
2. **Checkbox cho σ, δ, H, mặc định BẬT, lưu theo từng graph và đi theo link chia sẻ.** Nhãn: "Hiểu σ(…), δ(…), H(…) là hàm số (sigmoid, Dirac, Heaviside). Bỏ chọn để dùng như ký tự Hy Lạp." Mặc định phải bật vì 9 công thức trong template dùng `\sigma(` là sigmoid, và preset ở `ToolbarSubheader.tsx:201` dùng `H(` là Heaviside. Cách gọi tường minh `\operatorname{sigmoid}(x)` luôn dùng được.
   - Quy tắc hoa/thường không áp dụng được ở đây: `\Sigma` là ký hiệu tổng, `\Delta` là sai phân/Laplace.
3. **Bổ sung chữ Hy Lạp còn thiếu** làm tham số: φ ψ ω ρ κ ν ξ ζ χ và các chữ hoa (trừ `\Gamma`).
4. **Gợi ý ngay trên card** khi công thức có σ(, δ( hoặc H(: "σ(…) đang hiểu là sigmoid · đổi". Bấm vào mở đúng checkbox ở bước 2.
5. **Bảng tra cú pháp và hàm có sẵn trong app**, sinh tự động từ `ML_FUNCTION_HEADS` và `greekMap` để không bị lệch với code.

Rủi ro chính là tương thích ngược: bước 1 làm đổi hình graph cũ nào đang cố ý dùng `\gamma(x)` để chỉ hàm Gamma.

**Nguyên tắc thiết kế:** người dùng luôn thấy được thứ gì đang hoạt động trong hàm số. Không có cách hiểu nào được áp dụng ngầm. Áp vào rủi ro tương thích ngược:

- **Graph cũ dùng `\gamma(x)` theo nghĩa Gamma:** khi mở, tự chuyển sang `\Gamma(x)` để giữ nguyên hình, và báo ngay trên card: "Đã đổi `\gamma(x)` → `\Gamma(x)` (hàm Gamma) theo quy tắc mới", kèm nút hoàn tác hoặc đổi thành γ · (…). Không đổi nghĩa im lặng.
- **Card luôn hiện các hàm đang được gọi** dưới dạng chip, ví dụ "Γ = Gamma", "σ = sigmoid", "δ = Dirac". Bấm vào chip để xem định nghĩa và đổi nghĩa. Đây là cùng một UI với cảnh báo ở bước 4 và bảng tra ở bước 5.
- **Phép nhân ngầm cũng hiện rõ:** khi một chữ Hy Lạp đứng trước `(` được hiểu là tham số, card hiện "γ · (…)" để người dùng phân biệt được với lời gọi hàm.

## Câu hỏi mở cần phân tích thêm

- [ ] Mặc định của σ(·) đã chốt là sigmoid. Còn lại: có nên để template Toán mặc định tắt checkbox không?
- [ ] Có graph đã lưu hoặc link cộng đồng nào đang dùng `\gamma(…)` theo nghĩa hàm Gamma không? Quét Firebase gallery để biết bước tự chuyển sang `\Gamma(x)` sẽ chạm bao nhiêu graph.
- [x] Bật/tắt áp dụng cho tất cả 63 hàm nguyên thuỷ hay chỉ các tên xung đột?

  Chỉ σ, δ, H. γ tách riêng bằng quy tắc `\gamma` / `\Gamma`.
- [x] Cờ bật/tắt lưu theo từng graph hay theo người dùng?

  Theo từng graph, đi theo link chia sẻ.
- [ ] Có cần thêm miền nhỏ hơn không, ví dụ `\log` hiện là ln (cơ số e), trong khi một số paper dùng log cơ số 2?
