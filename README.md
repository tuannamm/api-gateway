# API Gateway

Gateway contract-first: đọc một file OpenAPI, nhận HTTP từ client, dịch thành message RPC
(`@MessagePattern` = `operationId`) gửi qua TCP tới service đang xử lý pattern đó.

- Thiết kế và quyết định: [PLAN.md](./PLAN.md)
- Kiến thức ôn phỏng vấn: [KNOWLEDGE.md](./KNOWLEDGE.md)

## Yêu cầu

- Node **≥ 24.9** để chạy test (NestJS 12 là ESM-only). Node 22 chạy được app nhưng không chạy được Jest.

## Chạy local

```bash
# Terminal 1: service giả (TCP :4001)
npm exec nx run echo-service:start:dev

# Terminal 2: gateway (HTTP :3000) cho project "example"
GATEWAY_PROJECT=example GATEWAY_DISCOVERY_FILE=discovery.local.json \
  npm exec nx run api-gateway:start:dev

# Terminal 3
curl -i localhost:3000/users/42
```

Thử load balancing và failover với instance thứ hai (đã khai báo sẵn trong `discovery.local.json`):

```bash
# Terminal 4: instance thứ hai (TCP :4002)
ECHO_PORT=4002 npm exec nx run echo-service:start:dev

# Gọi nhiều lần: log của hai echo nhận lần lượt ([echo:4001] / [echo:4002])
for i in 1 2 3 4; do curl -s localhost:3000/users/$i > /dev/null; done

# Tắt một echo: mọi request vẫn 200 nhờ failover (log gateway có cảnh báo "failing over")
```

Khi chỉ chạy một echo, request đến lượt `echo-2` vẫn thành công nhờ failover.

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
| `GATEWAY_DISCOVERY_FILE` | Có | - | File JSON của StaticDiscovery |
| `GATEWAY_SPECS_DIR` | Không | `./specs` | Thư mục chứa spec |
| `GATEWAY_SPEC_FILE` | Không | `openapi.yml` | Tên file spec |
| `GATEWAY_RPC_TIMEOUT_MS` | Không | `10000` | Timeout chờ service (504) |
| `GATEWAY_BODY_LIMIT` | Không | `1048576` | Body tối đa, byte (413) |
| `GATEWAY_FAILOVER_MAX_ATTEMPTS` | Không | `3` | Số instance tối đa thử cho một request (`1` = tắt failover) |
| `PORT` | Không | `3000` | Cổng HTTP |

## Thêm một project mới

1. Tạo `specs/<project>/openapi.yml`. Mọi operation phải có `operationId` không rỗng, không trùng.
2. Service xử lý bằng `@MessagePattern('<operationId>')`, nhận `GatewayRequest`
   (hợp đồng: `src/gateway/contracts.ts`).
3. Khai báo instance và pattern trong file discovery (sau này service tự đăng ký vào registry).

## Test

```bash
npm exec nx test api-gateway                 # unit + integration
npm exec nx run api-gateway:test:e2e         # e2e: HTTP → gateway → TCP → microservice
```
