# chatPan

**Your Personal AI Universe** — ứng dụng trợ lý AI với giao diện tiếng Việt, nền đen và điểm nhấn vàng. Không có gói Pro, thanh toán hoặc hạn mức tin nhắn thương mại. Nhà cung cấp AI vẫn có thể tính phí và giới hạn API.

Đây là phiên bản cốt lõi hoạt động với PostgreSQL thật. **Chưa phải toàn bộ sản phẩm production theo master prompt**: adapter OpenAI hỗ trợ Responses API và Chat Completions; kiểm thử live vẫn cần key và quyền mạng được áp dụng vào runtime, xem bảng xác minh bên dưới.

## Chạy trên máy phát triển

Cần Node.js 24, npm, Docker Compose (hoặc PostgreSQL 17 riêng). Tùy chọn OCR: Tesseract 5 và gói ngôn ngữ.

```bash
npm ci
node scripts/local-env.mjs # Giữ file hiện có, tạo AUTH_SECRET cục bộ nếu còn trống.
docker compose up -d db
npm run db:generate
npm run db:migrate
npm run dev
```

Ứng dụng dùng cổng 3000. `APP_URL` phải khớp chính xác origin của trình duyệt để kiểm tra CSRF, ví dụ `http://localhost:3000` khi chạy cục bộ. Dùng HTTPS và `APP_URL=https://...` trong production để cookie có thuộc tính Secure.

Mỗi cloud task đã được cô lập: dùng checkout hiện có, không tự tạo Git worktree. Trong máy onboarding hiện tại PostgreSQL chạy trong container `chatpan-db`; dùng `docker start chatpan-db` thay vì tạo container thứ hai chiếm cổng 5432. Docker Compose dành cho bản clone mới.

Không dùng mật khẩu PostgreSQL ví dụ cho production. Dữ liệu phát triển được giữ trong database/container; không coi Docker volume là bản sao lưu hoặc bằng chứng phục hồi trong cloud task mới.

## Cấu hình

