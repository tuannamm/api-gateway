# PLAN: API Gateway contract-first

> Mục tiêu: build một API Gateway **tái sử dụng được** cho nhiều project. Mỗi project chỉ cần một file OpenAPI (`.yml`). Gateway đọc URL từ đó, dùng `operationId` (chính là `@MessagePattern` của service) để biết request thuộc service nào, tìm instance qua Service Discovery, rồi gửi message RPC qua TCP.
> Mục tiêu học: vừa build vừa hiểu concept để ôn phỏng vấn microservices. Kiến thức được theo dõi ở [KNOWLEDGE.md](./KNOWLEDGE.md).

---

## 1. Các quyết định đã chốt

| # | Quyết định | Ghi chú |
|---|---|---|
| 1 | File OpenAPI là **nguồn sự thật duy nhất** (contract-first) | Gateway sinh bảng route từ file này |
| 2 | **`operationId` bắt buộc** ở mọi operation | Thiếu là gateway **không khởi động** |
| 3 | `operationId` là **string tự do** (không rỗng, không trùng, không có khoảng trắng đầu/cuối) | VD `getUserById`, `user.getById` đều hợp lệ |
| 4 | **`operationId` = `@MessagePattern`** trong controller của service | Gateway gửi đúng pattern này xuống service |
| 4b | **Gateway hỏi registry "ai xử lý pattern này?"** | Mỗi service khai báo danh sách pattern khi đăng ký. Spec không ghi tên service (mục 8) |
| 5 | **Transport: TCP + Service Discovery** | Gateway là **bộ dịch giao thức HTTP → RPC**, không phải HTTP reverse proxy (mục 4) |
| 6 | Xử lý request bằng **catch-all handler** | Không viết controller theo từng route |
| 7 | **Service Discovery là project riêng** | Gateway chỉ là client qua 1 interface (mục 8) |
| 8 | **Một instance gateway = một project**, chọn bằng env `GATEWAY_PROJECT` | Mỗi project đúng **một** file spec (mục 12) |
| 9 | Lỗi theo **RFC 9457** (`application/problem+json`) | Mọi lỗi kèm `requestId` |
| 10 | Auth: **Keycloak + auth worker**; gateway chỉ verify JWT cục bộ | Mục 10 |
| 11 | Nền HTTP: NestJS (Fastify adapter) | Core viết framework-agnostic để tái sử dụng |
| 12 | **Không làm** ở gateway: API versioning, contract test spec vs service, WebSocket/SSE (khi nào cần mới làm), tối ưu hiệu năng (sau khi đưa vào dùng) | Người viết spec chịu trách nhiệm spec chính xác |
| 13 | Registry lưu **in-memory** (soft state) | Registry khởi động lại thì service tự đăng ký lại qua heartbeat (mục 8) |
| 14 | Code tự đăng ký là **lib dùng chung** `libs/service-discovery-client` (`@org/service-discovery-client`) | Khác hợp đồng (vài dòng type, copy được): đây là logic có timer, retry, đọc metadata NestJS; copy sẽ lệch nhau. Lib được đóng gói vào từng service khi build |
| 15 | Gateway **đồng bộ snapshot nền** từ registry (ETag/304) | Data plane chỉ đọc bộ nhớ; registry chết thì giữ bản cũ |
| 16 | Gateway khởi động khi registry chết: **vẫn chạy, thử lại nền** | Chọn AP: registry chết không kéo gateway chết theo (bảng rỗng → 503 tới khi đồng bộ được) |
| 17 | **Không dùng DDD chiến thuật cho gateway**; tổ chức theo hexagonal | Gateway là hạ tầng, không có domain. DDD dành cho service nghiệp vụ (mục 4) |

---

## 2. Gateway là gì và không phải là gì

- Là **điểm vào duy nhất** của hệ thống, đứng giữa client và các service.
- **Không** chứa business logic. Gateway "béo" là anti-pattern: nó thành monolith ở cửa trước và là single point of failure.
- Khác Nginx thuần: Nginx route theo cấu hình tĩnh ở tầng HTTP. Gateway này route theo **hợp đồng API (OpenAPI)**, áp policy theo từng operation, và **dịch** HTTP sang message RPC.

Lý do cần gateway:
- Client không cần biết có bao nhiêu service, ở đâu, nói giao thức gì.
- Auth, rate limit, logging làm một lần ở gateway.
- Đổi hoặc tách service mà không ảnh hưởng client.

---

## 3. Chức năng chính mà gateway đem lại

Cột "Nguồn cấu hình" cho thấy tính năng nào được điều khiển từ file OpenAPI (đúng tinh thần contract-first).

