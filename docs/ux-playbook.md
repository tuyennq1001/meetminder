# UX Playbook dùng lại cho các dự án

Tài liệu này chắt lọc các bài học UX đã áp dụng trong Meet Minder thành các
nguyên tắc có thể đưa vào brief, thiết kế, code review và kiểm thử cho dự án
khác.

Đây là tài liệu **reference**: dùng để tra nhanh khi xây một màn hình mới.
Nguyên tắc mặc định là ưu tiên khả năng khám phá, thao tác có thể hoàn tác,
trạng thái rõ ràng và không làm mất ngữ cảnh người dùng.

## 1. Nguyên tắc nền tảng

| Nguyên tắc | Quy tắc áp dụng |
| --- | --- |
| Người dùng luôn biết mình đang ở đâu | Hiển thị tiêu đề, tab/scope đang chọn, số lượng bản ghi và trạng thái active rõ ràng. |
| Thao tác quan trọng phải có đường lui | Có Cancel/Close, Escape cho dialog, undo hoặc confirm cho thao tác phá huỷ. |
| Không làm mất trạng thái đang nhập | Khi lọc hoặc re-render, giữ query, bộ lọc, trang, focus và vị trí con trỏ nếu có thể. |
| Feedback phải gần với nguyên nhân | Loading, empty, error, disabled và success cần có trạng thái riêng; lỗi nên nói người dùng cần làm gì tiếp theo. |
| Một pattern dùng chung phải có một hành vi chung | Các bảng, modal, nút hành động và thuật ngữ giống nhau nên dùng cùng quy tắc trên toàn sản phẩm. |

## 2. Data table: mặc định phải lọc được và sort ở header

Áp dụng cho bảng dữ liệu do người dùng quản lý hoặc bảng có khả năng tăng số
dòng. Bảng tĩnh rất nhỏ có thể miễn trừ, nhưng phải ghi rõ lý do trong design
review.

### Hợp đồng UX của một data table

| Thành phần | Yêu cầu mặc định |
| --- | --- |
| Filter | Có filter tổng quát hoặc filter theo cột. Với bảng nhiều thuộc tính, ưu tiên một hàng filter ngay dưới header để người dùng thấy phạm vi lọc. |
| Sort | Header của các cột có ý nghĩa sắp xếp phải click được; click lần đầu sort tăng dần, click lại đảo chiều. |
| Sort indicator | Luôn có dấu trung tính khi chưa chọn; cột đang sort có mũi tên `▲/▼`, màu active và trạng thái truy cập được. |
| Phạm vi lọc | Nêu rõ filter áp dụng trên toàn bộ dataset hay chỉ trang hiện tại. Mặc định nên lọc trước rồi mới phân trang. |
| Reset | Có một nút `Clear`/`Xoá bộ lọc` để xoá toàn bộ điều kiện trong một lần. |
| Pagination | Khi danh sách dài, có số bản ghi, trang hiện tại/tổng số trang, page size và nút Previous/Next disabled đúng trạng thái. |
| Selection | Nếu có chọn nhiều dòng, checkbox chọn tất cả phải chỉ áp dụng cho tập đang lọc; trạng thái indeterminate phải được hiển thị. |
| Empty state | Phân biệt “chưa có dữ liệu” với “không tìm thấy kết quả phù hợp bộ lọc”; câu chữ nên hướng dẫn bước tiếp theo. |
| Responsive | Bảng rộng được đặt trong vùng cuộn ngang có chủ đích; không ép chữ khiến dữ liệu khó đọc. |
| Dữ liệu mới | Dùng default sort hợp lý, thường là mới nhất trước với log/event; không để thứ tự thay đổi ngẫu nhiên sau mỗi lần tải. |

### Các chi tiết quan trọng rút ra từ Meet Minder

- Filter thay đổi thì đưa người dùng về trang 1; nếu không, họ có thể thấy
  trang rỗng và tưởng hệ thống lỗi.
- Khi input filter đang được focus, chỉ cập nhật `tbody` hoặc giữ lại focus và
  selection range; re-render toàn bảng sau mỗi ký tự sẽ làm con trỏ nhảy và
  người dùng mất nhịp nhập.
- Filter phụ thuộc nhau phải cập nhật option liên quan. Ví dụ chọn Customer
  thì danh sách Project chỉ nên còn các project hợp lệ.
- Khi đổi scope như Work/Personal/All, phải reset hoặc ẩn những filter không
  còn hợp lệ; không giữ một điều kiện “vô hình” làm người dùng không hiểu vì
  sao kết quả thiếu.
- Cột số, ngày và text cần comparator phù hợp; không sort ngày dưới dạng chuỗi
  hiển thị nếu format ngày không bảo đảm thứ tự từ điển.
- Trạng thái sort/filter nên được giữ khi quay lại màn hình; các lựa chọn có
  ích như sort và page size có thể lưu local/session storage.
- Các badge hoặc count có thể là deep link sang màn hình khác với filter tương
  ứng đã bật sẵn. Điều này rút ngắn đường đi từ “có bao nhiêu?” đến “xem những
  bản ghi nào?”.

### Accessibility tối thiểu cho table

