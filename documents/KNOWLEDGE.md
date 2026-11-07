# KNOWLEDGE: Kiến thức học được từ API Gateway

> File theo dõi kiến thức để ôn phỏng vấn. Cập nhật sau mỗi bước trong [PLAN.md](./PLAN.md).
> Luyện trả lời: [INTERVIEW-QUESTIONS.md](./INTERVIEW-QUESTIONS.md) (ngân hàng câu hỏi, có ý chính để tự đối chiếu).
> Bản trực quan: mở `knowledge.html` trong trình duyệt. Sau khi sửa file markdown, chạy `npm run docs:knowledge` (trong `apps/api-gateway`) để sinh lại.
> Quy ước trạng thái: ✅ đã học và đã làm · 📖 đã học lý thuyết, chưa code · ⬜ chưa học

## Cách dùng file này

1. Sau mỗi bước build, điền mục **"Tự trả lời"** bằng lời của bạn (3-5 dòng). Đó là câu trả lời phỏng vấn thật.
2. Đổi trạng thái trong bảng tiến độ.
3. Ghi lại cái bẫy hoặc lỗi đã gặp ở mục **"Bẫy thực tế"**. Phỏng vấn viên rất thích nghe chuyện này.

---

## Bảng tiến độ

| # | Chủ đề | Bước PLAN | Trạng thái |
|---|---|---|---|
| 0 | **Giới thiệu dự án trong 2 phút** | - | 📖 (tự viết) |
| 1 | API Gateway là gì | - | ✅ |
| 2 | Control plane và Data plane | 1, 2 | ✅ (hot reload / atomic swap: chưa làm) |
| 3 | Contract-first với OpenAPI | 1 | ✅ |
| 4 | Routing: segment trie / radix tree | 1 | ✅ |
| 5 | Fail-fast và validate cấu hình | 1 | ✅ |
| 6 | Protocol translation (HTTP → RPC) và reverse proxy | 2 | ✅ |
| 7 | Service discovery | 2, 7 | ✅ (RegistryDiscovery; StaticDiscovery đã gỡ) |
| 8 | Caching, TTL, stale-on-error | 7 | ✅ đồng bộ snapshot + ETag |
| 9 | Load balancing | 3 | ✅ round-robin + failover |
| 10 | Authentication / Authorization | 4 | ⬜ |
| 11 | Rate limiting | 4 | ⬜ |
| 12 | Request validation | 4 | ⬜ |
| 13 | Observability | 5 | ⬜ |
| 14 | Resilience: timeout, retry, circuit breaker | 3, 5 | 📖 (timeout + failover an toàn: ✅) |
| 15 | Đóng gói và triển khai | 6 | ⬜ |
| 16 | Service registry (heartbeat, TTL, CAP) | 7 | ✅ (chi tiết: knowledge của service-discovery) |
| 17 | Gateway trade-offs và so sánh sản phẩm | tổng kết | 📖 |
| 18 | Mẫu kiến trúc quanh gateway (BFF, aggregation, Strangler Fig) | - | 📖 |
| 19 | Nền tảng HTTP cho gateway | 2 | ✅ |
| 20 | Node.js trong vai trò gateway | 2 | 📖 |
| 21 | Bảo mật ngoài auth | 2, 4 | 📖 (body limit, allowlist: ✅) |
| 22 | Ranh giới với event-driven (RabbitMQ) | - | 📖 |
| 23 | NestJS microservices | 2 | ✅ |
| 24 | API versioning | - | 📖 (quyết định: không làm ở gateway) |
| 25 | Chiến lược test | 1, 2 | ✅ |
| 26 | Nguyên lý thiết kế đã dùng trong code | 1, 2 | ✅ |
| 27 | Idempotency và `Idempotency-Key` | 2 | ✅ phía gateway (chuyển mã); 📖 phía service |
| 28 | Đường đi của response: service → gateway → client | 2, 3 | ✅ |

---

## 0. Giới thiệu dự án trong 2 phút

Câu mở đầu gần như chắc chắn: *"Kể về một dự án bạn đã làm"*. Khung trả lời (bạn tự viết lại bằng lời mình, nói thử thành tiếng, canh 2 phút):

1. **Bối cảnh (15s):** Hệ thống microservices quản lý dự án; mỗi project có bộ API riêng; muốn một gateway dùng lại được, chỉ cần đổi file OpenAPI.
2. **Thiết kế cốt lõi (45s):**
   - Contract-first: file OpenAPI là nguồn sự thật; `operationId` bắt buộc và chính là `@MessagePattern` của service.
   - Gateway **dịch HTTP sang RPC qua TCP**, không phải reverse proxy.
   - Tìm service theo **pattern** qua service discovery (service tự khai báo pattern khi đăng ký), không theo tên.
   - Tách **control plane** (đọc spec, dựng route trie, fail-fast lúc khởi động) và **data plane** (mỗi request chỉ tra bộ nhớ).
3. **Điểm kỹ thuật đáng kể (40s):** chọn 2 trong số:
   - Route trie có backtrack theo method để phân biệt đúng 404/405.
   - Phân loại 4 loại lỗi qua TCP (timeout/connection/no-handler/remote) và chuẩn hoá về RFC 9457.
   - Bẫy client TCP cache kết nối thất bại, phải bỏ khỏi pool.
4. **Kết quả + đánh đổi (20s):** chạy end-to-end, có unit/integration/e2e test; đánh đổi đã chấp nhận (không kiểm tra được lúc khởi động pattern chưa có service; hợp đồng copy ở từng service).

**Tự viết:**
> _(viết bài 2 phút của bạn ở đây)_

---

## 1. API Gateway là gì

**Tóm tắt:** Điểm vào duy nhất của hệ thống, đứng giữa client và các service. Là reverse proxy **có hiểu API** (biết route, auth, service đích).

**Vì sao cần:**
- Client không cần biết có bao nhiêu service và ở địa chỉ nào.
- Các việc chung (auth, rate limit, logging) làm một lần ở gateway.
- Đổi hoặc tách service mà không ảnh hưởng client.

**Không nên làm:** đặt business logic ở gateway. Gateway "béo" thành monolith ở cửa trước và là single point of failure.

**Gateway khác Nginx thuần ở đâu:** Nginx route theo cấu hình tĩnh ở tầng HTTP. Gateway này route theo hợp đồng API (OpenAPI) và áp policy theo từng operation.

**Câu hỏi phỏng vấn**
- API Gateway khác reverse proxy và load balancer thế nào?
- Gateway có những trách nhiệm nào? Cái gì không nên đặt ở đó?
- Gateway là single point of failure, giải quyết ra sao? (chạy nhiều instance sau load balancer, stateless, health check)

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 2. Control plane và Data plane

**Tóm tắt:**

| | Control plane | Data plane |
|---|---|---|
| Trả lời câu hỏi | "Luật là gì?" | "Áp luật này cho request này thế nào?" |
| Tần suất | Hiếm (khởi động, spec đổi) | Mỗi request |
| Ưu tiên | Đúng, báo lỗi rõ | Nhanh, ổn định |
| Trong gateway này | `loadConfig`, `loadSpec`, `RouteTable.from`, `RegistryDiscovery.start` (gom trong `bootstrap.ts`) | `GatewayController` catch-all → `GatewayHandler.handle`: match → resolve → TCP send → map lỗi |

**Ý chính:**
- Việc nặng (parse yml, validate, build trie) làm **một lần** ở control plane. Data plane chỉ **đọc** bộ nhớ.
- **Atomic swap:** khi spec đổi, dựng bảng route mới riêng, hợp lệ mới hoán đổi con trỏ. Request đang xử lý dùng bảng cũ, request mới dùng bảng mới. Spec mới lỗi thì giữ bảng cũ.
- Control plane chết thì data plane vẫn chạy bằng cấu hình đã nạp.
- Ví dụ ngoài đời: Kubernetes (API server vs kubelet/kube-proxy), Istio (`istiod` vs Envoy), router mạng (BGP vs chuyển tiếp gói tin).
- Service discovery cũng theo nguyên tắc này: gateway giữ cache trong RAM, đồng bộ ở nền, request không gọi registry trực tiếp.

**Câu hỏi phỏng vấn**
- Control plane và data plane khác nhau thế nào? Vì sao tách?
- Cập nhật cấu hình không downtime bằng cách nào? (atomic swap)
- Control plane chết thì hệ thống ra sao?

**Mẫu trả lời ngắn:**
> Control plane quyết định cấu hình và chính sách, chạy hiếm, ưu tiên đúng đắn. Data plane thực thi cấu hình trên từng request nên phải nhanh và không phụ thuộc control plane theo thời gian thực. Tách ra giúp tối ưu hiệu năng, cập nhật không gián đoạn, và data plane vẫn chạy khi control plane gặp sự cố.

**Tự trả lời:**
> _(viết bằng lời của bạn)_

**Bẫy thực tế:**
> _(ghi lại khi làm)_

---

## 3. Contract-first với OpenAPI

**Tóm tắt:** File OpenAPI là nguồn sự thật duy nhất về **API mà client thấy**. Gateway sinh route và (về sau) policy từ file đó, nên project mới chỉ cần cung cấp một file spec.

**Quy ước trong dự án:**
- `operationId` **bắt buộc**, là string tự do: không rỗng, không trùng, không có khoảng trắng đầu/cuối.
- `operationId` chính là `@MessagePattern` của service, phải khớp **chính xác**.
- Spec **không** nói service nào xử lý. Service tự khai báo các pattern của mình khi đăng ký vào registry; gateway hỏi registry "ai xử lý pattern này?". Spec mô tả **cái gì**, registry biết **ai** và **ở đâu**.
- Dùng các **vendor extension** (`x-...`) cho cấu hình riêng như `x-rate-limit`, `x-timeout`.

**Contract-first vs code-first:**
- Contract-first: viết spec trước, code theo spec. Spec là hợp đồng giữa các team, sinh được tài liệu, mock, client SDK.
- Code-first: sinh spec từ code. Nhanh lúc đầu, nhưng spec dễ lệch với thực tế.

**Vì sao `operationId` được chọn làm khoá:** nó là định danh duy nhất, ổn định của một operation, không đổi khi đổi URL. Đổi `/users/{id}` thành `/v2/users/{id}` thì operation vẫn là `user.getById`.