### Nhóm 1: Định tuyến và dịch giao thức (cốt lõi)
| Chức năng | Làm gì | Nguồn cấu hình | Bước |
|---|---|---|---|
| **Routing** | Khớp `method + path` với route trong spec; tự trả 404/405 | `paths` | 1 |
| **Pattern resolution** | Hỏi registry: instance nào xử lý `operationId` này (đồng bộ snapshot nền) | `operationId` | 2, 3 |
| **Load balancing** | Round-robin theo từng `pattern` | - | 3 ✅ |
| **Failover** | Instance chắc chắn chưa nhận request (`ECONNREFUSED`…) thì thử instance kế | `GATEWAY_FAILOVER_MAX_ATTEMPTS` | 3 ✅ |
| **Protocol translation** | Dựng payload từ HTTP, gửi `send(pattern, payload)` qua TCP, map kết quả về HTTP | `responses` (status 2xx) | 2 |
| **Connection pool** | Giữ kết nối TCP theo `host:port`, đóng khi instance biến mất | - | 2, 3 |

### Nhóm 2: Bảo vệ và kiểm soát traffic
| Chức năng | Làm gì | Nguồn cấu hình | Bước |
|---|---|---|---|
| **Authentication** | Verify JWT của Keycloak, đưa `user` vào payload | `security` | 4 |
| **Phân quyền thô** | Kiểm tra role | `x-roles` (tuỳ chọn) | 4 |
| **Request validation** | Validate path/query/body theo schema, sai trả 400 | `parameters`, `requestBody` | 4 |
| **Rate limiting** | Giới hạn số request, trả 429 + `Retry-After` | `x-rate-limit` | 4 |
| **Giới hạn an toàn** | Body tối đa, Content-Type, timeout (mục 11) | env, `x-timeout` | 2, 4 |
| **CORS / security headers** | Chuẩn hoá một lần cho mọi service | env | 4 |

### Nhóm 3: Chịu lỗi (resilience)
| Chức năng | Làm gì | Nguồn cấu hình | Bước |
|---|---|---|---|
| **Timeout RPC** | Không chờ service vô hạn (504) | env, `x-timeout` | 2 |
| **Retry** | Chỉ với thao tác idempotent, có backoff + jitter | `x-retry` | 5 |
| **Circuit breaker** | Ngừng gọi service đang hỏng, phục hồi từ từ | env | 5 |
| **Stale-on-error** | Registry chết thì dùng cache instance cũ | - | 7 |

### Nhóm 4: Quan sát và vận hành
| Chức năng | Làm gì | Bước |
|---|---|---|
| **Request id** | Sinh/nhận `x-request-id`, đưa vào payload và response | 2 |
| **Structured log + metrics** | Log JSON, số request, lỗi, latency p50/p95/p99 | 5 |
| **Health endpoint** | Liveness và readiness của chính gateway | 5 |
| **Hot reload spec** | Đổi spec không cần restart, atomic swap | sau 1 |
| **Cấu hình theo project** | Chọn spec bằng `GATEWAY_PROJECT` | 1 |
| **Graceful shutdown** | Hoàn tất request đang xử lý, đóng kết nối TCP trước khi thoát | 6 |

### Giá trị mang lại
- **Cho client:** một địa chỉ HTTP duy nhất, không cần biết service ở đâu và nói giao thức gì.
- **Cho service:** không phải tự làm auth, rate limit, CORS, mở HTTP; chỉ cần viết `@MessagePattern`.
- **Cho vận hành:** quan sát, giới hạn và bảo vệ tập trung ở một điểm.
- **Cho nhiều project:** spec là thứ duy nhất khác nhau; mã gateway dùng lại nguyên vẹn.

### Ngoài phạm vi (gateway KHÔNG làm)
| Việc | Lý do | Ai làm |
|---|---|---|
| Business logic | Gateway "béo" thành monolith ở cửa trước | Các service |
| Login, logout, refresh, CRUD user, gọi Keycloak Admin API | Nghiệp vụ định danh | auth worker |
| Service registry (đăng ký, heartbeat, health) | Hệ thống riêng (mục 8) | `apps/service-discovery` |
| Kết nối RabbitMQ / publish event | Event là giao tiếp giữa service; gateway chỉ lo request của client | Các service |
| Lưu dữ liệu nghiệp vụ | Gateway stateless để scale ngang | Các service |

---

## 4. Kiến trúc tổng thể

```
                                         ┌────────────────────┐
  user-service ─── register/heartbeat ─► │  Service Registry  │
   (patterns: getUserById, createUser)   │   (project riêng)  │
  order-service, auth worker ────────►   └─────────▲──────────┘
       ▲                                           │ ai xử lý ("shop", "getUserById")? (cache)
       │ TCP: send('user.getById', payload)  ┌─────┴────────┐
       └──────────────────────────────────── │ API Gateway  │ ◄──HTTP── Client
                                             └──────────────┘
  RabbitMQ: chỉ dùng cho event giữa các service, gateway không kết nối.
  Keycloak: chỉ auth worker gọi; gateway chỉ tải public key (JWKS) để verify token.
```

### Protocol translation thay cho reverse proxy
Service **không mở API HTTP** cho gateway. Nó chỉ lắng nghe message:

