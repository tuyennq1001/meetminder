# Kế hoạch nâng cao chất lượng code và test — Meet Minder

Ngày lập: 01/10/2026. Trạng thái: kế hoạch đề xuất, chưa triển khai thay đổi code.

## 1. Mục tiêu và phạm vi

- Giảm code tập trung trong các file lớn, làm rõ trách nhiệm và phụ thuộc giữa module.
- Bảo vệ dữ liệu cuộc họp và hành vi đang hoạt động khi refactor.
- Tăng khả năng phát hiện lỗi bằng test có ý nghĩa và kiểm tra tự động.
- Tạo một quy trình kiểm tra dùng được khi phát triển và trước khi merge.

Thực hiện từng phần nhỏ. Refactor giữ nguyên hành vi; tính năng mới, sửa bug và thay đổi định dạng dữ liệu được thực hiện thành thay đổi riêng. Kế hoạch này không yêu cầu chuyển framework, chuyển toàn bộ sang TypeScript hoặc phát hành Release mới.

## 2. Hiện trạng đã kiểm tra sơ bộ

| Hạng mục | Bằng chứng | Giới hạn kết luận |
|---|---|---|
| Frontend | `src/js/app.js`: 16.079 dòng vật lý | Chưa đánh giá toàn bộ trách nhiệm và độ phức tạp của từng hàm |
| Backend | `src-tauri/src/commands/session_store.rs`: 7.087 dòng vật lý, bao gồm test trong file | Không dùng tổng số dòng để kết luận riêng về chất lượng logic |
| Test frontend | Một file `session-store.test.js`; đã chạy 4/4 test thành công trong cuộc trao đổi này | Chủ yếu kiểm tra bản nháp memo theo template/ngôn ngữ |
| Test backend | Có test trong các module Rust và `tests/test_audio_flow.rs` | Chưa chạy toàn bộ, chưa đo coverage |
| Test phụ thuộc máy | `test_settings_load` yêu cầu API key trong cấu hình thật; hai test audio được đánh dấu chạy riêng | Cần phân tách test tự động và test môi trường thật |
| Kiểm tra tự động | `package.json` có lint/format Rust; workflow hiện có phục vụ release theo tag | Chưa có lệnh quality tổng hợp và workflow kiểm tra PR |

Các số dòng trên chưa loại dòng trống và comment. Không dùng trực tiếp chúng để so với ngưỡng lint chỉ tính dòng code. Hiện trạng cần được đo lại ở giai đoạn 1.

## 3. Lộ trình triển khai

Đợt nền tảng đang được triển khai trên nhánh `codex/quality-rules-and-gates`: coding rules, giới hạn file JavaScript theo baseline, lệnh quality, test settings không phụ thuộc cấu hình thật và workflow PR. Đã tách bộ meeting-minutes templates đầu tiên khỏi `app.js`.

| Giai đoạn | Việc chính | Đầu ra | Điều kiện chuyển bước |
|---|---|---|---|
| 1. Audit và lập mốc | Chạy kiểm tra hiện có, đọc các luồng rủi ro, đo coverage và phụ thuộc | Báo cáo hiện trạng, danh sách vấn đề theo ưu tiên, bộ dữ liệu mẫu | Phân biệt được lỗi sản phẩm, lỗi test và blocker môi trường |
| 2. Thiết lập coding rule | Chốt quy tắc, cấu hình công cụ, ghi nhận ngoại lệ code cũ | Coding rules, cấu hình kiểm tra, danh sách ngoại lệ | Code mới được kiểm tra; vi phạm cũ có phạm vi và hướng xử lý |
| 3. Củng cố test | Làm test độc lập; bổ sung test cho phần sắp refactor | Test hành vi và test tích hợp với dữ liệu giả | Bộ test liên quan chạy ổn định trước khi sửa cấu trúc |
| 4. Refactor từng module | Tách một trách nhiệm mỗi đợt; giữ hợp đồng và hành vi | Các thay đổi nhỏ có thể review và hoàn tác riêng | Test qua, review qua, luồng liên quan chạy đúng trên Dev |
| 5. Tự động hóa | Gộp kiểm tra và chạy trên PR | `npm run quality` và workflow quality | Kiểm tra không cần dữ liệu cá nhân; lỗi kiểm tra chặn merge theo cấu hình repo |
| 6. Duy trì | Áp dụng tiêu chí hoàn tất cho mọi thay đổi | Checklist PR và theo dõi xu hướng chất lượng | Mọi ngoại lệ, test bỏ qua và phần chưa kiểm chứng đều được ghi rõ |