**Cấu hình theo project:** một instance gateway phục vụ một project, chọn bằng env `GATEWAY_PROJECT` (spec nằm ở `specs/<project>/openapi.yml`). Cô lập lỗi và tải giữa các project; đánh đổi là nhiều process hơn so với kiểu multi-tenant một process. Tên project phải được validate để chặn **path traversal**. Registry tra pattern **trong phạm vi project** để hai project trùng tên pattern không lẫn nhau.

**Câu hỏi phỏng vấn**
- Multi-tenancy: một instance phục vụ nhiều tenant hay mỗi tenant một instance? Đánh đổi?
- Path traversal là gì, chặn thế nào khi đường dẫn file lấy từ biến môi trường?
- Contract-first khác code-first thế nào? Ưu nhược điểm?
- OpenAPI dùng để làm gì ngoài tài liệu? (validate, mock, sinh code, cấu hình gateway)
- `operationId` có ý nghĩa gì trong OpenAPI?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 4. Routing: segment trie / radix tree

**Tóm tắt:** Bảng route được lưu dưới dạng cây, mỗi segment của path là một node. `{id}` là node tham số.

```
/users            → node "users"
/users/me         → node "users" → "me"          (tĩnh)
/users/{id}       → node "users" → {param}       (tham số)
/users/{id}/orders
```

**Quy tắc quan trọng:**
- Segment **tĩnh được ưu tiên** trước tham số (`/users/me` thắng `/users/{id}`), có backtrack nếu nhánh tĩnh không dẫn tới route.
- Tên tham số lưu ở **lá**, nên `/users/{id}` và `/users/{userId}/orders` cùng tồn tại.
- Mỗi lá có map `method → route`, phân biệt được **404** (không có path) với **405** (có path, sai method, kèm `Allow`).
- Độ phức tạp match là O(số segment), không phụ thuộc số route. Duyệt tuyến tính qua mảng route là O(số route).

**Câu hỏi phỏng vấn**
- Bạn match URL với hàng nghìn route thế nào cho nhanh?
- `/users/me` và `/users/{id}` xung đột, xử lý ra sao?
- 404 và 405 khác nhau chỗ nào?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

**Trong code:** `src/gateway/route-table.ts`.

**Bẫy thực tế (gặp khi làm Bước 1):**
- **Backtrack phải tính cả method.** `/users/me` chỉ có GET, `/users/{id}` có DELETE. Nếu dừng ở node tĩnh đầu tiên khớp path thì `DELETE /users/me` bị trả 405 sai. Cách làm: liệt kê các ứng viên khớp path theo thứ tự ưu tiên (generator `walk`), lấy ứng viên đầu tiên có method; nếu không ứng viên nào có thì 405, với `Allow` là hợp của mọi method.
- **Decode tham số SAU khi match.** Decode trước thì `/files/a%2Fb.txt` biến thành `/files/a/b.txt` (3 segment) và không khớp `/files/{name}` nữa.
- **Percent-encoding hỏng** (`%E0%A4%A`) làm `decodeURIComponent` ném lỗi. Phải bắt lỗi và trả 400, không để gateway crash.
- **Tham số rỗng:** `/users//orders` không được khớp `/users/{id}/orders` với `id = ""`.
- **Hai route chỉ khác tên tham số** (`/items/{id}` và `/items/{itemId}` cùng GET) không thể phân biệt khi match. Bắt ở control plane bằng "hình dạng" path (`/items/{}`).

---

## 5. Fail-fast và validate cấu hình

**Tóm tắt:** Phát hiện lỗi cấu hình **lúc khởi động**, không để người dùng gặp lỗi lúc runtime.

**Trong dự án:** gateway từ chối khởi động (exit 1, chưa mở cổng) khi: spec không hợp lệ OpenAPI; `operationId` thiếu, rỗng, có khoảng trắng đầu/cuối, hoặc trùng; hai route chỉ khác tên tham số; env sai (project không tồn tại, số không hợp lệ, thiếu hoặc sai `GATEWAY_REGISTRY_URL`). Registry chết lúc khởi động thì **không** fail (AP): mở cổng, trả 503 tới khi đồng bộ được. Gom **tất cả** lỗi rồi báo một lần để sửa một lượt.

**Hot-reload:** spec mới lỗi thì giữ cấu hình cũ và ghi log, không làm sập hệ thống đang chạy.

**Trong code:** `src/gateway/config.ts` (env + path traversal), `src/gateway/spec-loader.ts` (luật spec), `src/gateway/errors.ts`.
- `SpecValidationError.issues` chứa mọi lỗi; ví dụ thật:
  ```
  Invalid OpenAPI spec ".../broken/openapi.yml" (3 issue(s)):
    - GET /a: missing operationId (required by the gateway).
    - GET /b: operationId must not be empty.
    - POST /c: duplicate operationId "shared.op" (already used by GET /c).
  ```
- Hai tầng kiểm tra: **luật OpenAPI** (swagger-parser) rồi **luật riêng của gateway** (operationId bắt buộc, không rỗng, không trùng, route không mơ hồ). swagger-parser **không** bắt operationId trùng, nên gateway phải tự bắt.
- **Path traversal** chặn hai lớp: regex tên project `[a-z0-9_-]+`, rồi kiểm tra đường dẫn sau `resolve` vẫn nằm trong `GATEWAY_SPECS_DIR` (defense in depth).
- Hàm nhận `env`, `cwd` làm tham số thay vì đọc thẳng `process.env`: dễ test, không phụ thuộc trạng thái toàn cục.

**Bẫy thực tế:**
- TypeScript 6 bắt buộc khai báo `rootDir` (lỗi `TS5011`).
- NestJS 12 và `json-schema-ref-parser` là **ESM-only**. Node 22 chạy bình thường, nhưng **Jest** chỉ load ESM từ CommonJS khi chạy trên Node ≥ 24.9.

**Câu hỏi phỏng vấn**
- Fail-fast là gì? Khi nào nên fail-fast, khi nào nên chịu lỗi (graceful degradation)?
- Cấu hình sai ở production thì cơ chế nào bảo vệ hệ thống?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 6. Protocol translation (HTTP → RPC) và reverse proxy

**Tóm tắt:** Gateway có hai cách chuyển request xuống service:

| | Reverse proxy | Protocol translation (dự án này) |
|---|---|---|
| Gateway gửi xuống | Nguyên HTTP request | Message `send(pattern, payload)` qua TCP |
| Service mở | API HTTP | `@MessagePattern('user.getById')` |
| Path, header | Truyền nguyên (cần xử lý hop-by-hop, `X-Forwarded-*`) | Chỉ tồn tại ở gateway; gateway tự dựng payload |
| Ưu | Đơn giản, phổ biến, stream được file lớn | Service gọn (không cần HTTP), hợp đồng payload thống nhất, gateway kiểm soát dữ liệu đi xuống |
| Nhược | Service phải tự lo HTTP | Gateway phải đóng gói/giải gói; khó stream file lớn; gắn chặt vào framework RPC (NestJS) |

**Những điểm kỹ thuật cần nắm (dự án này):**
- **Payload allowlist:** gateway dựng `GatewayRequest { params, query, body, user, meta }` từ đầu, không chuyển nguyên header. Client không giả được `user`.
- **Status thành công lấy từ spec** (mã 2xx nhỏ nhất trong `responses`, mặc định 200), vì message RPC không có khái niệm HTTP status.
- **Lỗi nghiệp vụ:** service ném `RpcException({ statusCode, message })`, gateway dịch sang HTTP (RFC 9457 `problem+json`).
- **Connection pool:** giữ một kết nối TCP cho mỗi `host:port`, tái sử dụng; đóng khi instance biến mất khỏi registry.
- **Timeout:** RPC phải có timeout, nếu không request treo vĩnh viễn khi service im lặng.
- **Mã lỗi gateway tự trả:** 404, 405, 502 (không kết nối được), 503 (không có instance), 504 (quá timeout).

**RPC vs messaging (hay bị hỏi):**
- **RPC** (TCP/gRPC): gọi và **chờ kết quả**, giống gọi hàm từ xa. Dùng cho request của client cần câu trả lời ngay.
- **Messaging / event** (RabbitMQ): gửi rồi **không chờ**, nhiều bên có thể nghe. Dùng cho thông báo "điều gì đó đã xảy ra" giữa các service.
- Dự án này dùng cả hai: TCP RPC giữa gateway và service, RabbitMQ cho event giữa các service.

**Kiến thức reverse proxy vẫn nên biết** (vì hay bị hỏi): hop-by-hop headers (`Connection`, `Keep-Alive`, `Upgrade`, ...) phải bỏ khi forward; `X-Forwarded-For` giữ IP client gốc; streaming để không tốn RAM với file lớn.

**Câu hỏi phỏng vấn**
- Gateway dịch giao thức khác reverse proxy thế nào? Khi nào chọn cách nào?
- RPC khác messaging thế nào? Khi nào dùng cái nào?
- 502, 503, 504 khác nhau thế nào?
- Message RPC không có HTTP status, vậy gateway biết trả 200 hay 201 bằng cách nào?
- Vì sao phải bỏ hop-by-hop headers khi làm reverse proxy?

**Trong code (Bước 2):**
- `src/gateway/gateway-handler.ts`: match → dựng payload → hỏi discovery → `transport.send` → dịch lỗi. Mọi nhánh lỗi quy về `GatewayError`, dịch sang HTTP ở **một** chỗ (`toGatewayError`).
- `src/gateway/transport/tcp-transport.ts`: **phân loại** lỗi thành 4 loại (timeout, connection, pattern-not-handled, remote). Transport phân loại, handler quyết định mã HTTP: mỗi lớp một trách nhiệm.
- `src/gateway.controller.ts`: catch-all mỏng, không có logic. Core không biết NestJS nên test được bằng fake.