```ts
// user-service
@MessagePattern('user.getById')
getById(@Payload() req: GatewayRequest) { ... }
```

Gateway nhận HTTP, dựng payload, gửi message, đợi kết quả, rồi trả HTTP cho client. Vì vậy các khái niệm của HTTP proxy (hop-by-hop headers, streaming body, path rewrite, `X-Forwarded-*`) **không áp dụng**: path chỉ tồn tại ở phía gateway.

### Tổ chức code: hexagonal, không phải DDD
- **Lõi không phụ thuộc NestJS** = các file lõi (`src/gateway/`) không `import` NestJS, chỉ là TypeScript thuần trên Node. NestJS là **lớp vỏ** nhận HTTP rồi gọi vào lõi.
  - Lợi ích: test không cần dựng framework (VD điều khiển clock thay vì chờ TTL thật); đổi framework HTTP chỉ phải viết lại lớp vỏ.
  - **Không** có nghĩa là dùng được với ngôn ngữ khác.
- **Khả năng đa ngôn ngữ phụ thuộc giao thức**, không phụ thuộc cách tổ chức code:
  - Service → Registry: HTTP + JSON → service ngôn ngữ nào cũng đăng ký được.
  - Gateway → Service: TCP của NestJS → service phía sau gần như phải là NestJS (đánh đổi đã chấp nhận; thay được bằng một transport adapter khác, VD gRPC, mà không sửa handler).
- Ánh xạ hexagonal: lõi = `GatewayHandler`, `RouteTable`, `RoundRobinBalancer`; port = `ServiceDiscovery`, `RpcTransport`, `LoadBalancer`; adapter phía ra = `RegistryDiscovery`, `TcpTransport`; adapter phía vào = controller, filter, `create-app.ts`.
- **Không dùng DDD chiến thuật** (entity, aggregate, repository) cho gateway vì không có domain nghiệp vụ. DDD dùng trong service nghiệp vụ (order, payment...); chia hệ thống thành microservices chính là DDD chiến lược (mỗi service một bounded context).

---

## 5. Hai "mặt phẳng": control plane và data plane

| | Control plane | Data plane |
|---|---|---|
| Việc | Chuẩn bị: đọc spec, validate, dựng route table | Xử lý từng request thật |
| Khi nào | Lúc khởi động và khi spec đổi (hot reload) | Mỗi request |
| Yêu cầu | Đúng, fail sớm | Nhanh, không I/O thừa |

Nguyên tắc: **việc nặng làm ở control plane một lần** (parse yml, validate, build trie). Data plane chỉ tra cứu trong bộ nhớ. Danh sách instance cũng được đồng bộ ở nền; request không gọi registry trực tiếp.

---

## 6. Vòng đời một request (data plane)

```
Client: GET /users/42?active=true   (Authorization: Bearer ...)

 1. Catch-all handler nhận request; lấy hoặc sinh x-request-id
 2. RouteTable.match(GET, /users/42)
      → khớp:  { operationId: "user.getById", params: { id: "42" } }
      → không khớp path: 404; khớp path sai method: 405 + Allow
 3. (Bước 4) Auth theo `security`, validate, rate limit
 4. Dựng payload GatewayRequest (allowlist, mục 7)
 5. Discovery: ai xử lý ("shop", "user.getById")? → [10.0.0.5:4001, ...] (cache); rỗng → 503
 6. Round-robin (theo pattern) cho ra thứ tự thử [A, B, C]
 7. ClientTCP(host:port).send("user.getById", payload) với timeout
      chưa kết nối được (ECONNREFUSED…) → thử instance kế (failover), tối đa GATEWAY_FAILOVER_MAX_ATTEMPTS
      lỗi khác (timeout, đứt giữa chừng, lỗi service) → KHÔNG thử lại
 8. Map kết quả:
      thành công → status 2xx lấy từ spec + body
      service ném RpcException({statusCode,...}) → problem+json với statusCode đó
      không kết nối được → 502, quá timeout → 504
 9. Gắn x-request-id vào response
```

---

## 7. Hợp đồng message giữa gateway và service

**Nguồn chuẩn:** `src/gateway/contracts.ts`. Không có lib dùng chung: mỗi service giữ một **bản copy** (VD `apps/echo-service/src/contracts.ts`) kèm chú thích trỏ về nguồn chuẩn. Đổi hợp đồng thì cập nhật bản copy ở các service.

```ts
interface GatewayRequest<TBody = unknown> {
  params: Record<string, string>;            // đã decode
  query: Record<string, string | string[]>;  // key lặp lại → mảng
  body?: TBody;
  user?: GatewayUser;                        // Bước 4: từ JWT đã verify
  meta: { requestId: string; operationId: string; project: string; idempotencyKey?: string };
}

interface GatewayRpcError { statusCode: number; message: string; code?: string; details?: unknown }
```