Giai đoạn 5 có thể bắt đầu sớm sau giai đoạn 2–3. Không cần đợi refactor toàn bộ app mới có kiểm tra PR.

### Giai đoạn 1 — Audit và lập mốc

- Ghi nhận nhánh, thay đổi chưa commit và môi trường; giữ nguyên công việc đang có của người dùng.
- Chạy test frontend/backend, kiểm tra định dạng và lint bằng chế độ không tự sửa.
- Đo coverage riêng cho frontend/backend; ghi rõ phần chưa đo được.
- Đọc code để tìm trách nhiệm trộn lẫn, phụ thuộc vòng, state dùng chung, tác vụ đến muộn, tài nguyên chưa được dọn và lỗi bị nuốt.
- Đánh giá dữ liệu lưu trữ, tương thích dữ liệu cũ và đường dẫn mà test sử dụng.
- Lập danh sách: vị trí code, bằng chứng, tác động, ưu tiên, cách sửa và cách kiểm chứng.

Ưu tiên 0: mất/ghi nhầm dữ liệu, crash, test đụng dữ liệu thật. Ưu tiên 1: vòng đời phiên, realtime, xử lý lỗi và luồng quan trọng thiếu test. Ưu tiên 2: cấu trúc, độ dài, trùng lặp và khả năng đọc.

### Giai đoạn 2 — Coding rule và công cụ

#### Nguyên tắc thiết kế

| Nguyên tắc | Quy định |
|---|---|
| SRP | Một hàm làm một việc; một module có trách nhiệm rõ ràng |
| KISS | Chọn cấu trúc đơn giản đáp ứng yêu cầu; hạn chế điều kiện lồng nhau và lớp trung gian |
| DRY | Dùng chung logic khi có cùng ý nghĩa nghiệp vụ và lý do thay đổi; tránh gom chung chỉ vì code trông giống nhau |
| YAGNI | Chỉ xây abstraction và cấu hình phục vụ nhu cầu hiện tại |
| Tách các mối quan tâm | Tách giao diện, nghiệp vụ, lưu trữ và kết nối dịch vụ |
| Đóng gói | Mỗi trạng thái có nơi quản lý; thay đổi qua API module rõ ràng |
| Đảo chiều phụ thuộc | Logic nghiệp vụ nhận dịch vụ qua giao diện rõ ràng, không gắn cứng vào provider hoặc môi trường |
| Kết hợp thành phần | Ưu tiên ghép hàm/module nhỏ; chỉ dùng kế thừa khi có nhu cầu rõ ràng |

#### Ngưỡng ban đầu đề xuất

| Chỉ số | Ngưỡng cho code mới | Cách áp dụng |
|---|---|---|
| Dòng code/file | Tối đa 500; mục tiêu 200–300 | JavaScript: ESLint `max-lines`; Rust: review và bổ sung kiểm tra phù hợp |
| Dòng code/hàm | Tối đa 60 | JavaScript: `max-lines-per-function`; Rust: review/công cụ phù hợp |
| Độ phức tạp nhánh/hàm | Tối đa 10 | JavaScript: `complexity`; Rust: Clippy với cấu hình phù hợp |
| Tầng lồng nhau | Tối đa 3 | JavaScript: `max-depth`; Rust: review/công cụ phù hợp |