| Biến                                  | Mục đích                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                        | PostgreSQL, bắt buộc cho tài khoản, hội thoại, file và rate limiting                                                   |
| `APP_URL`                             | Origin chính xác, bắt buộc khi triển khai; HTTPS bật cookie Secure                                                     |
| `OPENAI_BASE_URL`                    | Mặc định `https://api.openai.com/v1`; không cần đặt khi dùng OpenAI trực tiếp |
| `OPENAI_API_KEY`                     | Bí mật chỉ ở server; lưu bằng secret/environment settings                                                              |
| `OPENAI_WIRE_API`                    | `responses` (mặc định) hoặc `chat_completions`; không tự đổi endpoint khi bị từ chối quyền                             |
| `OPENAI_MODEL_WIRE_API`              | JSON map ghi đè giao thức cho từng model, ví dụ `{"legacy-model":"chat_completions"}`                                  |
| `DEFAULT_CHAT_MODEL`                  | `gpt-4.1` mặc định; model phải có trong `/models` và vượt qua kiểm tra inference trước khi chọn                    |
| `DEFAULT_IMAGE_MODEL`                 | Mặc định `gpt-image-1` với key OpenAI; cần quyền tạo ảnh và hạn mức API                                                                         |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` | Email xác minh/đặt lại mật khẩu; yêu cầu TLS                                                                           |
| `SMTP_USER`, `SMTP_PASSWORD`          | Thông tin SMTP nếu server yêu cầu xác thực                                                                             |
| `OCR_ENABLED`                         | `true` để dùng Tesseract cục bộ, mặc định `false`                                                                      |
| `OCR_LANG`                            | Mặc định `eng`; `vie+eng` cần cài thêm traineddata tiếng Việt                                                          |

Không có `NEXT_PUBLIC_*` chứa key. Không dán key trong source, issue, chat hoặc commit. Key đã công khai phải được thu hồi và thay mới. Cấu hình Codex `model_provider`/`review_model` không cấu hình provider của ứng dụng này.

Cookie phiên được mã hóa/xác thực bằng thư viện iron-session; session là token ngẫu nhiên 256 bit; database chỉ lưu SHA-256 của token. `AUTH_SECRET` (ít nhất 32 ký tự ngẫu nhiên) bảo vệ cookie bằng iron-session; đặt trong secret settings. Mật khẩu được hash bcrypt với cost 12; session có thời hạn 12 giờ hoặc 30 ngày. Reset token hết hạn sau 1 giờ, dùng một lần, và thu hồi toàn bộ session sau đổi mật khẩu. Đăng nhập email/password dùng bcrypt và session iron-session kết hợp PostgreSQL; chưa có OAuth.

Đăng ký không tự gửi email. Người dùng chọn **Gửi email xác minh** trong cài đặt. Chưa xác minh không khóa tài khoản. Reset password chỉ gửi liên kết khi SMTP đã cấu hình; không có token giả hoặc liên kết reset bị ghi ra console.

## Đã triển khai

- Đăng ký, đăng nhập/đăng xuất, nhớ phiên, xác minh email và reset qua SMTP, hồ sơ, chỉ dẫn cho trợ lý, xóa tài khoản.
- Tách biệt dữ liệu theo chủ sở hữu ở mọi API. Origin checking, cookie HttpOnly/SameSite, rate limiting dùng PostgreSQL, Zod, giới hạn request/file, không ghi key hoặc lỗi thô của provider.
- Hội thoại PostgreSQL: tạo, đổi tên, ghim, tìm theo tiêu đề trong UI (API cũng tìm nội dung), thư mục, xóa, xuất JSON hội thoại đang mở.
- Adapter OpenAI-compatible trên server: model discovery, chat streaming, context gần đây, hủy, tạo lại và lưu phản hồi. Lease PostgreSQL ngăn hai request đồng thời cho cùng hội thoại. Dữ liệu provider lỗi không bị thay bằng câu trả lời giả.
- Markdown, code highlighting, bảng, KaTeX; giao diện responsive, sidebar thu gọn/drawer mobile, theme được lưu, dialog có focus trap và Escape.
- Upload riêng tư: JPEG/PNG/WebP được giải mã và re-encode; PDF/DOCX/TXT/CSV/XLSX được trích xuất nội dung. Tệp gốc được lưu trong database và chỉ chủ sở hữu tải được. Tối đa 8 MB/tệp, 4 tệp/tin nhắn, 25 triệu pixel/ảnh; ảnh được resize tối đa 2048px. Library cho xem danh sách và xóa.
- OCR cục bộ là lựa chọn riêng, chỉ trích xuất chữ. Vision gửi ảnh qua `image_url`; khả năng hiểu ảnh phụ thuộc model thực tế. Dữ liệu OCR không được quảng cáo là hiểu toàn bộ hình ảnh.
- Chat và Image Studio dùng `/images/generations`, lưu lịch sử, xem/tải/xóa ảnh thật. Chat tự nhận yêu cầu trực tiếp như “tạo ảnh wukong 3D đẹp”, hoặc bật nút **Tạo ảnh** để nhập mô tả tự do. Hiện chỉ chấp nhận `b64_json`; không tự fetch URL tùy ý do provider trả về.
- Trang quản trị theo role: số user/hội thoại/request đã ghi nhận, nhóm model/thành công/thất bại streaming, thử danh sách model. Không hiện hội thoại riêng hoặc key.

Để cấp quyền quản trị cho tài khoản đã đăng ký, chạy với quyền quản trị database:

```bash
node scripts/admin.mjs your-email@example.com
```

## Kết quả xác minh và giới hạn

| Khả năng                                                                   | Bằng chứng / trạng thái                                                                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tài khoản, lưu trữ và tách biệt dữ liệu                                    | Playwright với PostgreSQL thật                                                                                                                   |
| Reset token hết hạn/dùng một lần/thu hồi session                           | Playwright với token được fixture tạo trực tiếp trong DB; **chưa thử gửi email thật**                                                            |
| Chat streaming, tạo lại, hủy, xử lý lỗi, khóa đồng thời                    | Integration test với PostgreSQL thật và **upstream mock rõ ràng**                                                                                |
| Upload, validation, image re-encoding                                      | Unit + API E2E                                                                                                                                   |
| OCR tiếng Anh                                                              | Tesseract thật trên ảnh fixture, không phải test Vision                                                                                          |
| OpenAI `/models`, text, streaming, Vision, tool calling, image generation | **Chưa xác minh trực tiếp trong runtime hiện tại**: Base URL mặc định `https://api.openai.com/v1`; cần key và chính sách mạng có hiệu lực |
| Gửi SMTP / tiếng Việt OCR                                                  | Chưa có SMTP / chưa có traineddata tiếng Việt                                                                                                    |
| Production build / lint / TypeScript                                       | Có lệnh kiểm tra và CI; kết quả lần chạy được báo trong bàn giao                                                                                 |
| Vercel / phục hồi cloud task mới                                           | Có hướng dẫn, chưa triển khai hoặc kiểm thử môi trường mới                                                                                       |