- Gateway **tự dựng payload từ đầu** (allowlist), không chuyển nguyên header của client. Client không thể giả `user` hay header nội bộ.
- **Thành công:** service trả data; gateway trả status = mã 2xx nhỏ nhất khai báo trong `responses` (mặc định 200). 204 thì không có body. Service trả `undefined` thì body là `null`.
- **Lỗi nghiệp vụ:** service ném `new RpcException({ statusCode, message, code } satisfies GatewayRpcError)`; gateway trả `problem+json` với `statusCode` và `code` đó.

### Bảng mã lỗi do gateway trả (body RFC 9457, luôn có `code` và `requestId`)
| Mã | `code` | Khi nào | Bước |
|---|---|---|---|
| 400 | `INVALID_PATH` | Path có percent-encoding hỏng | 2 ✅ |
| 400 | `BAD_REQUEST` | Body JSON hỏng | 2 ✅ |
| 400 | (sẽ định nghĩa) | Request sai schema | 4 |
| 401 / 403 | (sẽ định nghĩa) | Thiếu/sai token / không đủ quyền | 4 |
| 404 | `ROUTE_NOT_FOUND` | Không có route | 2 ✅ |
| 405 | `METHOD_NOT_ALLOWED` | Có path nhưng sai method (kèm `Allow`) | 2 ✅ |
| 413 | `PAYLOAD_TOO_LARGE` | Body vượt `GATEWAY_BODY_LIMIT` | 2 ✅ |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Body không phải `application/json` | 2 ✅ |
| 429 | (sẽ định nghĩa) | Vượt rate limit | 4 |
| 4xx/5xx | `code` của service | Service ném `RpcException` đúng hợp đồng | 2 ✅ |
| 500 | `INTERNAL_ERROR` | Lỗi của chính gateway (chỉ log chi tiết, không trả cho client) | 2 ✅ |
| 502 | `UPSTREAM_UNAVAILABLE` | Không kết nối được instance | 2 ✅ |
| 502 | `PATTERN_NOT_HANDLED` | Service không có `@MessagePattern` cho `operationId` (spec và service lệch) | 2 ✅ |
| 502 | `UPSTREAM_ERROR` | Service ném lỗi không theo hợp đồng | 2 ✅ |
| 503 | `NO_INSTANCE` | Không có instance nào xử lý pattern | 2 ✅ |
| 504 | `UPSTREAM_TIMEOUT` | Service không trả lời trong `GATEWAY_RPC_TIMEOUT_MS` | 2 ✅ |

---

## 8. Service Discovery và ranh giới với gateway

**Tra theo pattern, không theo tên service.** Spec chỉ có `operationId`. Mỗi service khi đăng ký khai báo các `@MessagePattern` nó xử lý; gateway hỏi registry "instance nào xử lý pattern X?". Mỗi project application có **registry riêng**, nên registry và `ServiceDiscovery` không có khái niệm project (đổi ngày 2026-11-07, xem `apps/service-discovery/documents/PLAN.md` mục 10d).

```ts
interface ServiceDiscovery {
  /** Instance healthy xử lý `pattern`. Rỗng → gateway trả 503. */
  resolve(pattern: string): Promise<Instance[]>;
  watch?(project: string, cb: (table: Map<string, Instance[]>) => void): () => void;
}

interface Instance {
  id: string;
  service: string;    // tên service (để log, metrics, circuit breaker theo service)
  host: string;
  port: number;       // cổng TCP của microservice
  metadata?: Record<string, string>;
}
```

Dữ liệu đăng ký (service gửi lên registry):
```json
{ "service": "user", "id": "user-1", "host": "10.0.0.5", "port": 4001,
  "patterns": ["user.getById", "user.create"] }
```

- Registry phục vụ **đúng một project**: không có phạm vi project khi tra pattern.
- **Một pattern chỉ thuộc một service** trong registry. Registry từ chối đăng ký nếu service khác đã giữ pattern đó (tránh hai service cùng nhận một request).
- API registry, cơ chế heartbeat/TTL và cách gateway đồng bộ: xem **mục 16 (Kế hoạch Service Registry)**.
- NestJS không tự liệt kê `@MessagePattern`; `registry-client` tự thu thập bằng `DiscoveryService` + `MetadataScanner` của NestJS.
- Đánh đổi: gateway **không kiểm tra được lúc khởi động** pattern nào chưa có service xử lý (registry thay đổi liên tục), chỉ biết lúc request (503). Gateway log lại danh sách pattern chưa có ai xử lý mỗi khi snapshot thay đổi.
- Lộ trình: `StaticDiscovery` (Bước 2, file JSON tạm) → registry riêng (`apps/service-discovery`, ✅) → `RegistryDiscovery` (✅ Bước 7, `src/gateway/discovery/registry-discovery.ts`). Khi đã có registry, **`StaticDiscovery` và `GATEWAY_DISCOVERY_FILE` đã bị gỡ**: gateway chỉ còn một nguồn instance (`GATEWAY_REGISTRY_URL`, bắt buộc). Test dùng `ServiceDiscovery` giả viết ngay trong file test.
- Với registry, gateway giữ **snapshot trong RAM** và **stale-on-error** (registry lỗi thì dùng bản cũ).