Các ngưỡng là quy ước dự án, không phải chuẩn bắt buộc của ngôn ngữ. Loại dòng trống và comment khi đo độ dài. File sinh tự động, vendor, dữ liệu dịch và test có quy định riêng; tránh bỏ qua toàn bộ kiểm tra chỉ vì chúng là test.

#### Quy tắc viết code

- Đặt tên theo ý định; tên giá trị thời gian/kích thước phải thể hiện đơn vị.
- Dùng guard clause để xử lý điều kiện không hợp lệ sớm.
- Tách tính toán khỏi tác động bên ngoài như DOM, ghi file và gọi mạng.
- Hạn chế sửa dữ liệu đầu vào; nếu có sửa, hợp đồng hàm phải nói rõ.
- Đặt tên cho giá trị nghiệp vụ, timeout, giới hạn và trạng thái có ý nghĩa.
- Dùng options object khi nhiều tham số gây khó hiểu; tránh boolean không thể hiểu tại nơi gọi.
- Định nghĩa rõ đầu vào, đầu ra, lỗi và khả năng hủy. JavaScript dùng JSDoc cho API module; Rust dùng kiểu và `Result` phù hợp.
- Không dùng `catch` rỗng hoặc coi lỗi lưu dữ liệu là thành công.
- Tác vụ bất đồng bộ phải xử lý lỗi, hủy và kết quả đến muộn; kiểm tra danh tính phiên trước khi cập nhật.
- Dọn timer, listener, kết nối và audio stream đúng vòng đời; tránh đăng ký trùng.
- Comment giải thích lý do, ràng buộc và workaround. Xóa code chết/import thừa.
- Không tạo dependency vòng hoặc một module `utils` gom các trách nhiệm không liên quan.
- Không ghi API key, credential hoặc nội dung cuộc họp vào log không cần thiết.

Ghi quy tắc vào `docs/coding-rules.md` và dẫn chiếu từ `AGENTS.md`. Formatter phụ trách định dạng; lint phụ trách các quy tắc đo được; reviewer kiểm tra trách nhiệm, phụ thuộc và tính dễ hiểu.

Mốc Clippy ban đầu có 33 cảnh báo trên các module hiện hữu khi thử `-D warnings`. Lệnh quality hiện vẫn chạy Clippy nhưng chưa nâng cảnh báo thành lỗi. Sau khi ghi nhận và xử lý baseline, có thể bật `-D warnings` để ngăn cảnh báo mới.

Với code cũ vượt ngưỡng: ghi ngoại lệ theo file/rule, lý do, mốc đo và việc cần xử lý. Không tăng vi phạm hiện có; code mới phải đạt rule. Không tắt rule toàn dự án hoặc chia file/hàm tùy tiện để đạt số dòng.

### Giai đoạn 3 — Nâng chất lượng test

Làm `test_settings_load` độc lập với cấu hình thật. Dùng thư mục tạm và dữ liệu mẫu; không đổi thư mục dữ liệu của app đang dùng. Kiểm tra mọi test có ghi file để bảo đảm cách ly.

Tách ba nhóm:

1. Test logic: không cần app, mạng hay thiết bị thật.
2. Test tích hợp: kiểm tra các thành phần phối hợp; giả lập API và cách ly lưu trữ.
3. Test môi trường thật: app Dev, microphone, system audio, quyền macOS và dịch vụ thật khi cần.

| Luồng ưu tiên | Kịch bản cần bảo vệ |
|---|---|
| Memo/autosave | Chuyển phiên trước khi lưu xong, mở lại app, ghi file thất bại, bản nháp rỗng có chủ ý |
| Template/ngôn ngữ | Chuyển qua lại giữ đúng bản nháp, dữ liệu cũ được chuyển đổi đúng |
| Start/Stop | Thao tác liên tiếp, dừng trong lúc kết nối, không đăng ký listener/stream trùng |
| Realtime | Mất mạng, timeout, giới hạn API, kết quả phiên cũ đến sau khi mở phiên mới |
| Transcript/biên bản | Thứ tự sự kiện, đoạn trùng, tạo biên bản thất bại, nội dung đầu vào được giữ đúng |
| Lưu/đọc/export | Mở dữ liệu cũ, file thiếu/hỏng, đường dẫn lỗi, không ghi đè ngoài ý muốn |

