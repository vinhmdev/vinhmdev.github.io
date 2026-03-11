# **🎨 Detailed Theme Architecture: vinhmetal (The Cognitive Architect)**

Bộ màu này được thiết kế theo tỷ lệ toán học để đảm bảo độ tương phản (Accessibility) và sự hài hòa về phong thủy cho mệnh Bạch Lạp Kim.

## **🔘 1. Neutral Scale: "Pure Titanium" (Hành Kim - Chủ đạo)**

Dải màu xám bạc trung tính, mô phỏng bề mặt kim loại tinh xảo. Tránh mỏi mắt bằng cách sử dụng tông xám thuần với zero blue undertones.

| **Scale** | **HEX** | **Công dụng trong UI** | **Năng lượng & Tâm lý** |
| --- | --- | --- | --- |
| **50** | #FAFAFA | Main Background (Nền toàn trang - Light) | **Sạch sẽ & Minh mẫn:** Bảo vệ thị lực, tạo cảm giác không gian mở. |
| **100** | #F5F5F5 | Secondary Background, Surface, Code blocks | **Sự rõ ràng:** Phân tách các khối nội dung một cách tinh tế. |
| **200** | #E5E5E5 | Borders, Dividers, Inactive state | **Ngăn nắp:** Giữ cho cấu trúc Technical luôn mạch lạc. |
| **300** | #D4D4D4 | Dark Mode Body Text, Disabled elements | **Trung tính:** Giảm tiếng ồn thị giác. |
| **400** | #A3A3A3 | Placeholder text, Subtitles | **Thông tin phụ:** Không tranh chấp với nội dung chính. |
| **500** | #737373 | Meta information (Date, Tags) | **Sự ổn định:** Đọc lâu không bị nhức mắt. |
| **600** | #525252 | Heading 3, Heading 4 | **Sức mạnh:** Tạo điểm nhấn cho cấu trúc tài liệu. |
| **700** | #404040 | Light Mode Body Text, Heading 2 | **Sắc bén:** Tăng cường khả năng nhận diện thông tin. |
| **800** | #262626 | Headings, Bold, TH header bg (Dark) | **Tương phản AAA:** Độ sắc nét tối đa trên nền sáng. |
| **900** | #171717 | Main Background (Dark), Heading 1, Logo | **Quyền lực:** Khẳng định bản sắc của Architect. |
| **950** | #0A0A0A | Deepest Titanium | **Vực sâu:** Nền tối nhất cho dark mode. |

## **🌟 2. Primary Scale: "Academic Cinnabar" (Hành Hỏa - The Flame of Intellect)**

Dải màu cam học thuật, thay thế Gold để giải phóng Yong Shen thực sự. Dùng để kích thích tư duy logic với affordance sắc nét, clinical.

| **Scale** | **HEX** | **Công dụng trong UI** | **Năng lượng & Tâm lý** |
| --- | --- | --- | --- |
| **50** | #FFF7ED | Gentle Highlight background | **Sự ấm áp:** Tạo cảm giác được hỗ trợ. |
| **100** | #FFEDD5 | Search highlight / Selection color | **Ghi nhớ:** Làm nổi bật thông tin cần tìm. |
| **200** | #FED7AA | Alert backgrounds | **Cảm hứng:** Dẫn dắt suy nghĩ người đọc. |
| **300** | #FDBA74 | Accent elements | **Điểm nhấn logic:** |
| **400** | #FB923C | Dark Mode Semantic Links (AA) | **Cảnh báo:** Thu hút sự chú ý nhanh chóng. |
| **500** | #F97316 | **Brand Fire, Buttons, Main Links** | **Năng lượng:** Màu bản mệnh — sự sắc bén của Architect. |
| **600** | #EA580C | Hover state (Links/Buttons), Blockquote border | **Sự cam kết:** Phản hồi tương tác chắc chắn. |
| **700** | #C2410C | Light Mode Semantic Links (AA) | **Kiên định:** Giữ vững lập trường kiến trúc. |
| **800** | #9A3412 | Active state, Deep Text | **Chiều sâu:** Thể hiện kinh nghiệm dày dặn. |
| **900** | #7C2D12 | Deep Roots accent | **Gốc rễ:** Sự bền vững theo thời gian. |
| **950** | #431407 | Darkest Cinnabar | **Vực lửa:** Tầng sâu nhất của ngọn lửa trí tuệ. |

## **🪨 3. Secondary Scale: "Architectural Stone" (Hành Thổ - The Grounding Wealth)**

Dải màu đá ấm, cung cấp sự ấm áp phụ trợ. Đất là nguyên tố "Tài" cho Giáp Mộc.

| **Scale** | **HEX** | **Công dụng trong UI** |
| --- | --- | --- |
| **200** | #E7E5E4 | Light borders |
| **300** | #D6D3D1 | Subtle dividers |
| **400** | #A8A29E | Inactive elements |
| **500** | #78716C | Tag Base |
| **600** | #57534E | Secondary text |
| **700** | #44403C | Dark accents |
| **800** | #292524 | Deep stone |
| **900** | #1C1917 | Darkest stone |

