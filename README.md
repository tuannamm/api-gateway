# API Gateway

Gateway contract-first: đọc một file OpenAPI, nhận HTTP từ client, dịch thành message RPC
(`@MessagePattern` = `operationId`) gửi qua TCP tới service đang xử lý pattern đó.

- Thiết kế và quyết định: [PLAN.md](./documents/PLAN.md)
- Kiến thức ôn phỏng vấn: [KNOWLEDGE.md](./documents/KNOWLEDGE.md)

## Yêu cầu

- Node **≥ 24.9** để chạy test (NestJS 12 là ESM-only). Node 22 chạy được app nhưng không chạy được Jest.

## Chạy local

```bash
# Terminal 1: Service Registry (HTTP :8500)
cd apps/service-discovery && npm run start:dev

# Terminal 2: echo-service (TCP :4001), tự đăng ký vào registry qua REGISTRY_URL
npm exec nx run echo-service:start:dev

# Terminal 3: gateway (HTTP :3000) cho project "example"
# .env (gateway tự nạp khi khởi động; biến dòng lệnh thắng .env):
#   GATEWAY_PROJECT=example
#   GATEWAY_REGISTRY_URL=http://localhost:8500
npm run start:dev

# Terminal 4
curl -i localhost:3000/users/42
```

Thử load balancing và failover với instance thứ hai (tự đăng ký, gateway thấy sau ≤ 1 chu kỳ poll):

```bash
# Terminal 5: instance thứ hai (TCP :4002)
PORT=4002 npm exec nx run echo-service:start:dev

# Gọi nhiều lần: log của hai echo nhận lần lượt ([echo:4001] / [echo:4002])
for i in 1 2 3 4; do curl -s localhost:3000/users/$i > /dev/null; done

# Tắt một echo: mọi request vẫn 200 nhờ failover (log gateway có cảnh báo "failing over")
```

Tắt êm (Ctrl+C) thì echo huỷ đăng ký ngay; bị kill thì registry gỡ sau khi hết lease TTL. Trong khoảng đó failover giữ cho request vẫn thành công.

Thử các nhánh lỗi:

```bash
curl -i localhost:3000/users/missing                 # 404 USER_NOT_FOUND (lỗi nghiệp vụ từ service)
curl -i localhost:3000/users/slow                    # 504 UPSTREAM_TIMEOUT
curl -i -X PUT localhost:3000/users/42               # 405 + Allow
curl -i localhost:3000/nope                          # 404 ROUTE_NOT_FOUND
curl -i -X POST localhost:3000/auth/logout           # 503 NO_INSTANCE
```

## Biến môi trường

| Biến | Bắt buộc | Mặc định | Ý nghĩa |
|---|---|---|---|
| `GATEWAY_PROJECT` | Có | - | Project cần phục vụ (`specs/<project>/openapi.yml`) |
| `GATEWAY_REGISTRY_URL` | Có | - | Service Registry (VD `http://localhost:8500`); gateway poll snapshot nền |
| `GATEWAY_REGISTRY_POLL_MS` | Không | `3000` | Chu kỳ poll registry (tối đa 60000) |
| `GATEWAY_SPECS_DIR` | Không | `./specs` | Thư mục chứa spec |
| `GATEWAY_SPEC_FILE` | Không | `openapi.yml` | Tên file spec |
| `GATEWAY_RPC_TIMEOUT_MS` | Không | `10000` | Timeout chờ service (504) |
| `GATEWAY_BODY_LIMIT` | Không | `1048576` | Body tối đa, byte (413) |
| `GATEWAY_FAILOVER_MAX_ATTEMPTS` | Không | `3` | Số instance tối đa thử cho một request (`1` = tắt failover) |
| `PORT` | Không | `3000` | Cổng HTTP |
| `GATEWAY_CORS_ORIGINS` | Không | (tắt) | Origin được phép gọi từ trình duyệt, cách nhau bằng dấu phẩy, đúng dạng `http://localhost:3001` (không path, không `*`). Preflight `OPTIONS` được trả lời trước bước xác thực; origin lạ nhận 403 |
| `AUTHZ_CACHE_TTL_MS` | Không | `30000` | TTL cache permission của user |
| `AUTHZ_CACHE_MAX_ENTRIES` | Không | `10000` | Số entry tối đa của cache permission |

## Thêm một project mới

1. Tạo `specs/<project>/openapi.yml`. Mọi operation phải có `operationId` không rỗng, không trùng.
2. Service xử lý bằng `@MessagePattern('<operationId>')`, nhận `GatewayRequest`
   (hợp đồng: `src/gateway/contracts.ts`).
3. Service tự đăng ký vào registry (`REGISTRY_URL`, xem `apps/service-discovery/README.md`).

## Test

```bash
npm exec nx test api-gateway                 # unit + integration
npm exec nx run api-gateway:test:e2e         # e2e: HTTP → gateway → TCP → microservice
```

## Tích hợp w-identity

Copy `.env.identity.example` thành `.env` để dùng project `identity` (HTTP 3000, registry 8500). Cấu hình `KEYCLOAK_ISSUER` đúng issuer mà token chứa và `KEYCLOAK_AUDIENCE=w-identity`. Realm fixture và hướng dẫn nằm ở `apps/w-identity/README.md`.

Gateway mặc định yêu cầu bearer JWT trên mỗi route; chỉ `security: []` mới công khai. Gateway kiểm tra chữ ký RS256/JWKS, issuer, audience, thời hạn và loại access token trước khi truyền `sub`, `iss`, realm roles xuống TCP. Khi spec có route bảo vệ mà chưa cấu hình issuer/audience, gateway dừng lúc khởi động. Spec ví dụ cũ cũng cần cấu hình xác thực cho các route bảo vệ.

Repo này có Nx config riêng vì bị loại khỏi graph của workspace root. Chạy build/test trong thư mục `apps/api-gateway` bằng `npm exec nx run api-gateway:build`, `npm exec nx run api-gateway:test`, `npm exec nx run api-gateway:test:e2e`. Test dùng Node 24 và VM modules theo npm script. Spec identity có request/response schemas; service vẫn thực hiện validation đầu vào và kiểm tra quyền nghiệp vụ.