**Bẫy thực tế (gặp khi làm Bước 2):**
- **Lỗi đi qua TCP mất kiểu.** Service ném `RpcException({...})`, gateway nhận về **object thường** (đã qua JSON), không phải `Error`. Pattern không có handler thì nhận về **một chuỗi** (`"There is no matching message handler..."`). Lỗi kết nối thì là `Error` có `code` (`ECONNREFUSED`). Phải phân loại theo hình dạng dữ liệu, không dùng `instanceof` cho lỗi từ xa.
- **Client TCP cache cả kết nối thất bại.** `ClientTCP.connect()` giữ lại promise đã reject, nên service khởi động lại thì client cũ vẫn lỗi mãi. Cách xử lý: lỗi kết nối thì đóng client và bỏ khỏi pool, lần sau tạo client mới. Đã kiểm chứng: tắt echo → 502, bật lại → 200.
- **Handler trả `undefined`** thì Observable kết thúc mà không emit; `firstValueFrom` ném `EmptyError`. Cần `{ defaultValue: undefined }`.
- **Message RPC không có HTTP status**, nên gateway lấy status thành công từ `responses` trong spec (201 cho POST tạo mới, 204 không body).
- **Lỗi không theo hợp đồng** (service ném `Error` thường) → NestJS gửi `{ status: 'error', message: 'Internal server error' }`; gateway trả 502 `UPSTREAM_ERROR` và log, không lộ chi tiết.
- **Wildcard route khác nhau giữa Express và Fastify.** Tài liệu NestJS 11+ dùng `{*path}` (cú pháp path-to-regexp của Express); với Fastify, NestJS chuyển path nguyên văn cho router của Fastify nên phải dùng `*`. Sai thì app crash lúc khởi động: "Wildcard must be the last character in the route".
- **NestJS ghi đè error handler của Fastify.** Đăng ký `fastify.setErrorHandler` sẽ bị NestJS thay bằng handler riêng (cảnh báo `FSTWRN004`), nên lỗi 413/415/400 khi đọc body không ra `problem+json`. Cách đúng: exception filter toàn cục (`@Catch()`); NestJS chuyển lỗi Fastify thành `HttpException(message, statusCode)` trước khi đưa vào filter.

---

## 7. Service discovery

**Tóm tắt:** Cơ chế để gateway biết service nào đang chạy ở địa chỉ nào, vì địa chỉ thay đổi liên tục (scale, deploy, crash).

**Hai mô hình:**
- **Client-side discovery:** client (ở đây là gateway) hỏi registry rồi tự chọn instance. Linh hoạt, nhưng client phải có logic.
- **Server-side discovery:** client gọi một load balancer, load balancer hỏi registry. Client đơn giản hơn.

**Hai cách đăng ký:**
- **Self-registration:** service tự đăng ký và gửi heartbeat.
- **Third-party registration:** một thành phần khác (orchestrator) đăng ký thay service.

**Trong dự án:** registry là **project riêng** (và mỗi project application chạy **một registry riêng**). Gateway chỉ biết một interface:

```ts
interface ServiceDiscovery {
  resolve(pattern: string): Promise<Instance[]>; // chỉ instance healthy
}
```

**Tra theo pattern thay vì tên service:** service đăng ký kèm danh sách `@MessagePattern` (`patterns: ["user.getById", ...]`), registry giữ bảng `pattern → instances`.
- Ưu: spec gọn, không phải ghi tên service; chuyển một pattern sang service khác (tách service) chỉ cần deploy lại service, không sửa spec.
- Nhược: gateway không kiểm tra được lúc khởi động pattern nào chưa có ai xử lý (chỉ biết lúc request → 503); registry phải chặn **hai service cùng giữ một pattern**.
- Đây chính là ý tưởng **capability-based discovery**: tìm theo "khả năng" (xử lý được gì), không theo "tên".

Ban đầu dùng `StaticDiscovery` (file JSON), sau thay bằng `RegistryDiscovery` mà **không sửa một dòng `GatewayHandler`**, rồi gỡ hẳn bản file khi registry đã chạy. Đây là **Dependency Inversion** / Adapter pattern.

