# 04. Kiến Trúc Lưu Trữ Firebase & Chia Sẻ Với Mọi Người (Firebase Storage & Sharing Architecture)

Tài liệu này thiết kế chi tiết kiến trúc lưu trữ và chia sẻ cho **OpenMLGraph**, giải quyết yêu cầu cốt lõi của dự án:

> _"Chúng ta cũng cho phép users lưu dữ liệu của họ vào Firebase và share với mọi người."_

Đồng thời, tài liệu chỉ rõ cách tận dụng và mở rộng hạ tầng **Firebase Firestore** đã có sẵn trong kho mã nguồn [`vinhmdev.github.io`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/src/shared/paste/store.ts).

---

## 1. Tại Sao Phải Kết Hợp URL Nén (`[FR-5.2]`) Với Firebase Firestore?

Trong [SRS v2.0.0 (Mục 3.5)](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/docs/math-project-resaerch/t_i_li_u_c_t_y_u_c_u_ph_n_m_m_openmlgraph_srs_v2_0_0.md#L145), hệ thống mới chỉ thiết kế đường ống nén trạng thái vào URL Hash (`#v2.dr.<payload>` $\le 2.000$ ký tự). Tuy nhiên, khi vận hành thực tế, việc kết hợp **URL Hash** với **Firebase Firestore** mang lại lợi thế vượt trội:

| Kịch bản Sử dụng Thực tế                                                                                     | Chỉ dùng URL Hash (`#v2.dr.<payload>`)                                                                                              | Kết hợp Firebase Firestore (`vinhmdev.github.io`)                                                                                                        |
| :----------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Đồ thị phức tạp ($> 300$ điểm dữ liệu phun bằng Data Brush, 5+ hàm số, kịch bản bài giảng, mã Optimizer)** | ❌ **Thất bại:** Chuỗi Base64URL vượt $3.000 - 15.000$ ký tự, bị cắt cụt trên Zalo, Messenger, Slack, Discord và vi phạm `[AC-05]`. | ✅ **Hoàn hảo:** Lưu payload nén lên tới **900 KB** trong Firestore, đường link chia sẻ luôn ngắn gọn cố định ($\approx 65 - 85$ ký tự).                 |
| **Cập nhật nội dung sau khi đã gửi link (`Editable Share Mode`)**                                            | ❌ **Không thể:** Sửa 1 thanh trượt hay thêm 1 điểm dữ liệu là sinh ra một chuỗi URL hoàn toàn mới.                                 | ✅ **Hỗ trợ sẵn:** Người tạo chọn chế độ `editable` $\implies$ mở link và nhấn **Save** sẽ cập nhật trực tiếp vào cùng ID trên Firestore.                |
| **Chia sẻ với cộng đồng ("Share với mọi người" / Public Gallery)**                                           | ❌ **Không thể:** Không có máy chủ lưu danh mục để người dùng khác duyệt xem các đồ thị hay bài giảng mới.                          | ✅ **Hỗ trợ đầy đủ:** Người dùng có thể **Publish** đồ thị lên bộ sưu tập công khai (`public_graphs`) để mọi người khám phá, lọc theo chủ đề ML và Fork. |
| **Hoạt động hoàn toàn Offline / Nhúng nhanh không cần mạng (`[AC-06]`)**                                     | ✅ **Mạnh:** Giải mã trực tiếp từ URL Hash mà không cần gọi mạng.                                                                   | ✅ **Giữ nguyên:** Vẫn hỗ trợ xuất link `#v2.dr.<payload>` khi đồ thị nhẹ ($< 1.800$ ký tự) hoặc khi người dùng đang offline.                            |

---

## 2. Đánh Giá Hạ Tầng Firebase Sẵn Có Trong Kho Mã Nguồn (`src/shared/`)

Kho mã nguồn `vinhmdev.github.io` hiện đã triển khai một hệ thống chia sẻ qua Firebase Firestore cực kỳ bài bản cho 2 công cụ _Encrypted Paste_ và _Clipboard2Markdown_:

1. **[`src/shared/firebase/app.ts`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/src/shared/firebase/app.ts) & [`config.ts`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/src/shared/firebase/config.ts):**
   - Quản lý Singleton `getFirebaseApp()` và biến kiểm tra an toàn `isFirebaseConfigured` từ các biến môi trường `PUBLIC_FIREBASE_*`.
2. **[`src/shared/paste/crypto.ts`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/src/shared/paste/crypto.ts) & [`store.ts`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/src/shared/paste/store.ts):**
   - Mã hóa đầu-cuối (E2EE) bằng chuẩn **AES-256-GCM** ngay trên trình duyệt qua Web Crypto API gốc.
   - Lưu vào collection `pastes` với 2 chế độ:
     - `'readonly'`: Bất biến sau khi tạo; nếu người nhận chỉnh sửa sẽ tạo bản Fork mới.
     - `'editable'`: Bất kỳ ai có đường link chứa khóa giải mã đều có thể cập nhật nội dung tại chỗ (`updatePaste(id, enc)`).
   - Tích hợp sẵn cơ chế tự hủy theo thời gian sống (**TTL `expireAt`** từ 1 giờ đến 1 năm).
3. **[`src/shared/paste-share/share.ts`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/src/shared/paste-share/share.ts) & [`history.ts`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/src/shared/paste-share/history.ts):**
   - Cung cấp sẵn toàn bộ giao diện **Share Modal**, **Bottom Share Status Bar** (`Save` / `Fork` / `Copy Link` / `Detach`) và ngăn kéo **"My Shared Docs"** lưu lịch sử tối đa 40 tài liệu × 12 phiên bản snapshot trong `localStorage` của từng thiết bị mà không bắt buộc người dùng phải đăng ký tài khoản!
4. **[`firestore.rules`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/firestore.rules):**
   - Đã cấu hình quy tắc bảo mật chặt chẽ cho collection `pastes`: cho phép `get`, cấm `list` (chống quét trộm danh sách), kiểm tra kích thước `ct.size() <= 900000` (~900 KB) và khóa cứng các trường `mode`, `createdAt`, `expireAt` khi `update`.

---

## 3. Thiết Kế Kiến Trúc Lưu Trữ & Chia Sẻ 3 Tầng (3-Tier Hybrid Architecture) Cho OpenMLGraph

Để vừa đáp ứng đầy đủ các tiêu chí kiểm thử `[AC-05]` & `[AC-06]` của SRS v2.0.0, vừa cho phép người dùng **lưu dữ liệu vào Firebase và chia sẻ với mọi người**, chúng ta thiết kế hệ thống lưu trữ 3 tầng đồng nhất thông qua một bộ điều phối định tuyến Hash (`HashRouterCodec`):

```
                      ┌──────────────────────────────────────────────┐
                      │   Trạng thái Phiên làm việc OpenMLGraph      │
                      │ (Expressions, Sliders, DataPoints, Viewport, │
                      │  OptimizerRace, CustomPlugin, Metadata)      │
                      └──────────────────────┬───────────────────────┘
                                             │
            ┌────────────────────────────────┼────────────────────────────────┐
            ▼                                ▼                                ▼
┌───────────────────────┐      ┌───────────────────────────┐    ┌───────────────────────────┐
│ TẦNG 1: LOCAL STORAGE │      │ TẦNG 2: STATELESS URL     │    │ TẦNG 3: FIREBASE CLOUD    │
│ • Auto-save 500ms     │      │ • Định dạng:              │    │ • 3A. Link E2EE (#id.key) │
│ • Nút Save cục bộ     │      │   #v2.dr.<base64url>      │    │   Tái sử dụng @shared/    │
│ • My Graphs History   │      │ • Nén deflate-raw         │    │   paste (Readonly/Edit)   │
│   (12 snapshots/đồ thị│      │ • Dùng khi Offline hoặc   │    │ • 3B. Public Gallery      │
│   qua history.ts)     │      │   Quick Copy (<2.000 chars│    │   (#g.<id>) trên          │
└───────────────────────┘      └───────────────────────────┘    │   collection public_graphs│
                                                                └───────────────────────────┘
```

### 3.1. Phân biệt Tự động 3 Định dạng URL Hash Khi Mở Trang (`/openmlgraph/`)

Khi người dùng mở một đường dẫn `/openmlgraph/#...`, bộ phân tích URL sẽ nhận diện tức thì theo tiền tố:

1. **Định dạng 1 — Stateless URL Nén (`#v2.dr.<payload>`):**
   - Nhận diện bởi tiền tố `^#v\d+\.(dr|fl)\.`
   - Giải nén trực tiếp trên trình duyệt bằng `DecompressionStream('deflate-raw')` (dự phòng bằng `fflate.inflateSync`) mà **không cần gọi mạng**. Đạt chuẩn `[FR-5.2]` và `[AC-05]`.
2. **Định dạng 2 — Firebase E2EE Cloud Link (`#<pasteId>.<aesKey>`):**
   - Nhận diện bởi cấu trúc `^[A-Za-z0-9]{20}\.[A-Za-z0-9_-]{43}$` (20 ký tự Firestore Auto-ID + dấu chấm + 43 ký tự khóa AES-256 Base64URL).
   - **Tái sử dụng [`initShare()`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/src/shared/paste-share/share.ts#L572) hoặc tầng primitives (`@shared/paste/crypto.ts`, `@shared/paste/store.ts`, `@shared/paste-share/history.ts`)** để có ngay:
     - Lưu đám mây mã hóa đầu-cuối (AES-256-GCM) lên Firestore (`pastes` collection) với dung lượng lên tới **900 KB** (đủ chứa hàng chục nghìn điểm dữ liệu và kịch bản đầy đủ).
     - Chế độ **Anyone with the link can edit (`editable`)** hoặc **Read-only (`readonly` — cho phép người nhận nhấn nút Fork)**.
     - Ngăn kéo **"My Saved Graphs"** lưu toàn bộ danh sách đồ thị đã tạo/mở kèm lịch sử phiên bản (`storageKey: 'openmlgraph_docs'`).
   - > ⚠️ **Cảnh báo Xung đột Hash thực tế trong Codebase (`parseHash()` tại [`src/shared/paste-share/share.ts:102-107`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/src/shared/paste-share/share.ts#L102-L107)):**
     > Hàm `parseHash()` hiện tại chỉ kiểm tra `raw.indexOf('.')` để tách `{ id, key }`, và `initShare()` gắn listener `window.addEventListener('hashchange', ...)` ở dòng 599. Nếu gọi `initShare()` trực tiếp trên trang OpenMLGraph mà không sửa `parseHash()`, khi người dùng mở link nén `#v2.dr.<payload>` hoặc link cộng đồng `#g.<graphId>`, `parseHash()` sẽ nhận nhầm `id = "v2"` (hoặc `id = "g"`) vì đều chứa dấu chấm `.` và gọi `fetchPaste("v2")` gây lỗi _"Paste not found or expired"_!
     > **Giải pháp bắt buộc khi code:** Siết chặt biểu thức chính quy trong [`parseHash()`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/src/shared/paste-share/share.ts#L102-L107) (chỉ khớp khi `!/^(v\d+\.(dr|fl)|g)\./.test(raw)` hoặc khớp đúng độ dài khóa AES-256 `key.length === 43`), giúp `initShare()` bỏ qua an toàn các hash `#v2.dr.*` và `#g.*` mà không ảnh hưởng tới `/paste/` và `/clipboard2markdown/`.
3. **Định dạng 3 — Firebase Public Community Share (`#g.<graphId>`):**
   - Nhận diện bởi tiền tố `#g.<graphId>`.
   - Tải đồ thị công khai từ collection `public_graphs` trên Firestore để phục vụ tính năng **"Khám phá & Chia sẻ với mọi người" (Community Gallery)**.

---

### 3.2. Thiết Kế Tính Năng "Share Với Mọi Người" — Thư Viện Cộng Đồng (`public_graphs`)

Trong khi `pastes` dùng mã hóa E2EE và cấm truy vấn danh sách (`allow list: if false;` trong [`firestore.rules`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/firestore.rules#L22)) để bảo mật tuyệt đối cho dữ liệu riêng tư, yêu cầu **"share với mọi người"** trong một công cụ giáo dục toán ML như Desmos/GeoGebra còn bao gồm khả năng **đăng tải đồ thị công khai để mọi người cùng xem và học tập**.

Do đó, bên cạnh chế độ Share Link E2EE sẵn có, chúng ta bổ sung chế độ **"Publish to Community Gallery"** lưu vào collection mới `public_graphs`:

#### A. Cấu trúc Document trong Collection `public_graphs/{graphId}`

```typescript
export interface PublicGraphDoc {
  v: 2; // Phiên bản schema
  title: string; // Tiêu đề đồ thị (tối đa 120 ký tự, ví dụ: "So sánh Adam vs SGD trên Rosenbrock")
  author: string; // Tên/Biệt danh người chia sẻ (tối đa 50 ký tự, ví dụ: "VinhMDev" hoặc "Anonymous")
  category: 'activation' | 'loss' | 'optimization' | 'probability' | 'boundary' | 'custom';
  description: string; // Mô tả ngắn gọn ý nghĩa toán học (tối đa 500 ký tự)
  primaryLatex: string; // Công thức LaTeX đại diện để hiển thị thẻ xem trước (Preview Card) qua KaTeX
  payload: string; // Chuỗi trạng thái đồ thị đã nén (#v2.dr.<base64url> hoặc Compact JSON <= 200 KB)
  createdAt: Timestamp; // Thời điểm xuất bản (serverTimestamp)
  expireAt: Timestamp; // Thời điểm hết hạn TTL (mặc định 365 ngày)
}
```

> 💡 **Lưu ý Truy vấn & Composite Index trên Firestore:**
> Để tránh phải cấu hình Composite Index thủ công (`where('category', '==', ...) + orderBy('createdAt', 'desc')`) trên Firebase Console ngay từ đầu, truy vấn Community Gallery chỉ cần dùng Single-field Index mặc định của Firestore: `query(collection(db, 'public_graphs'), orderBy('createdAt', 'desc'), limit(30))` và lọc theo `category` ngay trên bộ nhớ Client (0 ms cho 30 bản ghi), hoặc khai báo file `firestore.indexes.json` nếu lọc phía server.

#### B. Cập nhật Quy tắc Bảo mật [`firestore.rules`](file:///Users/vinh/Desktop/mdev/vinhmdev.github.io/firestore.rules) Đề xuất

Giữ nguyên 100% quy tắc hiện tại của `match /pastes/{pasteId}` và chỉ thêm block `match /public_graphs/{graphId}` với giới hạn kích thước, kiểu dữ liệu và giới hạn truy vấn (`request.query.limit <= 30`) để bảo vệ hạn mức miễn phí (Spark Tier: 50.000 reads/ngày, 20.000 writes/ngày):

```javascript
    // Collection mới phục vụ tính năng "Share với mọi người" (Community Gallery) của OpenMLGraph
    match /public_graphs/{graphId} {
      // Cho phép đọc từng đồ thị hoặc lấy danh sách phân trang (tối đa 30 mục/lần để chống vét cạn)
      allow get: if true;
      allow list: if request.query.limit != null && request.query.limit <= 30;

      // Chỉ cho phép tạo mới (Immutable public snapshot - muốn sửa thì Fork hoặc dùng chế độ E2EE editable)
      allow create: if
        request.resource.data.keys().hasOnly([
          'v', 'title', 'author', 'category', 'description',
          'primaryLatex', 'payload', 'createdAt', 'expireAt'
        ])
        && request.resource.data.v == 2
        && request.resource.data.title is string
        && request.resource.data.title.size() >= 3
        && request.resource.data.title.size() <= 120
        && request.resource.data.author is string
        && request.resource.data.author.size() >= 1
        && request.resource.data.author.size() <= 50
        && request.resource.data.category in [
          'activation', 'loss', 'optimization', 'probability', 'boundary', 'custom'
        ]
        && request.resource.data.description is string
        && request.resource.data.description.size() <= 500
        && request.resource.data.primaryLatex is string
        && request.resource.data.primaryLatex.size() <= 500
        && request.resource.data.payload is string
        && request.resource.data.payload.size() > 0
        && request.resource.data.payload.size() <= 200000 // Giới hạn 200 KB cho đồ thị công khai
        && request.resource.data.createdAt == request.time
        && request.resource.data.expireAt is timestamp
        && request.resource.data.expireAt > request.time
        && request.resource.data.expireAt <= request.time + duration.value(366, 'd');

      allow update, delete: if false;
    }
```

---

## 4. Quy Trình Trải Nghiệm Người Dùng Khi Lưu & Chia Sẻ (UX Flow)

Trên thanh Header của **OpenMLGraph**, người dùng sẽ có 3 nút hành động rõ ràng, trực quan:

1. **Nút `Save` (kèm Auto-save ngầm 500ms):**
   - Lưu tức thì toàn bộ trạng thái vào `localStorage` (`openmlgraph_requirements_v1` & `openmlgraph_state_v2` theo đúng `[FR-5.1]`).
   - Nếu đang mở một link Firebase ở chế độ `editable`, nút Save trên thanh trạng thái dưới đáy màn hình sẽ đồng bộ bản cập nhật lên thẳng Firestore.
2. **Nút `Share` (Mở Hộp thoại Chia sẻ Đa chế độ):**
   - **Tab 1 — Cloud Link (Firebase E2EE - Khuyến nghị mặc định):**
     - Chọn chế độ **Editable** (_Ai có link đều có thể sửa và lưu đè lên cùng link_) hoặc **Read-only** (_Đóng băng; người nhận có thể Fork_).
     - Chọn thời hạn lưu trữ (1 ngày, 1 tuần, 1 tháng, 1 năm).
     - Tạo link ngắn `/openmlgraph/#<id>.<key>` — không bao giờ lo tràn độ dài URL dù có hàng nghìn điểm dữ liệu.
   - **Tab 2 — Publish to Community (Share với mọi người):**
     - Nhập Tiêu đề, Tên tác giả, Chủ đề ML và Mô tả ngắn.
     - Xuất bản lên thư viện **Community Gallery** và nhận link ngắn `/openmlgraph/#g.<id>`.
   - **Tab 3 — Offline URL Hash & Export JSON (`[FR-5.2]`):**
     - Copy trực tiếp chuỗi URL tự chứa `#v2.dr.<payload>` ($\le 2.000$ ký tự) hoặc tải xuống file `.json` để lưu trữ ngoại tuyến.
3. **Nút `Explore / My Graphs` (Ngăn kéo Quản lý & Khám phá):**
   - **Tab "My Saved Graphs":** Xem lại toàn bộ các đồ thị đã tạo hoặc đã mở trên thiết bị này, khôi phục các phiên bản lịch sử (`versions`) nhờ `@shared/paste-share/history.ts`.
   - **Tab "15 ML Templates":** Chọn nhanh 15 mẫu chuẩn `T-01` $\to$ `T-15` của `[FR-4.4]`.
   - **Tab "Community Shared":** Duyệt danh sách các đồ thị mới nhất do cộng đồng chia sẻ từ Firestore `public_graphs`, hiển thị công thức bằng `KaTeX` và mở chỉ với 1 cú nhấp chuột.