---

## 9. Từ OpenAPI sang route (control plane)

```yaml
paths:
  /users/{id}:
    get:
      operationId: user.getById      # = @MessagePattern('user.getById'), string tự do
      responses:
        '200': { description: OK }   # successStatus = 200
```

### 9.1 Fail-fast lúc khởi động
Gom **tất cả** lỗi rồi báo một lần:
- Spec không hợp lệ theo OpenAPI
- Thiếu `operationId`
- `operationId` trùng nhau
- `operationId` rỗng hoặc có khoảng trắng đầu/cuối (sẽ không bao giờ khớp `@MessagePattern`)
- Hai route cùng method, chỉ khác tên tham số (`/items/{id}` và `/items/{itemId}`)

### 9.2 RouteTable: segment trie
- Mỗi segment path là 1 node; `{id}` là node tham số.
- Segment **tĩnh được ưu tiên** trước tham số (`/users/me` thắng `/users/{id}`), có backtrack.
- Tên tham số lưu ở **lá**, nên `/users/{id}` và `/users/{userId}/orders` cùng tồn tại.
- Mỗi lá có map `method → route`, phân biệt 404 và 405.
- Match O(số segment), không phụ thuộc số route.
- Chuẩn hoá: bỏ query string, bỏ `/` cuối, decode param an toàn.

---

## 10. Auth: Keycloak + auth worker

| Thành phần | Trách nhiệm |
|---|---|
| **Keycloak** | Identity provider: lưu thông tin đăng nhập, phát và ký token, quản lý session |
| **auth worker** (service riêng, có collection `user`) | Login, logout, refresh, CRUD user; nơi **duy nhất** gọi Keycloak; liên kết user qua `keycloakId` = `sub` |
| **Gateway** | Chỉ **verify** token mỗi request; không login, không biết collection `user` |

```
Login:   Client ─POST /auth/login─► Gateway ─TCP 'auth.login'─► auth worker ─► Keycloak
         (security: [] → không đòi token)                         ◄── access + refresh token
Gọi API: Client ─GET /orders (Bearer)─► Gateway verify bằng JWKS (cục bộ, có cache)
                                        → payload.user = { sub, roles } ─TCP─► order service
Logout:  Client ─POST /auth/logout─► Gateway ─TCP 'auth.logout'─► auth worker ─► Keycloak
```

- Route `/auth/*` khai báo trong spec như mọi route khác; gateway không xử lý đặc biệt.
- **Verify cục bộ bằng JWKS**, không hỏi auth worker mỗi request (tránh thêm độ trễ và điểm nghẽn).
- **RS256 + JWKS:** Keycloak công khai public key tại `{issuer}/protocol/openid-connect/certs`; gateway không giữ bí mật nào. Không dùng HS256.
- Kiểm tra chữ ký, `exp`/`nbf`, `iss`, `aud`/`azp`. Cache JWKS, gặp `kid` lạ thì tải lại (xoay khoá). Thư viện `jose`.
- Route công khai: `security: []`. Có `security` toàn cục thì mặc định mọi route cần auth.
- Phân quyền thô theo role (`x-roles`) ở gateway; phân quyền theo dữ liệu ở service.
- **Logout và JWT stateless:** access token vẫn hợp lệ tới khi hết hạn. Dùng access token ngắn (~5 phút) + huỷ refresh token khi logout. Thu hồi tức thì (blacklist `jti`, introspection) để sau.
- Env: `GATEWAY_JWT_ISSUER`, `GATEWAY_JWT_AUDIENCE`.

---

## 11. Giới hạn an toàn

| Giới hạn | Mặc định | Env | Lỗi |
|---|---|---|---|
| Kích thước body | 1 MB | `GATEWAY_BODY_LIMIT` | 413 |
| Timeout gọi RPC | 10 s (ghi đè bằng `x-timeout`) | `GATEWAY_RPC_TIMEOUT_MS` | 504 |
| Số instance thử khi failover | 3 (1 = tắt, tối đa 10) | `GATEWAY_FAILOVER_MAX_ATTEMPTS` | 502 khi hết lượt |
| `x-request-id` từ client | ≤ 128 ký tự, `[A-Za-z0-9._-]`; sai thì sinh mới | - | - |
| Payload xuống service | Chỉ allowlist (mục 7) | - | - |
| Content-Type có body | `application/json` | - | 415 |

---

## 12. Cấu hình theo project

```
specs/
├── shop/openapi.yml
├── blog/openapi.yml
└── hr/openapi.yml
```