Các phần chưa triển khai: web search trực tiếp (không có toggle giả), image editing, provider image URL tải từ xa, OCR PDF scan nhiều trang, tool execution, OAuth, dashboard quản trị đầy đủ (quản lý user, balance, audit lỗi chi tiết), streaming usage token, đổi model mặc định từ admin UI, tóm tắt context tự động, sửa tin nhắn tại chỗ và pagination trong UI. Nút bút ở tin nhắn hiện **dùng lại nội dung** để gửi mới, không sửa lịch sử. Backend trả 100 hội thoại gần nhất và 500 tin nhắn đầu; history gửi AI dùng tối đa 40 tin nhắn gần đây, 60.000 ký tự chat và 60.000 ký tự tài liệu; chưa có pagination hoặc tokenizer theo model.

Giới hạn vận hành: nội dung tài liệu được parse trong request có giới hạn kích thước, chưa có worker sandbox, antivirus hoặc bảo vệ hoàn chỉnh trước archive bomb. Không nên mở upload công khai ở quy mô lớn trước khi thêm worker/resource isolation. File/ảnh nằm trong PostgreSQL phù hợp quy mô nhỏ; cần object storage và chính sách retention/backup cho production lớn. Regenerate giữ phản hồi cũ nếu request bị từ chối hoặc luồng mới thất bại; chỉ thay phản hồi cũ khi lần tạo lại hoàn tất. Rate limit đăng nhập có bucket tổng thể để không tin header IP có thể bị giả mạo; nên thêm edge/WAF trước khi mở công khai.

Không gọi toàn bộ tính năng master prompt là đã hoàn thành hoặc đã sẵn sàng public production dựa trên test mock.

## OpenAI Responses API

Cấu hình OpenAI trực tiếp (key phải có quyền sử dụng model):

```ini
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_WIRE_API=responses
DEFAULT_CHAT_MODEL=gpt-4.1
OPENAI_MODEL_WIRE_API={}
```

Key chỉ nằm trong `OPENAI_API_KEY` phía server; cloud dành riêng tên này nên dùng alias `CHATPAN_OPENAI_API_KEY`. Alias được ưu tiên nếu có. Khi có key OpenAI, ứng dụng mặc định gọi `https://api.openai.com/v1` và không kế thừa base URL Xingchi cũ. Các biến `XINGCHI_*` chỉ còn là tương thích cho cấu hình cũ khi chưa có key OpenAI. Không có header sao chép từ ứng dụng khác; adapter chỉ gửi Bearer Authorization và Content-Type. Nếu có model cũ yêu cầu Chat Completions, đặt JSON map ở server, ví dụ `OPENAI_MODEL_WIRE_API={"legacy-model":"chat_completions"}`. Không suy đoán giao thức từ tên model, không tự chuyển endpoint sau lỗi 401/403 và không tự retry POST có thể tính phí.

`POST /responses` nhận `instructions` từ chỉ dẫn system và `input` từ toàn bộ context đã chọn ở PostgreSQL. Tin nhắn user dùng `input_text`/`input_image`; lịch sử assistant dùng easy-input message dạng text. `store:false` và không có `previous_response_id`: hội thoại không phụ thuộc trạng thái ở provider. Event parser chỉ hiển thị `response.output_text.delta`; không đưa reasoning hoặc tool arguments lên UI. Luồng chỉ thành công khi có `response.completed`, còn `response.failed`, `response.incomplete`, error/refusal và luồng bị cắt được báo riêng. Hủy chat ngắt upstream và giải phóng lease PostgreSQL.

Catalog `/models` chỉ xác nhận model có tên trong danh sách. Trước khi UI chọn model mặc định hoặc đổi model, `POST /api/models/validate` (cần đăng nhập) thực hiện một probe văn bản ngắn tối đa 256 output tokens bằng đúng giao thức. **Probe có thể được nhà cung cấp tính phí**. Kết quả thành công được cache 5 phút theo base URL, credential, model và giao thức; không cache lỗi. Kiểm tra này không chứng minh model hỗ trợ Vision hoặc tạo ảnh. Chat vẫn kiểm tra lại catalog và quyền thực tế qua request upstream.

Lỗi trước khi stream trả JSON an toàn gồm `code`, `providerStatus` và `protocol`; ví dụ app HTTP 502 + `providerStatus:403` nghĩa là provider từ chối quyền, không phải phiên đăng nhập của chatPan. Lỗi sau khi stream bắt đầu được gửi trong NDJSON với `error` và kết thúc bằng `done:true, success:false`. Nội dung lỗi gốc của provider và key không được chuyển ra frontend hoặc console.

Để kiểm chứng thật sau khi cấu hình **đã đến runtime**, chạy:

```bash
npm run test:provider:live
```

Lệnh này gọi catalog và gửi một Responses request thật tới `gpt-4.1`, không mock và có thể tính phí. Kết quả unit/integration mock không thay thế kiểm chứng live. Trong cloud network bị hạn chế, phải cho phép đúng hostname `api.openai.com`; lưu draft/Publish chưa tự chứng minh instance đang chạy đã nhận cấu hình mới.

