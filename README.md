# chatPan

**Your Personal AI Universe** — ứng dụng trợ lý AI với giao diện tiếng Việt, nền đen và điểm nhấn vàng. Không có gói Pro, thanh toán hoặc hạn mức tin nhắn thương mại. Nhà cung cấp AI vẫn có thể tính phí và giới hạn API.

Đây là phiên bản cốt lõi hoạt động với PostgreSQL thật. **Chưa phải toàn bộ sản phẩm production theo master prompt**: kết nối Xingchi trực tiếp còn chờ Base URL và key mới, xem bảng xác minh bên dưới.

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
| `XINGCHI_BASE_URL`                    | Base URL API tương thích OpenAI đã được tài khoản Xingchi xác nhận; bao gồm tiền tố phiên bản nếu nhà cung cấp yêu cầu |
| `XINGCHI_API_KEY`                     | Bí mật chỉ ở server; lưu bằng secret/environment settings                                                              |
| `DEFAULT_CHAT_MODEL`                  | Model ưu tiên, phải có trong kết quả `/models` thực tế                                                                 |
| `DEFAULT_IMAGE_MODEL`                 | Model tạo ảnh; để trống nếu chưa được xác minh                                                                         |
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
- Image Studio có adapter `/images/generations`, lưu lịch sử, xem/tải/xóa ảnh thật. Hiện chỉ chấp nhận `b64_json`; không tự fetch URL tùy ý do provider trả về.
- Trang quản trị theo role: số user/hội thoại/request đã ghi nhận, nhóm model/thành công/thất bại streaming, thử danh sách model. Không hiện hội thoại riêng hoặc key.

Để cấp quyền quản trị cho tài khoản đã đăng ký, chạy với quyền quản trị database:

```bash
node scripts/admin.mjs your-email@example.com
```

## Kết quả xác minh và giới hạn

| Khả năng                                                                   | Bằng chứng / trạng thái                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Tài khoản, lưu trữ và tách biệt dữ liệu                                    | Playwright với PostgreSQL thật                                                        |
| Reset token hết hạn/dùng một lần/thu hồi session                           | Playwright với token được fixture tạo trực tiếp trong DB; **chưa thử gửi email thật** |
| Chat streaming, tạo lại, hủy, xử lý lỗi, khóa đồng thời                    | Integration test với PostgreSQL thật và **upstream mock rõ ràng**                     |
| Upload, validation, image re-encoding                                      | Unit + API E2E                                                                        |
| OCR tiếng Anh                                                              | Tesseract thật trên ảnh fixture, không phải test Vision                               |
| Xingchi `/models`, text, streaming, Vision, tool calling, image generation | **Chưa xác minh trực tiếp**: chờ Base URL và key mới                                  |
| Gửi SMTP / tiếng Việt OCR                                                  | Chưa có SMTP / chưa có traineddata tiếng Việt                                         |
| Production build / lint / TypeScript                                       | Có lệnh kiểm tra và CI; kết quả lần chạy được báo trong bàn giao                      |
| Vercel / phục hồi cloud task mới                                           | Có hướng dẫn, chưa triển khai hoặc kiểm thử môi trường mới                            |

Các phần chưa triển khai: web search trực tiếp (không có toggle giả), image editing, provider image URL tải từ xa, OCR PDF scan nhiều trang, tool execution, OAuth, dashboard quản trị đầy đủ (quản lý user, balance, audit lỗi chi tiết), streaming usage token, đổi model mặc định từ admin UI, tóm tắt context tự động, sửa tin nhắn tại chỗ và pagination trong UI. Nút bút ở tin nhắn hiện **dùng lại nội dung** để gửi mới, không sửa lịch sử. Backend trả 100 hội thoại gần nhất và 500 tin nhắn đầu; history gửi AI dùng tối đa 40 tin nhắn gần đây, 60.000 ký tự chat và 60.000 ký tự tài liệu; chưa có pagination hoặc tokenizer theo model.

Giới hạn vận hành: nội dung tài liệu được parse trong request có giới hạn kích thước, chưa có worker sandbox, antivirus hoặc bảo vệ hoàn chỉnh trước archive bomb. Không nên mở upload công khai ở quy mô lớn trước khi thêm worker/resource isolation. File/ảnh nằm trong PostgreSQL phù hợp quy mô nhỏ; cần object storage và chính sách retention/backup cho production lớn. Không bảo đảm giữ nguyên phản hồi cũ nếu yêu cầu regenerate bị lỗi; có thể tạo lại từ tin nhắn người dùng. Rate limit đăng nhập có bucket tổng thể để không tin header IP có thể bị giả mạo; nên thêm edge/WAF trước khi mở công khai.

Không gọi toàn bộ tính năng master prompt là đã hoàn thành hoặc đã sẵn sàng public production dựa trên test mock.

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
3. Cấu hình `APP_URL` đúng origin HTTPS, `AUTH_SECRET` ngẫu nhiên, các biến Xingchi đã xác minh và SMTP nếu cần. Giữ key trong secret settings.
4. Install: `npm ci`. Build: `npm run db:migrate && npm run build`. Script migration cần quyền DDL. Có thể chạy migration qua pipeline release riêng thay vì mỗi build; không dùng database production cho PR không tin cậy.
5. Deploy, kiểm thử đăng ký/đăng nhập, cookie Secure, upload và một cuộc trò chuyện thực tế. Chọn model có trong discovery, kiểm tra hạn mức tài khoản Xingchi.
6. Standard Vercel Functions không cung cấp Tesseract: để `OCR_ENABLED=false` hoặc triển khai riêng worker OCR trước khi bật. Chưa có adapter worker OCR trong bản này. Đặt giới hạn upload thấp hơn nếu gói hosting giới hạn request dưới 8 MB.
7. Kiểm tra thời gian streaming tối đa của gói hosting và giới hạn SMTP outbound; `maxDuration=120` là yêu cầu, không bảo đảm mọi gói đều cấp đủ.

Không deploy, tạo tài khoản dịch vụ hoặc xuất bản môi trường từ quá trình build local. Kiểm tra và Publish bản nháp môi trường trong sản phẩm sau khi bạn hoàn tất cấu hình cần thiết.