| Biến | Bắt buộc | Mặc định | Ý nghĩa |
|---|---|---|---|
| `GATEWAY_PROJECT` | Có | - | Tên project, VD `shop` |
| `GATEWAY_SPECS_DIR` | Không | `./specs` | Thư mục chứa các project |
| `GATEWAY_SPEC_FILE` | Không | `openapi.yml` | Tên file trong thư mục project |

- Đường dẫn nạp: `<GATEWAY_SPECS_DIR>/<GATEWAY_PROJECT>/<GATEWAY_SPEC_FILE>`. Mỗi project đúng **một** file.
- Chạy nhiều project = chạy nhiều instance với env khác nhau.
- Fail-fast: thiếu env, thư mục hoặc file không tồn tại → không khởi động, **liệt kê project hiện có**.
- **Chống path traversal:** tên project `[a-z0-9_-]+`; đường dẫn sau `resolve` phải nằm trong `GATEWAY_SPECS_DIR`.
- Vì sao một instance = một project: cô lập lỗi và tải, scale riêng, data plane không cần phân biệt tenant. Đánh đổi: nhiều process hơn.

---

## 13. Ranh giới với kiến trúc event-driven (RabbitMQ)

- Gateway **không kết nối RabbitMQ**. Request/response giữa gateway và service đi qua TCP; event giữa các service đi qua RabbitMQ.
- **Async request:** service có thể trả `202 Accepted` + id để client hỏi trạng thái sau; với gateway chỉ là một response bình thường.
- **Truy vết:** service copy `meta.requestId` vào header của message khi publish event.
- **Idempotency:** gateway đưa `Idempotency-Key` vào `meta.idempotencyKey`; chống xử lý trùng là việc của service.
- Service chỉ làm worker cho event (không có `@MessagePattern` cho client) thì không xuất hiện trong spec.

---

## 14. Các tình huống biên

| Tình huống | Hành vi |
|---|---|
| Không khớp route | 404, không gửi message |
| Khớp path, sai method | 405 + `Allow` |
| Không có instance healthy nào xử lý pattern | 503 |
| Pattern trong spec chưa có service nào đăng ký | Không chặn lúc khởi động (registry là động); 503 lúc request + log rõ pattern |
| Hai service cùng đăng ký một pattern | Registry từ chối đăng ký thứ hai |
| Service có instance nhưng không có `@MessagePattern` tương ứng | Service trả lỗi "no matching handler" → gateway trả 502 và log rõ (lỗi cấu hình spec) |
| Không kết nối được / quá timeout | 502 / 504 |
| Spec đổi lúc đang chạy | Dựng route table mới rồi atomic swap; spec lỗi thì giữ bảng cũ |
| Registry chết | Dùng cache cũ (stale-on-error) |

---

## 15. Lộ trình

| Bước | Nội dung | Khái niệm học được |
|---|---|---|
| 0 ✅ | Dọn repo: một lockfile ở root, sửa `rootDir` cho TypeScript 6 | npm workspaces, Nx project |
| 1 ✅ | Config theo project + SpecLoader + RouteTable (unit test) | Contract-first, trie routing, fail-fast, path traversal |
| 2 ✅ | Catch-all handler + `StaticDiscovery` + TCP transport + request id + timeout + body limit + lỗi RFC 9457; `apps/echo-service` (chạy local, Docker ở Bước 6) | Protocol translation, RPC, connection pool, mã lỗi gateway |
| 3 ✅ | Load balancing (round-robin theo pattern) + failover an toàn (`delivered`) | Round-robin, khi nào retry sang instance khác là an toàn |
| 7 ✅ | Service Registry + `registry-client` + gateway đồng bộ snapshot (mục 16) | Heartbeat, lease TTL, soft state, snapshot sync, stale-on-error, AP |
| 4 | Auth (Keycloak JWKS), validate, rate limit, giới hạn an toàn | JWT, JWKS, token bucket, Redis |
| 5 | Observability + resilience | Log/metrics, retry, circuit breaker, outlier detection |
| 6 | Đóng gói Docker + README "dùng cho project mới" | Cấu hình bằng env, graceful shutdown |

Thứ tự đã thống nhất: **3 → 7 (Registry) → 4 → auth worker → 5, 6.** Registry đi trước auth vì: cache/đồng bộ discovery chỉ có ý nghĩa khi có registry; mọi service mới (kể cả auth worker) sẽ dùng `registry-client` ngay từ đầu thay vì sửa lại sau.

Mỗi bước có plan riêng để duyệt trước khi code. **Code xong thì dừng để bạn review, không tự commit.**

**Cách chạy local:** xem [README.md](./README.md).