## **🧠 4. Cognitive Ergonomics Guidelines (Quy tắc thị giác)**

1.  **Contrast Ratio:** Luôn giữ tỷ lệ tương phản giữa chữ (700) và nền (50) ở mức > 7:1 để đạt chuẩn WCAG AAA.

2.  **Cinnabar Usage:** Dùng màu Cinnabar theo quy tắc "Scalpel" (Dao phẫu thuật) - chỉ dùng ở các điểm quan trọng, không dùng cho các mảng khối lớn để tránh làm người đọc bị xao nhãng hoặc cảm thấy "chói mắt".

3.  **Typography:** Ưu tiên font "Inter" hoặc "JetBrains Mono" để đồng bộ với vẻ sắc lạnh của hệ màu Kim.


```css
/* Theme: The Cognitive Architect
   Element: Mộc Hỏa Thông Minh (Wood-Fire Brilliance)
   Vibe: Highly Technical, Clinical, Ergonomic
*/
:root {
  /* [Base Neutral]: Maps to neutral-100 to ensure high-stamina dark mode text */
  --color-neutral: 245, 245, 245;

  /* [Neutral Scale]: "Pure Titanium" (Mathematically Neutral Grey)
     Zero blue (Water) undertones. Maximizes cognitive ease and eliminates blue-light strain. */
  --color-neutral-50: 250, 250, 250;   /* #FAFAFA - Main Background (Light) */
  --color-neutral-100: 245, 245, 245;  /* #F5F5F5 - Surface / Code blocks */
  --color-neutral-200: 229, 229, 229;  /* #E5E5E5 - Borders / Dividers */
  --color-neutral-300: 212, 212, 212;  /* #D4D4D4 - Dark Mode Body Text (--tw-prose-invert-body) */
  --color-neutral-400: 163, 163, 163;  /* #A3A3A3 - Placeholder Text */
  --color-neutral-500: 115, 115, 115;  /* #737373 - Meta Info (Dates/Tags) · overridden to #A3A3A3 in dark mode */
  --color-neutral-600: 82, 82, 82;     /* #525252 - Heading 3/4 */
  --color-neutral-700: 64, 64, 64;     /* #404040 - Light Mode Body Text (--tw-prose-body) */
  --color-neutral-800: 38, 38, 38;     /* #262626 - Headings / Bold / Counters (Light) · TH header bg (Dark) */
  --color-neutral-900: 23, 23, 23;     /* #171717 - Main Background (Dark) */
  --color-neutral-950: 10, 10, 10;     /* #0A0A0A - Deepest Titanium */

  /* [Primary Scale]: "Academic Cinnabar" (Hành Hỏa - The Flame of Intellect)
     Replaces Gold. Unleashes your Bazi's true Yong Shen. Sharp, clinical affordance. */
  --color-primary-50: 255, 247, 237;   /* #FFF7ED - Gentle Highlight Bg */
  --color-primary-100: 255, 237, 213;  /* #FFEDD5 - Search Selection */
  --color-primary-200: 254, 215, 170;  /* #FED7AA - Alert Backgrounds */
  --color-primary-300: 253, 186, 116;  /* #FDBA74 */
  --color-primary-400: 251, 146, 60;   /* #FB923C - Dark Mode Semantic Links (AA) */
  --color-primary-500: 249, 115, 22;   /* #F97316 - Brand Fire */
  --color-primary-600: 234, 88, 12;    /* #EA580C - Light Mode Link Underline · Blockquote Border · Hover States */
  --color-primary-700: 194, 65, 12;    /* #C2410C - Light Mode Semantic Links (AA) */
  --color-primary-800: 154, 52, 18;    /* #9A3412 - Active States / Deep Text */
  --color-primary-900: 124, 45, 18;    /* #7C2D12 - Deep Roots */
  --color-primary-950: 67, 20, 7;      /* #431407 - Darkest Cinnabar */

  /* [Secondary Scale]: "Architectural Stone" (Hành Thổ - The Grounding Wealth)
     Provides secondary warmth. Earth serves as the "Wealth" element for Jia Wood. */
  --color-secondary-200: 231, 229, 228;/* #E7E5E4 */
  --color-secondary-300: 214, 211, 209;/* #D6D3D1 */
  --color-secondary-400: 168, 162, 158;/* #A8A29E */
  --color-secondary-500: 120, 113, 108;/* #78716C - Tag Base */
  --color-secondary-600: 87, 83, 78;   /* #57534E */
  --color-secondary-700: 68, 64, 60;   /* #44403C */
  --color-secondary-800: 41, 37, 36;   /* #292524 */
  --color-secondary-900: 28, 25, 23;   /* #1C1917 */
}
```