- Dùng `<caption>` hoặc tên accessible cho bảng.
- Header sort nên là button hoặc có keyboard interaction; không chỉ phụ thuộc
  vào click chuột.
- Cột đang sort phải expose `aria-sort="ascending|descending|none"`.
- Checkbox phải có label/accessible name; nút icon phải có `title` hoặc
  `aria-label` mô tả hành động, không chỉ mô tả hình icon.
- Focus ring phải nhìn thấy rõ trên cả header, input filter và nút trong dòng.

## 3. Dialog/popup: luôn có Escape để thoát

### Hợp đồng UX của dialog

| Tình huống | Hành vi mặc định |
| --- | --- |
| Mở dialog | Focus vào trường đầu tiên cần nhập hoặc action an toàn nhất. |
| Đóng bằng bàn phím | `Escape` đóng dialog trên cùng; không đóng nhầm view cha hoặc dialog phía dưới. |
| Đóng bằng chuột | Nút `Close/X` và nút `Cancel` phải có; click backdrop có thể tương đương Cancel nếu không gây mất dữ liệu. |
| Focus | Tab bị giữ trong dialog; khi đóng, focus quay về control đã mở dialog. |
| Semantics | Dùng `role="dialog"`, `aria-modal="true"`, `aria-labelledby` và mô tả nếu dialog phức tạp. |
| Footer | Cancel ở vị trí dễ nhận biết; primary action ở cuối; destructive action phải có màu và copy riêng. |
| Dữ liệu chưa lưu | Escape/backdrop không được âm thầm commit hoặc xoá; nếu có rủi ro mất dữ liệu thì cần confirm rõ ràng. |
| Async/progress | Có tiến độ, bước hiện tại, trạng thái lỗi, Cancel thật sự và lựa chọn chạy nền nếu tác vụ dài. |

### Quy tắc copy và nút

- Dùng động từ cụ thể: `Kết thúc & Lưu`, `Xoá`, `Huỷ`, `Chạy ngầm`; tránh
  `OK`, `Submit`, `×` làm nhãn duy nhất cho hành động quan trọng.
- Không đặt hai nút có hậu quả đối lập nhưng cùng màu hoặc cùng trọng lượng
  thị giác.
- Nút đóng bằng `X` phải có tooltip/accessible label; người dùng không nên
  phải đoán icon.
- Khi đóng bằng Escape, hãy chạy cùng cleanup path với Cancel để Promise,
  timer, suggestion list và dữ liệu tạm không bị bỏ lại.
- Autocomplete hoặc popup nằm trong toolbar có `overflow` không nên render
  trực tiếp bên trong vùng cuộn nếu nó cần mở ra ngoài vùng đó. Dùng một
  portal ở cấp `body`, định vị theo control mở popup và cập nhật vị trí khi
  viewport scroll/resize để suggestion không bị cắt khỏi màn hình.
- Phân cấp thị giác giữa Primary Action (CTA chính như Start/Lưu) và Toggle/Utility Action (như Take Note):
  CTA chính dùng màu bão hòa cao, glow và elevation rõ nét để dẫn dắt hành động; nút toggle phụ dùng màu
  bão hòa thấp (tinted surface), bỏ glow chói, chỉ giữ viền và độ tương phản vừa đủ để thể hiện trạng thái
  pressed mà không tranh chấp sự chú ý với CTA chính.

### Khoảng trống cần chuẩn hóa ở dự án mới

Meet Minder đã gom Escape và backdrop dismissal vào một behavior chung, nhưng
đây không thay thế cho focus trap, focus restore và ARIA đầy đủ. Khi mang pattern
này sang dự án khác, cần đưa ba hạng mục đó vào Definition of Done ngay từ đầu.

## 4. Điều hướng và giữ ngữ cảnh

- Nhóm màn hình theo hoạt động chính của người dùng; mỗi activity chỉ hiển thị
  control liên quan, tránh một toolbar chứa mọi chức năng.
- Với các scope song song (ví dụ Work/Personal/All), dùng tab rõ ràng, giữ
  scope đang chọn và hiển thị count để người dùng biết dữ liệu nằm ở đâu.
- Từ một count, badge, category, project hoặc tag nên có đường tắt đến danh
  sách đã lọc sẵn.
- Khi quay lại list từ detail, giữ filter/sort/page nếu người dùng đang duyệt
  danh sách; chỉ reset khi họ chủ động chọn reset.
- Nếu nội dung đang stream hoặc auto-scroll, tôn trọng việc người dùng đã kéo
  lên đọc lịch sử: dừng auto-scroll và cung cấp một nút “về cuối”.

## 5. Trạng thái và feedback

Mỗi màn hình có dữ liệu nên thiết kế đủ các trạng thái sau trước khi code:

| Trạng thái | Cần trả lời câu hỏi |
| --- | --- |
| Loading | Hệ thống đang làm gì, có thể mất bao lâu? |
| Success | Thao tác đã hoàn tất ở đâu, dữ liệu có được lưu không? |
| Empty | Chưa có dữ liệu hay filter không khớp? Người dùng nên làm gì? |
| Error | Điều gì thất bại, có thể thử lại không, cần sửa cấu hình nào? |
| Disabled | Vì sao control bị khoá, và cần làm gì để dùng được? |
| Background | Tác vụ dài có thể chạy nền không, xem lại tiến độ ở đâu? |