**Phía gateway cần có:** dữ liệu instance trong RAM (không gọi registry mỗi request) và stale-on-error (registry chết thì dùng bản cũ). Dự án chọn **đồng bộ snapshot nền** (xem #8) thay vì cache theo từng pattern.

**Câu hỏi phỏng vấn**
- Vì sao microservices cần service discovery?
- Client-side và server-side discovery khác nhau thế nào? Ví dụ thực tế?
- Registry chết thì hệ thống có sập không?
- Tra theo tên service và tra theo pattern/khả năng khác nhau thế nào? Đánh đổi?
- Sản phẩm thực tế: Consul, Eureka, etcd, Kubernetes DNS (CoreDNS)?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 8. Caching, TTL, stale-on-error

**Tóm tắt:** Cache danh sách instance trong RAM để data plane không phải gọi registry mỗi request.

**Ý chính:**
- **TTL:** cache hết hạn sau N giây rồi làm mới.
- **Stale-on-error:** làm mới thất bại thì dùng tiếp bản cũ thay vì lỗi.
- **Đánh đổi:** TTL dài thì ít tải nhưng dữ liệu cũ (có thể gọi instance đã chết); TTL ngắn thì ngược lại.
- **Cache stampede:** TTL hết đồng loạt, nhiều request cùng lúc đổ vào registry. Giải pháp: chỉ cho một request làm mới, các request khác chờ (request coalescing / single-flight).

**Hai cách gateway lấy dữ liệu từ registry:**
| | Tra theo từng request + cache TTL | **Đồng bộ snapshot nền (dự án chọn)** |
|---|---|---|
| Cách làm | Request đầu của mỗi pattern gọi registry, cache vài giây | Timer nền tải toàn bộ bảng mỗi 3s |
| Request có phải chờ registry? | Có, ở lần đầu và mỗi lần hết hạn | **Không bao giờ**: chỉ đọc RAM (đúng tinh thần data plane) |
| Cache stampede | Có thể xảy ra, cần single-flight | **Không có**: chỉ một timer gọi registry |
| Registry chết | Hết TTL là mất dữ liệu nếu không làm stale-on-error | Giữ snapshot cuối (stale-on-error tự nhiên) |
| Tải lên registry | Theo lưu lượng request | Cố định: 1 request / 3s / gateway; **ETag** → 304 khi không đổi |
| Độ trễ cập nhật | ≤ TTL | ≤ chu kỳ poll |

- **ETag / If-None-Match:** registry gắn `version` của bảng vào header `ETag`; gateway gửi lại trong `If-None-Match`; bảng chưa đổi thì registry trả **304 Not Modified** không có body. Heartbeat thuần không làm tăng `version`, nên phần lớn lần poll chỉ tốn một response rỗng.
- Muốn cập nhật gần như tức thì: **long-polling** hoặc **watch/stream** (registry giữ kết nối, đổi mới trả về). Dự án để sau, polling đủ đơn giản cho bây giờ.

**Câu hỏi phỏng vấn**
- Cache ở gateway có rủi ro gì?
- Cache stampede là gì, tránh thế nào?
- Chọn TTL dựa trên tiêu chí nào?
- Polling snapshot khác tra theo từng request + cache thế nào? Vì sao bạn chọn snapshot?
- ETag và 304 hoạt động thế nào?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 9. Load balancing

**Thuật toán:**
| Thuật toán | Ý tưởng | Khi nào hợp |
|---|---|---|
| Round-robin | Luân phiên | Instance đồng đều, request nhẹ đều |
| Weighted round-robin | Luân phiên theo trọng số | Instance cấu hình khác nhau |
| Least-connections | Chọn instance ít kết nối đang mở nhất | Request có thời gian xử lý chênh lệch |
| Random / power of two choices | Chọn ngẫu nhiên 2, lấy cái ít tải hơn | Tải lớn, tránh dồn cục |
| Consistent hashing | Cùng key luôn tới cùng instance | Cần sticky / cache cục bộ |

**Trong code (Bước 3):** `src/gateway/load-balancer.ts`, vòng lặp `sendWithFailover` trong `src/gateway/gateway-handler.ts`.
- Load balancer trả về **thứ tự thử** chứ không chỉ một instance: `[A, B, C]` → `[B, C, A]` → `[C, A, B]`. Phần tử đầu là lựa chọn chính, phần còn lại để failover. Chọn instance và failover dùng chung một thứ tự nên không cần thêm logic.
- **Bộ đếm theo từng `pattern`**: bộ đếm chung cho mọi pattern sẽ lệch. Ví dụ request xen kẽ `user.getById`, `user.list` với 2 instance: bộ đếm chung khiến mỗi pattern luôn rơi vào một instance.
- **Sắp theo `id` trước khi xoay**: thứ tự không phụ thuộc thứ tự registry trả về.
- Bộ đếm lưu phần dư (`% n`) để không tăng vô hạn.
- Kiểm chứng thật: 2 echo → mỗi echo nhận 2/4 request.

**Bẫy thực tế:**
- **Round-robin không biết instance nào đã chết.** Tắt một echo thì nó vẫn được chọn làm lựa chọn chính mỗi lượt thứ hai, rồi mới failover (log có cảnh báo cho 2/4 request). Nhanh vì `ECONNREFUSED` trả về tức thì, nhưng vẫn là một lần thử thừa. Giải pháp: **outlier detection / passive health check** (tạm loại instance lỗi liên tiếp), làm ở Bước 5.

**Câu hỏi phỏng vấn**
- Round-robin có nhược điểm gì? Khi nào dùng least-connections?
- Vì sao bộ đếm round-robin nên tách theo từng pattern/route?
- Load balancer biết instance chết bằng cách nào? (health check chủ động / thụ động, outlier detection)
- Sticky session là gì, có nên dùng không?
- Layer 4 và Layer 7 load balancing khác nhau thế nào?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 10. Authentication / Authorization

**Tóm tắt:**
- **Authentication (AuthN):** bạn là ai? **Authorization (AuthZ):** bạn được làm gì?
- Gateway thường làm AuthN (verify JWT, API key) rồi truyền danh tính xuống service. Với reverse proxy là header (`x-user-id`); trong dự án này là trường `user` trong payload.

**Trong dự án:**
- Đọc `security` trong OpenAPI để biết operation nào cần auth, không hard-code. `security: []` là route công khai (login).
- **Phân vai:**

| Thành phần | Trách nhiệm |
|---|---|
| Keycloak | Identity provider: lưu thông tin đăng nhập, phát và ký token, quản lý session |
| auth worker | Login, logout, refresh, CRUD user, collection `user` (liên kết qua `keycloakId` = `sub`); nơi duy nhất gọi Keycloak |
| Gateway | Chỉ verify token cục bộ, đưa `{ sub, roles }` vào payload |

**Cần nắm:**
- JWT: cấu trúc header.payload.signature, verify chữ ký, kiểm tra `exp`, `nbf`, `iss`, `aud`/`azp`.
- **RS256 vs HS256:** RS256 ký bằng private key (chỉ Keycloak giữ), verify bằng public key, nên gateway không giữ bí mật nào. HS256 dùng chung một secret: lộ secret ở bất kỳ đâu là kẻ tấn công tự ký được token.
- **JWKS:** danh sách public key Keycloak công khai tại `{issuer}/protocol/openid-connect/certs`. Mỗi token có `kid` cho biết khoá nào đã ký. Gateway cache JWKS; gặp `kid` lạ thì tải lại (Keycloak **xoay khoá** định kỳ), có giới hạn tần suất để không bị lợi dụng spam.
- **Verify cục bộ vs introspection:** verify cục bộ bằng chữ ký thì nhanh, không phụ thuộc ai; introspection (hỏi IdP/auth worker mỗi request) thu hồi được tức thì nhưng thêm độ trễ và tạo điểm nghẽn. Dự án chọn verify cục bộ.
- **Logout với JWT stateless:** access token vẫn dùng được tới khi hết hạn. Giải pháp: access token ngắn (~5 phút) + huỷ refresh token khi logout; cần tức thì thì blacklist `jti`.
- Verify ở gateway hay ở từng service? Verify ở gateway thì gọn, nhưng service phải **tin** gateway. Mạng nội bộ cần được bảo vệ (zero trust, mTLS) vì ai gọi thẳng vào service sẽ bỏ qua gateway.
- Danh tính do client tự gửi phải bị bỏ qua. Dự án này dựng payload từ đầu nên client không có cách nào chèn `user` giả.
- **AuthZ hai tầng:** gateway kiểm tra role thô (`x-roles`); service kiểm tra theo dữ liệu (user chỉ sửa đơn của chính mình).

**Câu hỏi phỏng vấn**
- Verify token ở gateway hay ở service? Đánh đổi?
- RS256 khác HS256 thế nào? Vì sao gateway nên dùng RS256?
- JWKS là gì? Xử lý xoay khoá thế nào?
- User đã logout nhưng access token vẫn còn hạn, xử lý ra sao?
- Client gửi sẵn danh tính giả thì sao?
- Vì sao tách auth worker khỏi gateway thay vì cho gateway gọi Keycloak?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 11. Rate limiting

**Thuật toán:**
| Thuật toán | Ý tưởng | Đặc điểm |
|---|---|---|
| Fixed window | Đếm trong từng khung cố định | Đơn giản, nhưng cho phép burst gấp đôi ở ranh giới khung |
| Sliding window | Khung trượt | Chính xác hơn, tốn bộ nhớ hơn |
| Token bucket | Xô token, nạp đều, mỗi request lấy 1 token | Cho phép burst có kiểm soát, phổ biến nhất |
| Leaky bucket | Request chảy ra với tốc độ cố định | Làm mượt traffic |

**Ý chính:**
- Chạy **nhiều instance gateway** thì counter phải **dùng chung** (Redis), nếu không mỗi instance đếm riêng và giới hạn bị nhân lên.
- Trả `429 Too Many Requests` kèm `Retry-After`.
- Khoá giới hạn theo gì: IP, user, API key, route?
- Atomic: dùng Lua script hoặc `INCR` + `EXPIRE` trong Redis để tránh race condition.

**Câu hỏi phỏng vấn**
- Thiết kế rate limiter cho hệ thống phân tán.
- Token bucket khác fixed window thế nào?
- Redis chết thì rate limiter nên fail-open hay fail-closed?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 12. Request validation

**Tóm tắt:** Dùng schema trong OpenAPI để validate request ngay ở gateway (ajv). Sai thì trả `400` luôn, không tốn call xuống service.

**Đánh đổi:** gateway tốn thêm CPU và phải khớp phiên bản schema với service. Nên biên dịch schema **một lần ở control plane**, không compile mỗi request.

**Câu hỏi phỏng vấn**
- Validate ở gateway hay ở service? Có cần cả hai không? (defense in depth)

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 13. Observability

Ba trụ cột:
- **Logs:** structured log (JSON), có correlation id.
- **Metrics:** số request, tỉ lệ lỗi, latency theo phân vị (p50/p95/p99), xuất cho Prometheus.
- **Traces:** theo dõi một request đi qua nhiều service (OpenTelemetry, trace id lan truyền qua header `traceparent`).

**Cần nắm:**
- **Correlation id / `x-request-id`:** mã duy nhất gắn vào mỗi request để gom mọi log của request đó qua nhiều service (kể cả qua RabbitMQ: service copy mã vào header message).
  - Gateway sinh mã (UUID) nếu client chưa gửi; kiểm tra định dạng và độ dài mã do client gửi, sai thì sinh mới.
  - Gateway gắn mã vào **request gửi xuống service** và vào **response trả về client**. Gắn ở response vì gateway tự trả nhiều lỗi (404, 429, 502/503/504) không đi qua service nào, và để đảm bảo nhất quán dù service quên.
  - Client báo lại mã khi gặp lỗi, ta tìm trong log ra ngay hành trình của request.
  - Chỉ hiệu quả khi **mọi service cùng tuân thủ**: nhận mã (trong dự án này là `payload.meta.requestId`), ghi vào log, truyền tiếp khi gọi service khác hoặc publish event.
  - Khác `Idempotency-Key`: `x-request-id` để **truy vết** (mỗi lần gọi một mã mới, kể cả retry); `Idempotency-Key` để **chống xử lý trùng** (retry giữ nguyên mã).
  - Phiên bản đầy đủ hơn: `traceparent` (W3C Trace Context) với OpenTelemetry.
  - **Trong code (Bước 2):** `src/gateway/request-id.ts` (giữ id client nếu ≤128 ký tự và chỉ gồm `[A-Za-z0-9._-]`, ngược lại `randomUUID()`); gateway đưa id vào `payload.meta.requestId` (không phải header, vì xuống service là message) và vào header response, kể cả response lỗi. Echo service log cùng id, nên tìm `demo-trace-1` thấy cả log gateway lẫn log service.
- Vì sao dùng **percentile** thay vì trung bình cho latency.
- **Health check:** liveness (còn sống không) khác readiness (sẵn sàng nhận traffic chưa).
- RED method (Rate, Errors, Duration) cho dịch vụ.

**Câu hỏi phỏng vấn**
- `x-request-id` là gì? Ai sinh ra, ai chịu trách nhiệm truyền tiếp? Vì sao gateway gắn nó vào cả response?
- Debug một request đi qua 5 service như thế nào?
- Liveness và readiness probe khác nhau thế nào?
- Vì sao p99 quan trọng hơn trung bình?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 14. Resilience: timeout, retry, circuit breaker

**Tóm tắt:** Service phía sau sẽ lỗi, gateway phải không bị kéo theo.

| Cơ chế | Giải quyết gì | Lưu ý |
|---|---|---|
| **Timeout** | Không chờ vô hạn | Luôn đặt, theo từng route (`x-timeout`) |
| **Retry** | Lỗi tạm thời | Chỉ retry thao tác **idempotent** (GET, PUT, DELETE), dùng exponential backoff + jitter, có giới hạn lần |
| **Circuit breaker** | Dừng gọi service đang hỏng | 3 trạng thái: Closed → Open → Half-open |
| **Bulkhead** | Cô lập tài nguyên | Một service chậm không chiếm hết kết nối của các service khác |
| **Fallback** | Có đường lui | Trả cache hoặc phản hồi mặc định |

**Bẫy cần nhớ:**
- **Retry storm:** nhiều tầng cùng retry thì tải nhân lên, làm service đang hỏng càng chết nhanh.
- Retry thao tác POST không idempotent có thể tạo trùng dữ liệu.

**Timeout RPC và dọn kết nối (dự án này):**
- Message gửi qua TCP mà service không trả lời thì gateway phải tự cắt sau `GATEWAY_RPC_TIMEOUT_MS` (mặc định 10s) và trả 504.
- Timeout **không huỷ** việc service đang làm: service vẫn có thể xử lý xong sau khi gateway đã trả 504. Vì vậy thao tác ghi cần idempotency để client retry an toàn.
- Kết nối TCP tới instance đã chết phải được đóng và bỏ khỏi pool, nếu không gateway giữ socket rác và rò rỉ tài nguyên.

**Failover an toàn (dự án này, Bước 3):** chuyển request sang instance khác **chỉ khi chắc chắn service chưa nhận được nó**.

| Lỗi | Request đã tới service chưa? | Failover? |
|---|---|---|
| `ECONNREFUSED`, `EHOSTUNREACH`, `ENETUNREACH`, `ENOTFOUND`, `EAI_AGAIN` | **Chắc chắn chưa** (chưa mở được kết nối) | **Có**, kể cả POST |
| `ECONNRESET`, `EPIPE`, `ETIMEDOUT`, "Connection closed" | Không biết (có thể đã xử lý) | Không → 502 |
| Timeout | Không biết | Không → 504 |
| Lỗi từ service, không có handler | Đã tới | Không |

- `RpcConnectionError.delivered` mang thông tin này: transport **phân loại**, handler **quyết định** có thử lại không.
- Vì sao an toàn cả với POST: service chưa hề thấy request nên không thể tạo trùng. Đây khác với **retry** (Bước 5) cho trường hợp "không biết", chỉ được làm với method idempotent hoặc có `Idempotency-Key`.
- Giới hạn `GATEWAY_FAILOVER_MAX_ATTEMPTS` (mặc định 3; 1 = tắt) để nhiều instance chết không làm request chậm vô hạn.
- Các lần thử dùng **cùng payload và cùng `requestId`**: log của mọi lần thử gom được về một mã.
- **Hạn chế:** host "nuốt gói" (không trả `ECONNREFUSED` mà treo) sẽ thành timeout → 504, không failover. Cần tách connect timeout khỏi response timeout (Bước 5).

**Câu hỏi phỏng vấn**
- Khi nào gateway được phép gửi lại request sang instance khác? Vì sao POST cũng được trong trường hợp `ECONNREFUSED`?
- Failover khác retry thế nào?
- Gateway trả 504 rồi, service có dừng xử lý không? Hệ quả là gì?
- Circuit breaker hoạt động thế nào? Ba trạng thái là gì?
- Vì sao retry có thể làm hệ thống tệ hơn?
- Idempotency là gì? Khi nào retry được?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 15. Đóng gói và triển khai

- Docker image chạy được cho nhiều project: cấu hình qua **env** (`GATEWAY_PROJECT`, `GATEWAY_REGISTRY_URL`, `GATEWAY_RPC_TIMEOUT_MS`, `GATEWAY_BODY_LIMIT`, `PORT`), mount thư mục `specs/`. Cùng một image, khác env là thành gateway của project khác (nguyên tắc **12-factor**: cấu hình nằm ở môi trường, không nằm trong code).
- Graceful shutdown: ngừng nhận request mới, chờ request đang xử lý xong rồi mới thoát. **Đã có một phần:** `enableShutdownHooks()` + `GatewayModule.onApplicationShutdown` đóng mọi kết nối TCP khi nhận SIGTERM.
- Stateless: gateway không giữ trạng thái cục bộ để scale ngang được.
- Tài liệu "dùng cho project mới trong 5 phút".

**Câu hỏi phỏng vấn**
- Làm sao scale gateway ngang?
- Graceful shutdown để làm gì?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 16. Service registry (project riêng)

**Cần nắm:**
- **Heartbeat vs TTL:** service gửi tín hiệu định kỳ; quá TTL không thấy thì coi như chết và gỡ khỏi danh sách.
- **Health check chủ động vs thụ động.**
- **CAP theorem:** registry nên ưu tiên **AP** (luôn trả lời, có thể hơi cũ) hay **CP** (đúng tuyệt đối, có thể không trả lời khi partition)? Với service discovery, trả danh sách hơi cũ thường tốt hơn không trả lời (Eureka chọn AP, ZooKeeper/etcd chọn CP).
- **Self-preservation:** khi mất heartbeat hàng loạt (nghi do mạng), registry không nên xoá hết instance.
- Cách thông báo thay đổi: polling, long-polling, watch/stream.

**Thiết kế trong dự án** (chi tiết: PLAN.md mục 16):
```
service ──PUT /v1/instances/:id──► registry   (đăng ký + heartbeat, kèm patterns)
service ──DELETE ...────────────────────────────────► registry   (huỷ đăng ký khi tắt)
gateway ──GET /v1/snapshot (ETag)─► registry   (đồng bộ nền mỗi 3s)
```
- **Lease + heartbeat:** mỗi lần đăng ký cấp một "hợp đồng thuê" 15s; service gia hạn bằng heartbeat mỗi 5s (lỡ 2 nhịp vẫn còn). Quá 15s không thấy thì bị gỡ.
- **Heartbeat = đăng ký lại đầy đủ (idempotent PUT)**, không phải một API "ping" riêng. Nhờ vậy registry mất dữ liệu (khởi động lại) thì heartbeat kế tiếp tự khôi phục: đây là **soft state**, nên lưu in-memory là đủ (Eureka cũng làm vậy).
- **Hai cách rời đi:**
  - Tắt êm (SIGTERM): service gọi `DELETE` → biến mất ngay ở lần poll kế của gateway.
  - Chết đột ngột (crash, SIGKILL): không kịp deregister → chờ hết lease TTL (~15s + chu kỳ poll). TTL là lưới an toàn cho trường hợp này.
- **Xung đột pattern:** hai service khác nhau cùng giữ một pattern → 409. Pattern được giải phóng khi mọi instance của service chủ hết hạn.
- **`version` chỉ tăng khi bảng đổi**, không tăng vì heartbeat → gateway nhận 304 phần lớn thời gian.
- **Chọn AP:** registry chết thì gateway vẫn phục vụ bằng snapshot cũ; service vẫn chạy và tiếp tục thử heartbeat. Gateway khởi động khi registry chết thì vẫn mở cổng (503 cho tới khi đồng bộ được).
- **Self-registration:** service tự đăng ký qua `libs/service-discovery-client` (NestJS module `ServiceDiscoveryModule`, tự thu thập `@MessagePattern`, bỏ `@EventPattern`).

**Bẫy cần biết trước:**
- **Quảng bá `0.0.0.0`:** service lắng nghe `0.0.0.0` (mọi card mạng), nhưng nếu đăng ký đúng địa chỉ đó thì gateway sẽ kết nối tới `0.0.0.0` và thất bại. Phải đăng ký **địa chỉ mà bên khác dùng để gọi tới** (`SERVICE_ADVERTISE_HOST`, mặc định tự phát hiện; trong Docker là tên service).
- **Đồng hồ:** registry tự đo `lastSeen` bằng đồng hồ của chính nó, không tin thời gian do service gửi lên (đồng hồ các máy lệch nhau).
- **Timer chặn process thoát:** timer heartbeat phải `unref()`, nếu không service không tắt được khi chỉ còn timer chạy.

**Ngoài phạm vi (biết để trả lời phỏng vấn):** nhiều instance registry cần đồng bộ dữ liệu (gossip như Consul, hoặc đồng thuận Raft như etcd); health check chủ động (registry tự gọi `/health` của service); self-preservation.

**Câu hỏi phỏng vấn**
- Registry nên AP hay CP? Vì sao?
- Làm sao phát hiện instance đã chết?
- Mất mạng giữa service và registry thì registry làm gì?
- Vì sao heartbeat nên là "đăng ký lại đầy đủ" thay vì một lệnh ping riêng?
- Soft state là gì? Vì sao registry lưu in-memory vẫn chấp nhận được?
- Service tắt êm và service crash khác nhau thế nào với registry?
- Vì sao không được đăng ký địa chỉ `0.0.0.0`?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 17. Trade-offs và so sánh sản phẩm

**Điểm đánh đổi khi tự build gateway:**
- ✅ Hiểu sâu, tuỳ biến theo OpenAPI, nhẹ.
- ❌ Phải tự lo bảo mật, hiệu năng, độ ổn định, vận hành.

**Sản phẩm có sẵn để so sánh:**
| Sản phẩm | Điểm nổi bật |
|---|---|
| Kong | Plugin phong phú, dựa trên Nginx/OpenResty |
| Nginx | Hiệu năng rất cao, cấu hình tĩnh |
| Traefik | Tự phát hiện service (Docker/K8s), cấu hình động |
| Envoy | Data plane hiện đại, nền của Istio, xDS API |
| AWS API Gateway | Managed, import OpenAPI, tính phí theo request |
| KrakenD | Gateway khai báo (declarative), mạnh về aggregation |

**Câu hỏi phỏng vấn**
- Khi nào nên tự build gateway, khi nào dùng sản phẩm có sẵn?
- Gateway và service mesh khác nhau thế nào? (gateway: traffic bắc-nam từ ngoài vào; mesh: traffic đông-tây giữa các service)
- BFF (Backend for Frontend) là gì, khác gateway chung ở đâu?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 18. Mẫu kiến trúc quanh gateway

| Mẫu | Ý tưởng | Liên hệ dự án |
|---|---|---|
| **Gateway Routing** | Một điểm vào, định tuyến tới nhiều service | Cốt lõi của gateway này |
| **Gateway Offloading** | Đẩy việc chung (auth, rate limit, TLS, log) lên gateway | Bước 4–5 |
| **Gateway Aggregation / API Composition** | Gateway gọi nhiều service rồi gộp kết quả thành một response | **Chưa làm**; đánh đổi: tiện cho client nhưng đưa logic vào gateway, tăng độ trễ theo service chậm nhất |
| **BFF (Backend for Frontend)** | Mỗi loại client (web, mobile) có gateway riêng, định hình dữ liệu theo nhu cầu client đó | Có thể làm bằng cách chạy nhiều instance với spec khác nhau |
| **Strangler Fig** | Chuyển dần từ monolith sang microservices: gateway route endpoint cũ về monolith, endpoint mới về service mới, rồi dần thay thế | Gateway theo spec làm việc này dễ: đổi đích của từng operation |
| **Sidecar / Service mesh** | Proxy nằm cạnh mỗi service lo traffic đông-tây (Istio/Envoy) | Gateway lo bắc-nam; mesh lo đông-tây; hai thứ bổ sung nhau |

**Câu hỏi phỏng vấn**
- BFF là gì? Khi nào cần BFF thay vì một gateway chung?
- Gateway có nên gộp dữ liệu từ nhiều service không? Đánh đổi?
- Chuyển một monolith sang microservices mà không "big bang" thế nào?
- API gateway và service mesh khác nhau thế nào, có cần cả hai không?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 19. Nền tảng HTTP cho gateway

**Method:**
| Method | Safe (không đổi dữ liệu) | Idempotent (gọi nhiều lần = một lần) |
|---|---|---|
| GET, HEAD, OPTIONS | Có | Có |
| PUT, DELETE | Không | Có |
| POST, PATCH | Không | Không (trừ khi có Idempotency-Key) |

Ý nghĩa với gateway: chỉ **retry tự động** method idempotent; POST cần `Idempotency-Key`.

**Status code hay bị hỏi:**
- **401 vs 403:** 401 = chưa xác thực (thiếu/sai token, "bạn là ai?"); 403 = đã biết bạn là ai nhưng không có quyền.
- **404 vs 405:** không có path / có path nhưng sai method (kèm header `Allow`).
- **400 vs 422:** request sai cú pháp / đúng cú pháp nhưng sai nghiệp vụ.
- **409:** xung đột trạng thái (email đã tồn tại).
- **429:** vượt rate limit (kèm `Retry-After`).
- **502 / 503 / 504:** upstream trả lỗi hoặc không kết nối được / không có ai phục vụ hoặc quá tải / upstream không trả lời kịp.
- **201 vs 202 vs 204:** đã tạo / đã nhận, xử lý sau (async) / thành công, không có body.

**Khác:** keep-alive (tái sử dụng kết nối TCP); `Content-Type` vs `Accept`; RFC 9457 problem details.

**Câu hỏi phỏng vấn**
- 401 khác 403 thế nào?
- PUT khác PATCH thế nào? Cái nào idempotent?
- Khi nào trả 202 thay vì 201?
- Vì sao chuẩn hoá lỗi theo RFC 9457 thay vì mỗi service một kiểu?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 20. Node.js trong vai trò gateway

- **Vì sao Node hợp với gateway:** gateway chủ yếu **chờ I/O** (mạng tới client, tới service). Event loop một luồng xử lý hàng nghìn kết nối đồng thời mà không cần một thread mỗi request.
- **Điểm yếu:** việc **nặng CPU** chạy trên event loop sẽ chặn mọi request khác: parse body JSON rất lớn, verify chữ ký quá nhiều, regex tệ (ReDoS). Vì vậy giới hạn body (413) không chỉ là bảo mật mà còn bảo vệ event loop.
- **Fastify vs Express:** Fastify nhanh hơn (router radix tree, serialize theo schema, ít overhead); dự án dùng Fastify qua `@nestjs/platform-fastify`.
- **Scale:** chạy nhiều process (cluster, nhiều container) vì một process chỉ dùng một nhân CPU cho JavaScript.
- **Async và lỗi:** promise bị reject mà không bắt → crash/rò rỉ; dự án gom mọi lỗi về một `catch` trong `GatewayHandler`.
- **ESM vs CommonJS:** NestJS 12 là ESM-only; Node 22 `require()` được ESM, nhưng Jest cần Node ≥ 24.9 (bẫy đã gặp).

**Câu hỏi phỏng vấn**
- Event loop là gì? Vì sao Node phù hợp cho I/O-bound?
- Điều gì làm "nghẽn" event loop? Phát hiện và tránh thế nào?
- Node chỉ dùng một nhân, vậy scale gateway Node thế nào?
- Vì sao chọn Fastify thay vì Express?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 21. Bảo mật ngoài auth

| Mối nguy | Biện pháp | Trạng thái |
|---|---|---|
| Body cực lớn làm cạn RAM/CPU | `GATEWAY_BODY_LIMIT` → 413 | ✅ |
| Client giả danh tính / header nội bộ | Dựng payload theo allowlist, không chuyển header | ✅ |
| Path traversal qua env | Regex + kiểm tra đường dẫn sau `resolve` | ✅ |
| Lộ chi tiết lỗi nội bộ | 500 chỉ trả `INTERNAL_ERROR`, chi tiết chỉ ghi log | ✅ |
| Chèn ký tự lạ vào log qua `x-request-id` | Chỉ nhận `[A-Za-z0-9._-]{1,128}` | ✅ |
| Gọi thẳng vào service, bỏ qua gateway | Service chỉ mở TCP trong mạng nội bộ; nâng cao: mTLS | Một phần |
| Trình duyệt gọi chéo domain | CORS | Bước 4 |
| Nghe lén | TLS termination ở gateway hoặc load balancer phía trước | Bước 6 |
| Spam request / brute force | Rate limit | Bước 4 |
| Slowloris (giữ kết nối mở rất lâu) | Timeout đọc header/body ở server HTTP | Chưa làm |

**Câu hỏi phỏng vấn**
- CORS là gì? Vì sao chỉ trình duyệt bị ràng buộc bởi CORS?
- TLS termination ở gateway nghĩa là gì? Traffic nội bộ có cần mã hoá không (mTLS, zero trust)?
- Kể các biện pháp bảo vệ gateway khỏi DoS.
- Vì sao không trả stack trace cho client?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 22. Ranh giới với event-driven (RabbitMQ)

- **Đồng bộ (TCP RPC) vs bất đồng bộ (RabbitMQ):** client cần câu trả lời ngay → RPC qua gateway; "điều gì đó đã xảy ra" cần báo cho nhiều service → event qua RabbitMQ. Gateway **không** kết nối RabbitMQ.
- **Async request:** service trả `202 Accepted` + id để client hỏi trạng thái sau.
- **At-least-once delivery:** message có thể bị giao lặp → consumer phải **idempotent** (lưu id message đã xử lý).
- **Outbox pattern:** ghi dữ liệu và "event cần gửi" trong **cùng một transaction** DB, rồi một tiến trình khác publish; tránh trường hợp lưu DB xong nhưng gửi event thất bại (hoặc ngược lại).
- **Saga:** giao dịch trải qua nhiều service, mỗi bước có hành động bù (compensation) nếu bước sau thất bại; choreography (theo event) vs orchestration (có điều phối viên).
- **Truy vết:** service copy `meta.requestId` vào header message.
- **AsyncAPI:** chuẩn mô tả event, tương đương OpenAPI cho API đồng bộ.

**Câu hỏi phỏng vấn**
- Khi nào dùng gọi đồng bộ, khi nào dùng event?
- At-least-once, at-most-once, exactly-once khác nhau thế nào? Exactly-once có thật không?
- Outbox pattern giải quyết vấn đề gì?
- Saga là gì? Choreography khác orchestration thế nào?
- Request đi qua gateway rồi sinh event, làm sao truy vết cả chuỗi?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 23. NestJS microservices

- **`@MessagePattern` + `client.send()`:** request/response, bên gửi chờ kết quả (dự án dùng cho gateway → service).
- **`@EventPattern` + `client.emit()`:** fire-and-forget, không chờ (dùng cho event).
- **Transport:** TCP, Redis, NATS, RabbitMQ (RMQ), Kafka, gRPC, MQTT; cùng code controller, đổi transport bằng cấu hình.
- **`ClientProxy`** trả **Observable** (RxJS); dự án dùng `firstValueFrom` + `timeout`.
- **`RpcException`:** cách chuẩn để service báo lỗi; payload được serialize thành JSON nên phía nhận mất kiểu `Error`.
- **Hybrid app:** một app vừa mở HTTP vừa lắng nghe microservice (`connectMicroservice`).
- **Exception filter**, **DI**, **dynamic module** (`GatewayModule.forRoot`) đều đã dùng trong dự án.

**Câu hỏi phỏng vấn**
- `send` khác `emit` thế nào? `@MessagePattern` khác `@EventPattern`?
- Service ném lỗi thế nào để bên gọi nhận được thông tin có ích?
- Dynamic module trong NestJS dùng khi nào?
- Exception filter là gì? Vì sao dự án cần nó cho lỗi 413/415?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 24. API versioning

Dự án **không** làm versioning ở gateway: spec là nguồn sự thật, version (nếu cần) chỉ là path khác với `operationId` khác. Nhưng câu hỏi này rất hay gặp:

| Cách | Ví dụ | Ưu | Nhược |
|---|---|---|---|
| URI | `/v1/users` | Rõ ràng, dễ cache, dễ debug | URL đổi theo version |
| Header | `Accept-Version: 2` | URL sạch | Khó thấy, khó test bằng trình duyệt |
| Media type | `Accept: application/vnd.app.v2+json` | Đúng tinh thần REST | Phức tạp |
| Query | `?version=2` | Dễ | Dễ lẫn với tham số khác |

Nguyên tắc chung: chỉ tăng version khi có **breaking change**; thay đổi tương thích ngược (thêm field) thì không cần; có lộ trình **deprecate** (header `Deprecation`, `Sunset`).

**Câu hỏi phỏng vấn**
- Các cách versioning API? Bạn chọn cách nào, vì sao?
- Thế nào là breaking change?
- Vì sao dự án không làm versioning ở gateway?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 25. Chiến lược test

| Tầng | Trong dự án | Mục đích |
|---|---|---|
| **Unit** | `route-table`, `spec-loader`, `config`, `gateway-handler` (fake discovery + fake transport) | Nhanh, không mạng, phủ mọi nhánh lỗi |
| **Integration** | `tcp-transport.spec.ts` với microservice TCP thật | Kiểm chứng giả định về thư viện (lỗi đến dưới dạng gì) |
| **E2E** | `gateway.e2e-spec.ts`: HTTP thật → gateway → TCP → fixture | Kiểm chứng toàn bộ đường đi, gồm lỗi Fastify 413/415/400 |
| **Chạy tay** | gateway + echo-service + curl | Phát hiện lỗi mà test chưa chạy được (đã bắt 2 lỗi thật: wildcard Fastify, error handler bị ghi đè) |
| **Contract test** | Không làm (quyết định) | Pact: kiểm tra service thật khớp hợp đồng mà bên gọi kỳ vọng |

- **Test pyramid:** nhiều unit, ít e2e.
- **Thiết kế để test được:** core không phụ thuộc NestJS; dependency truyền qua constructor; `loadConfig(env, cwd)` nhận tham số thay vì đọc `process.env`.

**Câu hỏi phỏng vấn**
- Test pyramid là gì? Bạn chia test trong dự án thế nào?
- Làm sao unit test một thành phần gọi mạng?
- Contract testing là gì, khác e2e thế nào?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 26. Nguyên lý thiết kế đã dùng trong code

| Nguyên lý | Ở đâu trong code |
|---|---|
| **Dependency Inversion** | `GatewayHandler` phụ thuộc interface `ServiceDiscovery`, `RpcTransport`, không phụ thuộc `RegistryDiscovery`, `TcpTransport`; test thay bằng bản giả |
| **Adapter** | `TcpTransport` bọc `ClientProxy` của NestJS; `RegistryDiscovery` bọc HTTP API của registry (thay `StaticDiscovery` mà handler không đổi) |
| **Single Responsibility** | Transport **phân loại** lỗi; handler **quyết định** mã HTTP; controller chỉ chuyển dữ liệu |
| **Ports & Adapters (hexagonal)** | Core `src/gateway/` không biết NestJS/Fastify; NestJS chỉ là lớp vỏ |
| **Fail-fast** | Mọi lỗi cấu hình ném ở `bootstrap`, trước khi mở cổng |
| **Discriminated union** | `MatchResult.kind` buộc xử lý đủ found / not_found / method_not_allowed / invalid_path |
| **Defense in depth** | Path traversal chặn hai lớp |
| **Một chỗ dịch lỗi** | Mọi lỗi quy về `GatewayError`, chỉ `toGatewayError` quyết định mã HTTP |

### "Lõi không phụ thuộc NestJS" nghĩa là gì
- Các file lõi (`src/gateway/`) **không `import` gì từ NestJS**: chỉ là class, hàm, interface TypeScript, vẫn chạy trên Node.js. NestJS là **lớp vỏ**: controller nhận HTTP rồi gọi vào lõi.
  ```ts
  // Dính framework: muốn dùng/test phải dựng cả NestJS app
  @Injectable() export class RegistryService { @Interval(5000) sweep() { … } }

  // Lõi thuần: test chỉ cần new RegistryStore(fakeClock, 15000)
  export class RegistryStore { constructor(private clock: () => number, private leaseTtlMs: number) {} sweep() { … } }
  ```
- **Lợi ích thật:**
  - Test nhanh, không cần framework: 96 unit test của gateway chạy được cả trên Node 22, còn test dính NestJS phải chờ Node 24. Test "hết TTL" chỉ cần đổi clock, không phải chờ 15 giây thật.
  - Đổi framework HTTP (Express, Fastify thuần, `node:http`) chỉ phải viết lại lớp vỏ.
  - Đọc logic không bị decorator và DI che mất.
- **Không** có nghĩa là dùng được với ngôn ngữ khác. Đa ngôn ngữ phụ thuộc **giao thức**, là một chiều khác:

| Kết nối | Giao thức | Ngôn ngữ khác dùng được? |
|---|---|---|
| Service → Registry | HTTP + JSON | **Được**: service Go/Java vẫn tự đăng ký được |
| Gateway → Service | TCP của NestJS (`@MessagePattern`) | **Gần như không**: định dạng gói tin riêng của NestJS. Muốn mở rộng thì viết thêm transport adapter (VD gRPC) thay `TcpTransport`, handler không đổi |

### DDD hay hexagonal?
- **DDD chiến thuật** (entity, value object, aggregate, repository, domain event) dùng để bảo vệ **luật nghiệp vụ** ("đơn đã thanh toán thì không được huỷ").
- Gateway **không có domain**: không entity, không dữ liệu nghiệp vụ, stateless; toàn bộ là hạ tầng (định tuyến, dịch giao thức, chọn instance, dịch lỗi). Áp DDD vào đây chỉ sinh ra các lớp rỗng ruột: over-engineering.
- Gateway hợp với **hexagonal**: lõi + port (interface) + adapter. Hexagonal hay đi cùng DDD nhưng không bắt buộc phải có domain model.
- **DDD chiến lược** vẫn có mặt ở mức hệ thống: mỗi microservice là một **bounded context**; `operationId`/pattern là ngôn ngữ chung giữa các context. DDD chiến thuật đặt **bên trong** các service nghiệp vụ (order, payment, phần nghiệp vụ của auth worker).

**Câu trả lời mẫu:**
> Gateway là hạ tầng, không có domain nên tôi không dùng DDD chiến thuật mà tổ chức theo hexagonal: lõi TypeScript thuần phụ thuộc các port như ServiceDiscovery và RpcTransport; NestJS, TCP và file JSON là adapter. DDD tôi dùng trong các service nghiệp vụ, mỗi service là một bounded context.

**Câu hỏi phỏng vấn**
- Dependency Inversion là gì? Cho ví dụ trong code của bạn.
- Hexagonal architecture là gì? Lợi ích thật sự là gì?
- Vì sao tách core khỏi framework? "Không phụ thuộc framework" có nghĩa là dùng được với ngôn ngữ khác không?
- Có nên áp dụng DDD cho API gateway không? Vì sao?
- DDD chiến lược khác DDD chiến thuật thế nào?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 27. Idempotency và `Idempotency-Key`

**Idempotent** = gọi nhiều lần cho kết quả như gọi một lần. `GET`, `PUT`, `DELETE` vốn idempotent; `POST`, `PATCH` thì không.

**Vấn đề:**
```
Client ──POST /orders──► Gateway ──► order-service: tạo đơn #123, trừ tiền ✅
Client ◄── mạng rớt / gateway trả 504 vì quá timeout ──
```
Đơn đã tạo nhưng client không biết. Client gửi lại → **đơn bị tạo 2 lần, tiền bị trừ 2 lần**.

**Giải pháp:** client sinh một mã duy nhất (UUID) cho **mỗi thao tác**, gửi qua header `Idempotency-Key`, và **giữ nguyên mã khi retry**.
```
Lần 1: POST /orders  Idempotency-Key: a1b2c3 → xử lý, lưu (a1b2c3 → kết quả #123)
Lần 2: POST /orders  Idempotency-Key: a1b2c3 → đã có a1b2c3 → trả lại kết quả #123, KHÔNG xử lý lại
```

**Phân vai trong dự án:**
| Ai | Làm gì |
|---|---|
| Client | Sinh mã cho mỗi thao tác ghi; retry thì dùng lại mã cũ |
| Gateway | Chỉ **chuyển** header vào `payload.meta.idempotencyKey` (chuỗi không rỗng, ≤ 255 ký tự; sai thì bỏ qua). **Không** tự chống trùng: việc này gắn với dữ liệu nghiệp vụ của service |
| Service | Chống trùng thật sự |

**Trong code:** `idempotencyKey()` trong `src/gateway/gateway-handler.ts`; test "ignores an over-long Idempotency-Key" trong `gateway-handler.spec.ts`.

**Cách service cài đặt (khi làm service thật):**
1. Có collection/bảng `idempotency_keys` với **unique index** trên `(key, operationId)` (cùng mã nhưng khác thao tác là hai việc khác nhau).
2. Nhận request có key → tìm bản ghi:
   - **Đã có và đã xong:** trả lại kết quả đã lưu (cùng status, cùng body).
   - **Chưa có:** xử lý, rồi lưu `key → kết quả` **trong cùng transaction** với dữ liệu nghiệp vụ. Nếu lưu riêng thì có thể đơn đã tạo mà key chưa lưu, và retry lại tạo trùng.
3. Lưu kèm **thời hạn** (VD 24h), hết hạn thì xoá (TTL index của MongoDB).

**Các trường hợp khó (hay bị hỏi sâu):**
| Tình huống | Xử lý |
|---|---|
| **Cùng key, body khác** (client dùng sai mã) | Lưu kèm hash của body; khác hash thì trả **422** (không xử lý) |
| **Hai request cùng key đến cùng lúc** (lần đầu chưa xong) | Unique index chặn bản ghi thứ hai; lưu trạng thái `processing` → request sau trả **409** (hoặc chờ) |
| **Lần đầu xử lý lỗi** | Lỗi tạm thời (5xx, timeout) → **không** lưu kết quả để client retry được; lỗi nghiệp vụ chắc chắn (4xx) → có thể lưu để trả lại y hệt |
| **Key hết hạn rồi client mới retry** | Coi như request mới; chọn thời hạn dài hơn khoảng thời gian retry hợp lý |

**Phân biệt với `x-request-id`:**
| | `x-request-id` | `Idempotency-Key` |
|---|---|---|
| Mục đích | Truy vết log | Chống xử lý trùng |
| Ai sinh | Gateway (hoặc client) | Client |
| Khi retry | Mỗi lần một mã **mới** | **Giữ nguyên** mã |
| Ai dùng | Mọi service ghi log | Service xử lý thao tác ghi |

**Liên hệ các phần khác:**
- **Timeout 504** (#14): gateway trả 504 nhưng service vẫn có thể xử lý xong, đây là lý do chính cần key.
- **Retry tự động ở gateway** (Bước 5): chỉ retry `POST` khi có `Idempotency-Key`.
- **RabbitMQ** (#22): message có thể bị giao lặp (at-least-once); consumer chống trùng theo cùng ý tưởng nhưng dùng **id của message** thay cho header của client.
- **Ví dụ ngoài đời:** Stripe API bắt buộc kiểu này cho thanh toán; IETF có bản nháp chuẩn hoá header `Idempotency-Key`.

**Câu hỏi phỏng vấn**
- Idempotency là gì? Method HTTP nào idempotent?
- Làm sao để `POST` thanh toán retry an toàn?
- Vì sao gateway không tự chống trùng mà để service làm?
- Cùng key nhưng body khác thì xử lý thế nào? Hai request cùng key đến đồng thời thì sao?
- Vì sao phải lưu key cùng transaction với dữ liệu nghiệp vụ?
- `Idempotency-Key` khác `x-request-id` thế nào?

**Mẫu trả lời ngắn:**
> Idempotency-Key là mã duy nhất client gắn vào một thao tác không idempotent như POST, và giữ nguyên khi retry. Service lưu mã cùng kết quả trong cùng transaction với dữ liệu; gặp lại mã thì trả kết quả cũ thay vì xử lý lại. Nhờ vậy client retry an toàn khi timeout hay mất mạng mà không tạo trùng đơn hay trừ tiền hai lần. Trong dự án, gateway chỉ chuyển mã xuống service qua `meta.idempotencyKey`; việc chống trùng nằm ở service vì gắn với dữ liệu nghiệp vụ.

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 28. Đường đi của response: service → gateway → client

**Tóm tắt:** Response đi ngược qua 4 tầng, mỗi tầng làm đúng một việc. **Transport phân loại lỗi, handler dịch sang HTTP, controller chỉ ghi ra.** Đổi TCP sang RabbitMQ/gRPC thì chỉ thay tầng 2.

```
Service (@MessagePattern)
   │  return value   |   throw RpcException({...})
   ▼
[1] Dây TCP (NestJS)          gói JSON { id, response | err, isDisposed }
   ▼
[2] TcpTransport.send()       trả kết quả, hoặc ném 1 trong 4 lỗi Rpc*        (phân loại)
   ▼
[3] GatewayHandler.handle()   failover? → OutgoingResponse { status, headers, body }  (dịch sang HTTP)
   ▼
[4] GatewayController.proxy() reply.status().headers().send(JSON.stringify(body))     (ghi ra)
```

### Tầng 1: service trả lời qua TCP

Service chỉ có hai cách kết thúc handler:

| Service làm | NestJS gửi về gateway |
|---|---|
| `return value` | `{ id, response: value, isDisposed: true }` |
| `throw new RpcException({...})` | `{ id, err: {...}, isDisposed: true }` |
| Không có `@MessagePattern` khớp | `{ id, err: "There is no matching message handler defined in the remote service." }` |

- **`id`** do `ClientProxy` của gateway gắn lúc gửi. Nhờ `id`, nhiều request chạy **song song trên cùng một socket** mà client vẫn biết response nào của request nào (multiplexing). Đó là lý do gateway chỉ cần **một socket cho mỗi `host:port`** (connection pool).
- Mọi thứ đi qua dây là **JSON**: lỗi về tới gateway là **object thường**, không còn là `Error`, không dùng `instanceof` được.

### Tầng 2: `TcpTransport` nhận và phân loại

```ts
return await firstValueFrom(client.send(pattern, payload).pipe(timeout(timeoutMs)), {
  defaultValue: undefined,
});
```

- `client.send()` trả **Observable**, emit `response` khi gói có `id` khớp quay về.
- `timeout(timeoutMs)` bao **cả thời gian kết nối lẫn thời gian chờ trả lời**.
- `defaultValue: undefined`: handler trả `undefined` thì Observable kết thúc không emit; thiếu dòng này `firstValueFrom` ném `EmptyError`.

**Thành công:** trả nguyên `response`, không bọc gì. **Thất bại:** phân loại thành 4 loại (chưa nghĩ tới HTTP):

| Lỗi | Khi nào | Nhận biết bằng |
|---|---|---|
| `RpcTimeoutError` | Quá `timeoutMs` chưa có response | `TimeoutError` của rxjs |
| `RpcConnectionError` | Không kết nối được / mất kết nối | `error.code` (`ECONNREFUSED`, `ECONNRESET`...) hoặc `"Connection closed"` |
| `RpcPatternNotHandledError` | Service sống nhưng không có handler cho pattern | `err` đúng bằng chuỗi `NO_MESSAGE_HANDLER` |
| `RpcRemoteError` | Service ném `RpcException` | Còn lại; giữ nguyên `payload` |

- `RpcConnectionError.delivered`: `false` = **chắc chắn chưa tới** service (an toàn để failover); `true` = **có thể đã xử lý**.
- Lỗi kết nối → **evict** client khỏi pool (vì `ClientTCP` cache cả promise kết nối thất bại).

### Tầng 3: `GatewayHandler` dịch sang HTTP

**Failover trước** (`sendWithFailover`): chỉ thử instance kế khi `RpcConnectionError` và `delivered === false`. Mọi lỗi khác ném ngay (xem mục 14).

**Thành công:**
- Status lấy **từ spec** (`route.successStatus`), không từ service, vì message RPC không có HTTP status.
- `204` → không body. Còn lại → `body = result ?? null`, `content-type: application/json`.
- Luôn kèm header request-id.

**Thất bại:** `toGatewayError` là **chỗ duy nhất** quyết định mã HTTP:

| Lỗi | HTTP | `code` |
|---|---|---|
| `RpcTimeoutError` | 504 | `UPSTREAM_TIMEOUT` |
| `RpcConnectionError` | 502 | `UPSTREAM_UNAVAILABLE` |
| `RpcPatternNotHandledError` | 502 | `PATTERN_NOT_HANDLED` |
| `RpcRemoteError` **đúng hợp đồng** | `statusCode` service đưa | `code` service đưa (mặc định `UPSTREAM_ERROR`) |
| `RpcRemoteError` sai hợp đồng | 502 | `UPSTREAM_ERROR` (chỉ log chi tiết) |
| Lỗi của chính gateway | 500 | `INTERNAL_ERROR` (không lộ chi tiết) |

"Đúng hợp đồng" = payload khớp `GatewayRpcError` (`contracts.ts`), kiểm bằng `asRemoteError`: `statusCode` là số nguyên **400–599**, `message`/`code` là chuỗi. Service vì vậy **tự chọn được mã lỗi nghiệp vụ** (404, 409...), còn lỡ ném `Error` thường thì client chỉ thấy 502.

Mọi lỗi đi qua `toProblem()` thành **RFC 9457** `application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Not Found",
  "status": 404,
  "detail": "User missing not found",
  "instance": "/users/missing",
  "code": "USER_NOT_FOUND",
  "requestId": "..."
}
```

### Tầng 4: controller ghi ra

`GatewayController.proxy()` chỉ `reply.status(...).headers(...)` rồi `send(JSON.stringify(body))`. Tự `stringify` để body `null` vẫn ra chuỗi `"null"` hợp lệ thay vì rỗng; `body === undefined` (204) thì `send()` không body.

### Ví dụ chạy thật với echo-service

| Request | Service làm gì | Client nhận |
|---|---|---|
| `GET /users/42` | `return { echo: req }` | **200** (từ spec) + `{ "echo": ... }` |
| `GET /users/missing` | `throw RpcException({ statusCode: 404, code: 'USER_NOT_FOUND' })` | **404** problem+json |
| `GET /users/slow` | ngủ 12s > timeout 10s | **504** `UPSTREAM_TIMEOUT` |
| `auth.logout` | không ai đăng ký pattern | **503** `NO_INSTANCE` (lỗi **trước** khi gửi, không qua đường response) |
| echo tắt | `ECONNREFUSED` | failover sang instance khác; hết instance → **502** |

**Câu hỏi phỏng vấn**
- Nhiều request dùng chung một socket TCP, làm sao gateway biết response nào thuộc request nào?
- Vì sao lỗi service ném ra về tới gateway không còn là `Error`? Gateway phân loại lỗi bằng gì?
- Message RPC không có HTTP status, vậy status thành công và status lỗi đến từ đâu?
- Vì sao tách "phân loại lỗi" (transport) khỏi "chọn mã HTTP" (handler)?
- Service ném `Error` thường thay vì `RpcException` theo hợp đồng thì client thấy gì? Vì sao không trả nguyên message?
- 502, 503, 504 trong dự án này mỗi mã ứng với tình huống nào?

**Trong code:**
- `src/gateway/transport/tcp-transport.ts`: `send()` nhận response, phân loại lỗi, evict client hỏng.
- `src/gateway/transport/types.ts`: 4 lớp lỗi `Rpc*`, cờ `delivered`.
- `src/gateway/gateway-handler.ts`: `sendWithFailover`, nhánh thành công (dòng "5. Thành công"), `toGatewayError`, `asRemoteError`.
- `src/gateway/problem.ts`: `GatewayError`, `toProblem` (RFC 9457).
- `src/gateway.controller.ts`: ghi `OutgoingResponse` ra Fastify.
- `src/gateway/contracts.ts`: `GatewayRpcError`, hợp đồng lỗi service phải theo.

**Bẫy thực tế:** xem thêm mục 6 (lỗi mất kiểu qua JSON, client TCP cache kết nối hỏng, `EmptyError` khi handler trả `undefined`).

**Mẫu trả lời ngắn:**
> Service trả lời qua TCP bằng gói JSON có `id` khớp với request, nên nhiều request dùng chung một socket được. Ở gateway, transport chỉ làm một việc: trả kết quả, hoặc phân loại lỗi thành timeout, mất kết nối, không có handler, hay lỗi từ service. Handler mới là nơi duy nhất dịch sang HTTP: thành công thì status lấy từ spec, lỗi nghiệp vụ theo hợp đồng thì dùng `statusCode` của service, còn lại là 502/504, và mọi lỗi đều ra `problem+json`. Tách như vậy để đổi transport không phải sửa logic HTTP.

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## Từ điển nhanh

| Thuật ngữ | Nghĩa ngắn |
|---|---|
| Reverse proxy | Nhận request thay cho server thật, chuyển tiếp rồi trả kết quả |
| Upstream | Service phía sau mà gateway chuyển request tới |
| North-south traffic | Traffic từ client bên ngoài vào hệ thống |
| East-west traffic | Traffic giữa các service nội bộ |
| Idempotent | Gọi nhiều lần cho kết quả như gọi một lần |
| Idempotency-Key | Mã client gắn vào thao tác ghi, giữ nguyên khi retry, để service không xử lý trùng |
| Hop-by-hop header | Header chỉ có nghĩa giữa hai nút kề nhau |
| Atomic swap | Đổi cấu hình cũ sang mới trong một bước, không có trạng thái nửa vời |
| Fail-open / fail-closed | Khi thành phần phụ chết: cho qua / chặn lại |
| Vendor extension | Field `x-...` tự định nghĩa trong OpenAPI |
| Stale-on-error | Dùng dữ liệu cũ khi không làm mới được |
| Protocol translation | Gateway đổi giao thức (HTTP → TCP RPC) thay vì chuyển nguyên request |
| Capability-based discovery | Tìm service theo việc nó làm được (pattern), không theo tên |
| RFC 9457 | Chuẩn body lỗi `application/problem+json` (type, title, status, detail, instance) |
| Connection pool | Giữ và tái sử dụng kết nối thay vì mở mới mỗi request |
| Correlation id (`id` trong gói TCP) | Mã ghép response với đúng request khi nhiều request chạy chung một socket |
| Multiplexing | Nhiều request/response đan xen trên cùng một kết nối |
| BFF | Backend for Frontend: gateway riêng cho từng loại client |
| Outbox pattern | Ghi dữ liệu và event cần gửi trong cùng transaction rồi publish sau |
| Saga | Giao dịch nhiều service, mỗi bước có hành động bù |
| 12-factor | Bộ nguyên tắc app cloud, VD cấu hình qua môi trường |

---

## Nhật ký học tập

| Ngày | Đã làm | Điều rút ra | Câu còn mơ hồ |
|---|---|---|---|
| 2026-11-06 | Chốt kiến trúc (operationId = MessagePattern, TCP + discovery, Keycloak + auth worker). Bước 0: bỏ lockfile thừa, sửa `rootDir`. Bước 1: config, spec-loader, route-table + unit test | Control plane gom hết việc nặng và lỗi về lúc khởi động; trie + backtrack theo method; decode sau khi match | |
| 2026-11-06 | Bước 2: catch-all + StaticDiscovery + TcpTransport + RFC 9457 + echo-service; chạy thật end-to-end | Lỗi qua TCP mất kiểu, phải phân loại theo hình dạng; client TCP hỏng phải bỏ khỏi pool; NestJS ghi đè error handler của Fastify | |
| 2026-11-06 | Bước 3: round-robin theo pattern + failover khi chưa gửi được; chạy thật với 2 echo | Failover chỉ an toàn khi chắc chắn chưa gửi; round-robin cần health check mới tránh được instance chết | |
| 2026-11-06 | Thiết kế Service Registry (chưa code); bàn DDD vs hexagonal | Heartbeat = đăng ký lại (soft state); snapshot + ETag thay cho cache theo request; "không phụ thuộc framework" khác "đa ngôn ngữ" | |
| 2026-11-06 | Đọc lại đường đi của response từ service về gateway (mục 28) | Transport phân loại, handler dịch sang HTTP; `id` trong gói TCP cho phép dùng chung socket; status thành công lấy từ spec | |
| 2026-11-06 | Bước 7: Service Registry + client trong echo-service + `RegistryDiscovery`; chạy thật 6 kịch bản | Poll `setTimeout` nối tiếp + ETag; stale-on-error; khởi động khi registry chết vẫn mở cổng (fail-fast chỉ cho lỗi cấu hình). Chi tiết: `apps/service-discovery/knowledge.html` | |
| 2026-11-07 | Gỡ StaticDiscovery, `discovery.local.json`, `GATEWAY_DISCOVERY_FILE`: gateway chỉ đọc instance từ registry | Nhờ interface `ServiceDiscovery`, gỡ adapter cũ không đụng `GatewayHandler`; e2e dùng discovery giả trong bộ nhớ thay vì file fixture | |