Test phải kiểm tra kết quả quan sát được và yêu cầu thực tế, không chỉ sao chép logic triển khai. Dùng đồng hồ có kiểm soát cho debounce/retry; không dựa vào sleep tùy tiện hoặc thứ tự chạy. Bộ dữ liệu mẫu không chứa dữ liệu cuộc họp riêng tư.

Bug fix phải có test thất bại trước khi sửa và chạy qua sau khi sửa. Với refactor thuần túy, test hành vi phải qua cả trước và sau. Hành vi đã biết là bug được ghi riêng, không coi là yêu cầu đúng.

Đo coverage để tìm khoảng trống, đặc biệt nhánh lỗi và tình huống biên. Chọn mục tiêu theo rủi ro sau khi có mốc đo; không đặt 100% toàn dự án. Có thể thử thay đổi sai có chủ đích trên một số logic quan trọng để kiểm tra test có bắt được lỗi, trước khi cân nhắc công cụ mutation testing.

### Giai đoạn 4 — Refactor an toàn

Thứ tự đề xuất sau audit:

1. Logic thuần nhỏ đang trộn trong `app.js`, để xác lập cách tách và kiểm tra.
2. Memo/template/autosave, sau khi có test bảo vệ lưu và chuyển ngữ cảnh.
3. Quản lý phiên và vòng đời Start/Stop.
4. Điều phối realtime và adapter provider.
5. Tạo biên bản, export và các phần giao diện còn lại.
6. Các module backend lớn, tách nghiệp vụ và truy cập lưu trữ theo kết quả audit.

Mỗi đợt: chọn một trách nhiệm → lập hợp đồng → bổ sung test → tách module → kiểm tra → review → test Dev → người dùng xác nhận → commit/merge.

`app.js` dần trở thành nơi khởi tạo và kết nối module. Tách theo trách nhiệm; không dùng `app-part1`, `app-part2` hoặc giữ toàn bộ phụ thuộc vào một object toàn cục.

Đọc `docs/ux-playbook.md` khi thay đổi hoặc review tương tác giao diện. Giữ trạng thái chọn, filter, focus và nội dung đang nhập. Nếu phát hiện bài học UX mới có thể tái sử dụng, cập nhật playbook cùng thay đổi.

### Giai đoạn 5 — Kiểm tra tự động

Tạo `npm run quality` sau khi thống nhất công cụ. Lệnh này kiểm tra, không tự format hoặc cài app:

- Lint JavaScript và kiểm tra định dạng.
- Test frontend.
- `cargo fmt --check` và Clippy cho các target/feature phù hợp.
- Test backend tự động, đã cách ly dữ liệu và môi trường.

Sau khi xử lý cảnh báo hoặc ghi ngoại lệ có phạm vi, bật chế độ Clippy chặn cảnh báo bằng `-D warnings`. Không bỏ qua lỗi công cụ hoặc mạng để báo quality thành công.

Workflow PR chạy kiểm tra trên môi trường sạch. Lập ma trận macOS/Windows theo target hỗ trợ; test audio/permission cần môi trường thật được chạy riêng và báo trạng thái rõ. Nếu muốn GitHub bắt buộc kiểm tra trước merge, cần cấu hình required status checks/ruleset; workflow đơn thuần chưa tạo ràng buộc này.

Build Dev và smoke test app là bước riêng, bắt buộc sau đợt thay đổi code theo `AGENTS.md`. Build thành công và test logic qua không thay thế bằng chứng thao tác trên app thật.

### Giai đoạn 6 — Tiêu chí hoàn tất và duy trì

Một thay đổi chỉ hoàn tất khi:

- [ ] Phạm vi rõ, không gộp thay đổi hành vi ngoài ý định.
- [ ] Code mới đạt rule; không tăng vi phạm cũ.
- [ ] Test liên quan và bộ kiểm tra phù hợp chạy qua; không có test bỏ qua mà không ghi lý do.
- [ ] Reviewer kiểm tra hợp đồng, phụ thuộc, vòng đời và nguy cơ mất dữ liệu.
- [ ] Build Dev, ký ổn định, verify, cài và mở app thành công.
- [ ] Luồng liên quan được kiểm tra trên Dev; ghi rõ phần chưa kiểm chứng.
- [ ] Người dùng xác nhận không còn vấn đề cần xử lý trước commit/merge.

Theo dõi: số vi phạm code mới, số ngoại lệ còn lại, các luồng quan trọng đã có test, coverage nhánh của phần thay đổi, test không ổn định, thời gian chạy quality và bug lọt qua kiểm tra. Đánh giá bằng mốc đo thực tế, không tự gán tỷ lệ hoàn thành hoặc độ an toàn.

## 4. Quy trình Git, Dev và hoàn tác

- Dùng nhánh `codex/` phù hợp trước khi thay đổi code; không sửa trực tiếp `main`.
- Giữ nguyên thay đổi chưa commit của người dùng; không tự stash, reset hoặc đưa thay đổi ngoài phạm vi vào commit.
- Sau mỗi đợt phát triển/sửa code, chạy `npm run build:dev`. Dùng `APP_SIGNING_IDENTITY` ổn định từ `.env`, verify chữ ký, cài và mở `/Applications/Meet Minder Dev.app`.
- Không dùng ad-hoc signing hoặc đổi chéo identity Dev/Release; giữ `/Applications/Meet Minder.app` cho cuộc họp chính thức.
- Nếu signing/build/cài đặt thất bại, báo blocker cùng bằng chứng; không dùng app chưa ký để thay thế.
- Chỉ commit và merge sau xác nhận của người dùng. Sau merge thành công mới push `main` theo quy định repo.
- Hoàn tác bằng thay đổi có phạm vi nhỏ và giữ dữ liệu người dùng. Nếu có thay đổi dữ liệu riêng, chuẩn bị bản sao và phương án tương thích trước khi triển khai.

## 5. Đợt triển khai đầu tiên

Đợt nền tảng hiện tại thiết lập coding rules, giới hạn file JavaScript, lệnh quality, test settings độc lập, test regression cho templates và workflow PR. Sau khi quality pass và Dev được kiểm chứng, bàn giao các thay đổi để người dùng review.

Đợt tiếp theo chạy audit đầy đủ, chọn một phần có rủi ro thấp trong `app.js`, viết test hành vi rồi mới refactor.

Tiếp tục theo module và luồng rủi ro. Mỗi đợt có phạm vi, tiêu chí nghiệm thu và ước lượng riêng dựa trên bằng chứng.

Chưa ấn định thời gian hoàn thành toàn bộ trước audit. Mỗi đợt phải có phạm vi, điều kiện nghiệm thu và ước lượng riêng dựa trên bằng chứng.

## 6. Tài liệu tham khảo

- [ESLint: max-lines](https://eslint.org/docs/latest/rules/max-lines)
- [ESLint: max-lines-per-function](https://eslint.org/docs/latest/rules/max-lines-per-function)
- [ESLint: complexity](https://eslint.org/docs/latest/rules/complexity)
- [ESLint: max-depth](https://eslint.org/docs/latest/rules/max-depth)
- [Clippy: usage và kiểm tra cảnh báo trong CI](https://doc.rust-lang.org/clippy/usage.html)
- [Node.js: test runner](https://nodejs.org/api/test.html)
- [Tauri: kiểm thử](https://v2.tauri.app/develop/tests/)
- [Rust API Guidelines: naming](https://rust-lang.github.io/api-guidelines/naming.html)

Khi triển khai, xác minh công cụ và API theo phiên bản thực tế của dự án. Tài liệu mới nhất có thể mô tả tính năng chưa có trong runtime đang dùng.