Các quy tắc đã chứng minh hữu ích trong Meet Minder:

- Không disable một lựa chọn cấu hình chỉ vì prerequisite chưa được nhập nếu
  người dùng cần vào lựa chọn đó để nhập prerequisite. Cho phép chọn, hiển thị
  lý do và chặn ở bước thực thi với hướng dẫn rõ ràng.
- Với thao tác tốn thời gian, cho thấy các bước và phần trăm/trạng thái thay vì
  spinner vô hạn.
- Với hành động nguy hiểm, copy phải nói rõ phạm vi ảnh hưởng và nút phải nói
  rõ kết quả.
- Không dùng toast làm kênh duy nhất cho lỗi quan trọng; lỗi cần lưu lại trong
  ngữ cảnh thao tác hoặc cho phép retry.
- Với tác vụ import/re-transcript dài, lỗi phải giữ nguyên trong progress dialog
  cho đến khi người dùng chủ động đóng; không tự biến mất như toast.
- Với thao tác kết thúc/lưu quan trọng, phải mở dialog xác nhận ngay; dữ liệu
  phụ như metadata, tag hoặc autocomplete chỉ được tải nền và không được khóa
  action chính bằng một lời gọi async không có giới hạn thời gian.

## 6. Consistency: thuật ngữ, biểu tượng và thứ tự thông tin

- Một khái niệm chỉ nên có một tên: ví dụ dùng thống nhất `Customer`, `Project`,
  `Category`, `Tag` trong header, filter, modal và detail.
- Icon là tín hiệu phụ, không thay thế text; cùng một đối tượng nên giữ cùng
  icon trên toolbar, form, bảng và badge.
- Các form có cùng loại metadata nên giữ cùng thứ tự trường và cùng cách ghi
  giá trị rỗng, ví dụ `(Không chọn...)` thay vì trộn nhiều cách diễn đạt.
- Placeholder minh hoạ format nhập; label mô tả ý nghĩa. Không dùng placeholder
  thay cho label.
- Hover, active, selected, focus và disabled phải phân biệt được bằng màu,
  shape hoặc text; không dựa duy nhất vào màu.

## 7. Checklist copy vào ticket/PRD

### Data table

- [ ] Có filter phù hợp với dữ liệu; filter theo cột nếu người dùng cần tìm theo nhiều thuộc tính.
- [ ] Header sort được bằng chuột và bàn phím; có chỉ báo neutral/ascending/descending.
- [ ] Filter chạy trước pagination; thay filter đưa về trang 1.
- [ ] Có Clear filters và empty state phân biệt đúng nguyên nhân.
- [ ] Giữ filter, sort, page size, focus và vị trí con trỏ sau re-render.
- [ ] Có loading, error, zero-result và pagination state.
- [ ] Selection/batch action chỉ tác động trên tập người dùng đang thấy hoặc có copy nói rõ phạm vi.
- [ ] Có `aria-sort`, accessible name và focus ring.

### Dialog/popup

- [ ] Có `Escape`, Close/X và Cancel; Escape đóng dialog trên cùng.
- [ ] Backdrop click chỉ tương đương Cancel khi an toàn.
- [ ] Có focus vào dialog, focus trap và restore focus khi đóng.
- [ ] Có role/label ARIA phù hợp.
- [ ] Nút primary/destructive/cancel có thứ bậc và copy rõ ràng.
- [ ] Dữ liệu chưa lưu không bị mất âm thầm.
- [ ] Tác vụ async có progress, cancel, error/retry và chạy nền nếu cần.

### Điều hướng và feedback

- [ ] Người dùng biết activity/scope/filter hiện tại.
- [ ] Có deep link từ count/badge đến danh sách liên quan.
- [ ] Có trạng thái loading/success/empty/error/disabled/background.
- [ ] Không auto-scroll hoặc tự đổi context khi người dùng đang đọc/chỉnh sửa.
- [ ] Lỗi nói rõ nguyên nhân và bước tiếp theo.

## 8. Nguồn bài học trong Meet Minder

Các pattern trên được đối chiếu từ những phần sau của codebase:

- Logs table: `src/js/app.js` — filter, sort, pagination, selection, giữ focus
  và deep link giữa metadata với Logs.
- Settings management tables: `src/js/app.js` — Customer, Project, Category,
  Tag dùng chung filter row, sort indicator, Clear và empty state.
- Modal behavior: `src/js/app.js` — `_bindModalDismissal()` gom Escape và
  backdrop click về cùng đường Cancel/cleanup.
- Dialog markup/style: `src/index.html`, `src/styles/main.css` — modal card,
  footer action, input focus, progress dialog và background task.
- Các thay đổi làm lộ bài học: commit `191b397` (Logs table), `bf5a453`
  (Date sort + lưu lựa chọn), `119c8b5` (giữ scroll), `76bf28e` (progress +
  confirm delete), `59c81ca` (unify filters/dialogs/sort arrows).