## Tạo ảnh ngay trong chat bằng OpenAI

Trên hosting (ví dụ Vercel), cấu hình `OPENAI_API_KEY` ở server. Trong managed cloud, tên `OPENAI_API_KEY` được nền tảng dành riêng: khai báo secret `CHATPAN_OPENAI_API_KEY`, chỉ gửi đến `api.openai.com`. Đặt `DEFAULT_IMAGE_MODEL=gpt-image-1` (cũng là mặc định khi có key OpenAI); có thể đổi sang model GPT Image khác mà project được phép dùng. Model ảnh độc lập với model chat. GPT Image trả base64 mặc định, không gửi tham số `response_format` không được hỗ trợ.

Gõ “tạo ảnh wukong 3D đẹp” hoặc bật **Tạo ảnh**, nhập mô tả và gửi. Ảnh được lưu cùng cặp tin nhắn trong PostgreSQL, hiện trong chat sau khi hoàn tất, có liên kết tải và xuất hiện ở Image Studio. Tạo lại ảnh giữ phản hồi cũ nếu upstream lỗi. Hiện hỗ trợ text-to-image, chưa hỗ trợ chỉnh sửa ảnh đính kèm. Lỗi key/quyền/hạn mức được báo rõ, không thay bằng ảnh giả hoặc chỉ trả prompt.

Kiểm thử tạo ảnh thật, có thể tính phí API (cần key, quyền model và mạng đã áp dụng vào runtime):

```bash
npm run test:image:live
```

Unit/integration của luồng ảnh dùng upstream mock rõ ràng và PostgreSQL thật; E2E kiểm tra ảnh fixture, tải xuống, căn tin nhắn và focus ô nhập trên desktop/mobile. Những kiểm tra này không chứng minh quyền tạo ảnh trên tài khoản OpenAI thật.

## Kiểm thử

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
# Sau build, có thể chạy cùng E2E trên server production:
E2E_PRODUCTION=true npm run test:e2e
npm audit --omit=dev
```

Unit/integration cần PostgreSQL test và Tesseract cho bài OCR. Các bài integration tự tạo và xóa tài khoản fixture; chỉ chạy trên database phát triển/test. Playwright cục bộ dùng `/usr/bin/chromium`; trong CI dùng Chromium cài qua `npx playwright install --with-deps chromium`. Các bài chat mock không tạo chi phí API.

Prisma 7 dùng JS driver adapter `pg`. Các script `db:generate`/`db:migrate` dùng generator và WASM schema engine chính thức từ npm để tránh tải native engine trên máy có network restrictions. Chúng phụ thuộc API nội bộ đã khóa phiên bản; khi nâng Prisma cần nâng đồng bộ package, kiểm thử migration mới và migration lặp lại. Integrity từ lockfile và TLS vẫn được giữ nguyên; không tắt kiểm tra checksum hoặc TLS.

## Triển khai Vercel

1. Import repository vào Vercel, chọn Next.js và Node.js 24.
2. Tạo PostgreSQL có TLS, cấu hình `DATABASE_URL` riêng cho production (và database riêng cho preview).
3. Cấu hình `APP_URL` đúng origin HTTPS, `AUTH_SECRET` ngẫu nhiên, các biến OpenAI đã xác minh và SMTP nếu cần. Giữ key trong secret settings.
4. Install: `npm ci`. Build: `npm run db:migrate && npm run build`. Script migration cần quyền DDL. Có thể chạy migration qua pipeline release riêng thay vì mỗi build; không dùng database production cho PR không tin cậy.
5. Deploy, kiểm thử đăng ký/đăng nhập, cookie Secure, upload và một cuộc trò chuyện thực tế. Chọn model có trong discovery, kiểm tra hạn mức tài khoản OpenAI.
6. Standard Vercel Functions không cung cấp Tesseract: để `OCR_ENABLED=false` hoặc triển khai riêng worker OCR trước khi bật. Chưa có adapter worker OCR trong bản này. Đặt giới hạn upload thấp hơn nếu gói hosting giới hạn request dưới 8 MB.
7. Kiểm tra thời gian streaming tối đa của gói hosting và giới hạn SMTP outbound; `maxDuration=300` là yêu cầu, không bảo đảm mọi gói đều cấp đủ.

Không deploy, tạo tài khoản dịch vụ hoặc xuất bản môi trường từ quá trình build local. Kiểm tra và Publish bản nháp môi trường trong sản phẩm sau khi bạn hoàn tất cấu hình cần thiết.