**Cấu trúc code sau Bước 2:**
```
src/
├── main.ts                  control plane (buildGateway) → fail-fast → listen
├── create-app.ts            NestJS + Fastify (bodyLimit, chỉ JSON, filter lỗi)
├── gateway.module.ts        đưa Gateway đã dựng vào DI; đóng kết nối khi tắt
├── gateway.controller.ts    catch-all @All('*'), lớp mỏng
├── problem.filter.ts        lỗi Fastify (413/415/400) → RFC 9457
└── gateway/                 CORE, không phụ thuộc NestJS (trừ transport/tcp-transport.ts)
    ├── config.ts, spec-loader.ts, route-table.ts      control plane (Bước 1)
    ├── bootstrap.ts                                   gom control plane
    ├── gateway-handler.ts                             data plane: match → payload → resolve → send → map lỗi
    ├── contracts.ts, request-id.ts, problem.ts
    ├── discovery/ (types, registry-discovery)
    └── transport/ (types, tcp-transport)
```

**Yêu cầu môi trường:** Node **≥ 24.9**. NestJS 12 và một dependency của `swagger-parser` là ESM-only; Jest chỉ load được chúng trên Node ≥ 24.9 (Node 22 vẫn chạy app được, nhưng test không chạy được).

---

## 16. Kế hoạch Service Registry (Bước 7, ✅ đã làm)

> Đã triển khai. Thiết kế chi tiết, quyết định phát sinh khi code và kết quả chạy thật: `apps/service-discovery/documents/PLAN.md`. Khác plan bên dưới: **không có project trong registry** (mọi URL bỏ `/projects/:project`, `resolve(pattern)`); client là lib `libs/service-discovery-client` (không phải `packages/registry-client`).

**Bối cảnh:** gateway đang đọc instance từ file tĩnh: thêm/bớt instance phải sửa file và restart; instance chết vẫn nằm trong danh sách nên round-robin vẫn chọn nó (hạn chế của Bước 3).

**Mục tiêu:** service **tự đăng ký** kèm danh sách `@MessagePattern`, giữ đăng ký bằng **heartbeat**, hết **TTL** thì bị gỡ; gateway **đồng bộ snapshot** ở nền.

```
echo-1 ─┐ PUT /v1/instances/echo-1   (đăng ký + heartbeat mỗi 5s, kèm patterns)
echo-2 ─┤
        ▼
  Service Registry  (in-memory, lease TTL 15s, quét hết hạn mỗi TTL/3)
        ▲
        │ GET /v1/snapshot   (mỗi 3s, If-None-Match → 304 nếu không đổi)
  API Gateway: snapshot trong RAM → resolve() chỉ đọc bộ nhớ
```

Làm theo **3 phần, dừng sau mỗi phần để review, không commit.**

### Phần 1: `apps/service-discovery` (NestJS, cổng 8500)

App đã được bạn scaffold sẵn; làm theo đúng khung đó:
- **ESM** (`"type": "module"`): import tương đối phải có đuôi `.js` (`import { AppModule } from './app.module.js'`), khác gateway (CommonJS).
- **Vitest** thay cho Jest: chạy ESM trực tiếp nên test **chạy được trên Node 22**, không vướng lỗi ESM của Jest như gateway.
- HTTP adapter: Express (mặc định của scaffold). Có thể đổi sang Fastify cho đồng bộ với gateway (xem câu hỏi mở bên dưới).
- Thay các file scaffold mẫu (`app.controller.ts`, `app.service.ts`...) bằng code registry.

**Core thuần** `RegistryStore` (clock tiêm vào để test điều khiển thời gian):
- `register(id, body)`: upsert `{ id, service, host, port, patterns }`, cập nhật `lastSeen`. **Heartbeat chính là gọi lại register** với đủ dữ liệu (idempotent), nên registry mất dữ liệu thì heartbeat kế tiếp tự khôi phục (soft state).
- Xung đột: pattern đang thuộc service khác (còn instance sống) → 409 `PATTERN_CONFLICT`.
- `deregister(id)`; `sweep()` gỡ instance có `now - lastSeen > leaseTtl`.
- `snapshot()` → `{ version, instances }`; `version` **chỉ tăng khi bảng đổi** (heartbeat thuần không tăng) nên gateway nhận 304.

**HTTP API:**
| Method | Path | Ý nghĩa |
|---|---|---|
| `PUT` | `/v1/instances/:id` | Đăng ký / heartbeat → `{ leaseTtlMs, heartbeatIntervalMs }`; 400 sai dữ liệu, 409 xung đột |
| `DELETE` | `/v1/instances/:id` | Huỷ đăng ký (204) |
| `GET` | `/v1/snapshot` | Bảng instance + `ETag`; `If-None-Match` khớp → 304 |
| `GET` | `/health` | Liveness |

- Lỗi theo RFC 9457; validate regex service, port, patterns, giới hạn body.
- Tuỳ chọn `REGISTRY_TOKEN`: nếu đặt, `PUT`/`DELETE` cần header `x-registry-token` (registry chỉ mở trong mạng nội bộ).
- Env: `PORT` (8500), `REGISTRY_LEASE_TTL_MS` (15000), `REGISTRY_TOKEN`.

### Phần 2: `libs/service-discovery-client` (`@org/service-discovery-client`, NestJS module) + echo-service
> Đã làm xong dạng lib ngày 2026-11-07 (trước đó từng là bản copy trong echo-service). Chi tiết: `apps/service-discovery/documents/PLAN.md` mục 10e. Service chỉ cần `ServiceDiscoveryModule.forRoot()` + env `REGISTRY_URL`, `PORT`.
- `ServiceDiscoveryModule.forRoot()` đọc cấu hình từ env (option ghi đè được).
- **Tự thu thập pattern** bằng `DiscoveryService` + `MetadataScanner`; chỉ lấy `@MessagePattern`, **bỏ `@EventPattern`**; pattern không phải string thì bỏ qua và cảnh báo.
- Vòng đời: bootstrap → đăng ký + heartbeat (timer `unref`); registry chết → service **vẫn chạy**, thử lại nhịp kế; 409 → log lỗi rõ; shutdown → `DELETE` (best effort) để gateway thôi gửi ngay, không chờ TTL.
- **`advertiseHost`** (`SERVICE_ADVERTISE_HOST`, mặc định tự phát hiện IPv4 không phải loopback): địa chỉ gateway dùng để gọi tới. Service lắng nghe `0.0.0.0` nhưng **không được** quảng bá `0.0.0.0`.
- `instanceId` mặc định `<service>-<hostname>-<port>`.
- Tạo bằng generator `@nx/js:library`; app phụ thuộc build lib (`dependsOn: ^build`); Jest map tới source lib.
- echo-service import module khi có `REGISTRY_URL`; không có thì chạy như cũ.

### Phần 3: Gateway đọc từ registry
- `src/gateway/discovery/registry-discovery.ts` implements **`ServiceDiscovery` hiện có** → `GatewayHandler` **không đổi một dòng**.
  - `start()`: tải snapshot lần đầu; thất bại vẫn trả về (bảng rỗng) và thử lại nền.
  - Poll mỗi `GATEWAY_REGISTRY_POLL_MS` (3000) với `If-None-Match`; lỗi → giữ bản cũ, log có giới hạn tần suất.
  - Snapshot đổi → log lại pattern chưa có ai xử lý.
- `config.ts`: `GATEWAY_REGISTRY_URL` bắt buộc (đã gỡ `GATEWAY_DISCOVERY_FILE`); thêm `GATEWAY_REGISTRY_POLL_MS`.
- Hệ quả: instance bị kill (không deregister) bị gỡ sau tối đa `leaseTtl + poll` (~18s), round-robin thôi chọn nó.

### Test
- Registry: unit `RegistryStore` (Node 22) — đăng ký, heartbeat không tăng version, hết TTL, xung đột, giải phóng pattern, đăng ký lại pattern khác, deregister; e2e HTTP (Node ≥ 24.9).
- Client: heartbeat theo nhịp, registry lỗi không crash, deregister khi tắt (fake fetch + fake timers); thu thập đúng message pattern (Node ≥ 24.9).
- Gateway: `RegistryDiscovery` (lần đầu, 304, lỗi giữ bản cũ, khởi động khi registry chết rồi phục hồi); `config.spec` hai chế độ.

### Kiểm chứng cuối (chạy thật)
1. Registry + gateway + 2 echo tự đăng ký → chia đều.
2. `SIGKILL` echo-2 → ≤ ~18s bị gỡ, hết cảnh báo failover.
3. `SIGTERM` echo-1 → deregister ngay.
4. Tắt registry → gateway vẫn phục vụ bằng snapshot cũ.
5. Bật lại registry → echo tự đăng ký lại qua heartbeat.
6. Gateway khởi động khi registry tắt → 503, bật registry → tự phục hồi.

### Ngoài phạm vi
Nhiều instance registry / replication, lưu bền, health check chủ động từ registry, self-preservation, watch/long-poll thay polling, mTLS, Docker (Bước 6).

### Câu hỏi mở trước khi code Phần 1
1. **`apps/service-discovery/.git`**: app đang có repo git riêng bên trong monorepo. Git của monorepo sẽ coi thư mục này là một repo con (gitlink) và **không theo dõi file bên trong**. Cần quyết định: xoá `.git` bên trong để app thuộc monorepo, hay giữ làm repo riêng (submodule).
2. **HTTP adapter**: giữ Express của scaffold, hay đổi sang Fastify cho giống gateway?
3. **Nx**: app chưa được kiểm tra đã được Nx nhận diện chưa (workspaces `apps/*` đã bao gồm nó; cần `npm install` ở root).

---

## 17. Cách làm việc

- Claude viết code, bạn đọc, hiểu và hỏi lại. Với mỗi file: giải thích "tại sao" trước, kèm câu hỏi phỏng vấn liên quan.
- Mỗi bước: plan → duyệt → code → **dừng để bạn review** → bạn yêu cầu thì mới commit.
- Sau mỗi bước cập nhật [KNOWLEDGE.md](./KNOWLEDGE.md) và sinh lại `knowledge.html`.
