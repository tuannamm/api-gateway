<!--
Nội dung tab "Slide" trong knowledge.html.
- Mỗi slide ngăn cách bằng một dòng chỉ có `---`.
- Slide bắt đầu bằng `# ` là slide bìa; `## ` là slide thường.
- Dòng `Note:` trở xuống là ghi chú cho người nói (không hiện trên slide, bấm N để xem).
- `{{architecture}}` chèn sơ đồ kiến trúc; `{{planes}}` chèn hai cột control/data plane.
Sửa xong chạy: npm exec nx run api-gateway:docs:knowledge
-->

# API Gateway contract-first

Một file OpenAPI, một gateway dùng lại cho mọi project.

NestJS · Fastify · TCP RPC · OpenAPI 3

Note: Giới thiệu bản thân một câu. Nói mục tiêu buổi chia sẻ: thiết kế, các quyết định, và những bẫy đã gặp.

---

## Bài toán

- Hệ thống microservices: client **không nên** biết có bao nhiêu service, ở đâu
- Mỗi project có bộ API riêng, nhưng việc của gateway thì giống nhau
- Muốn: **dùng lại một gateway**, project mới chỉ cần đưa một file spec

Note: Nhấn mạnh chữ "dùng lại". Đây là lý do toàn bộ thiết kế xoay quanh file OpenAPI.

---

## Ý tưởng cốt lõi

| | |
|---|---|
| **Spec là nguồn sự thật** | Gateway đọc OpenAPI, tự dựng bảng route |
| **`operationId` = `@MessagePattern`** | Spec và service nói cùng một tên |
| **Tìm service theo pattern** | Hỏi registry: "ai xử lý pattern này?" |
| **HTTP → TCP RPC** | Gateway dịch giao thức, không proxy HTTP |

Note: Ví dụ: operationId user.getById, service có @MessagePattern('user.getById'). Spec không ghi tên service, nên tách service không phải sửa spec.

---

## Kiến trúc

{{architecture}}

Note: Đi theo mũi tên: client gọi HTTP, gateway gửi TCP. Registry biết ai ở đâu. RabbitMQ chỉ cho event giữa service, gateway không chạm. Keycloak chỉ auth worker gọi; gateway chỉ tải public key.

---

## Control plane và data plane

{{planes}}

Note: Câu chốt: việc nặng làm một lần lúc khởi động, mỗi request chỉ tra bộ nhớ. Spec sai thì gateway không khởi động, lỗi lộ ra lúc deploy chứ không phải lúc khách hàng dùng.

---

## Một request đi qua gateway

1. Nhận HTTP, kiểm tra body (413, 415)
2. Lấy hoặc sinh `x-request-id`
3. Match route trong trie (404, 405)
4. Dựng payload theo **allowlist**
5. Hỏi discovery: ai xử lý pattern? (503)
6. Chọn instance
7. Gửi TCP có timeout (502, 504)
8. Trả status lấy **từ spec** (201, 204…)

Note: Có thể chuyển sang tab Tổng quan để demo bộ mô phỏng: chọn tình huống 504 hoặc 503.

---

## Routing bằng segment trie

```
/users            users
/users/me           ├─ me        (tĩnh: ưu tiên)
/users/{id}         └─ {param}
/users/{id}/orders       └─ orders
```

- Match O(số segment), không phụ thuộc số route
- **Backtrack theo method**: `DELETE /users/me` rơi đúng xuống `/users/{id}`
- **Decode sau khi match**: `%2F` không làm lệch path

Note: Bug đầu tiên gặp: dừng ở nhánh tĩnh khớp path thì DELETE /users/me bị 405 sai. Sửa bằng generator duyệt ứng viên theo thứ tự ưu tiên.

---

## Một định dạng lỗi: RFC 9457

```json
{
  "type": "about:blank",
  "title": "Gateway Timeout",
  "status": 504,
  "detail": "The service did not respond in time",
  "code": "UPSTREAM_TIMEOUT",
  "requestId": "1306…"
}
```

`404` route · `405` method · `413` body · `503` không có instance · `502` không kết nối được · `504` quá timeout

Note: requestId có trong mọi response và trong log của cả gateway lẫn service. Client báo mã, ta tìm ra cả hành trình.

---

## x-request-id: truy vết một request

```
Client ──► Gateway ──TCP──► user-service ──event──► notification
           id=7f3a         id=7f3a                 id=7f3a
◄── response: x-request-id: 7f3a (kể cả khi lỗi)
```

- Gateway giữ id của client nếu hợp lệ (≤ 128 ký tự, `[A-Za-z0-9._-]`), không thì sinh **UUID**
- Truyền xuống service qua `meta.requestId`, gắn vào **mọi** response
- Service ghi vào log và copy vào header message khi publish event
- Client báo mã khi gặp lỗi → tìm một mã, thấy cả hành trình

Note: Ví dụ thật khi chạy thử: gửi x-request-id demo-trace-1, mã này xuất hiện trong log của cả gateway lẫn echo-service. Vì sao gắn cả vào response: gateway tự trả nhiều lỗi (404, 503, 504) mà không service nào thấy. Không tin mù quáng id của client: kiểm tra định dạng để không chèn được ký tự lạ vào log. Bản đầy đủ hơn là traceparent của OpenTelemetry.

---

## Idempotency-Key: retry không tạo trùng

```
POST /orders  Idempotency-Key: a1b2  → tạo đơn #123, lưu (a1b2 → #123)
        … gateway trả 504 / mất mạng, client gửi lại …
POST /orders  Idempotency-Key: a1b2  → đã có a1b2 → trả lại #123
```

- `POST` không idempotent: gửi lại là tạo **đơn thứ hai, trừ tiền hai lần**
- Client sinh mã cho mỗi thao tác và **giữ nguyên** khi retry
- Gateway chỉ chuyển xuống `meta.idempotencyKey`; **service** chống trùng
- Lưu key **cùng transaction** với dữ liệu; cùng key khác body → `422`; hai request đồng thời → `409`

Note: Liên hệ timeout: gateway trả 504 nhưng service vẫn có thể xử lý xong, đây là lý do chính cần key. Vì sao gateway không tự chống trùng: việc này gắn với dữ liệu và transaction của service, còn gateway stateless. Ví dụ ngoài đời: Stripe bắt buộc header này cho thanh toán.

---

## Hai mã, hai mục đích

| | `x-request-id` | `Idempotency-Key` |
|---|---|---|
| **Để làm gì** | Truy vết log | Chống xử lý trùng |
| **Ai sinh** | Gateway (hoặc client) | Client |
| **Khi retry** | Mỗi lần một mã **mới** | **Giữ nguyên** mã |
| **Ai dùng** | Mọi service khi ghi log | Service xử lý thao tác ghi |
| **Trong payload** | `meta.requestId` | `meta.idempotencyKey` |

Note: Câu hỏi bẫy hay gặp: "retry thì dùng lại request id được không?". Không: mỗi lần gọi là một lần thực thi riêng cần truy vết riêng; thứ phải giữ nguyên khi retry là Idempotency-Key.

---

## Load balancing + failover an toàn

```
round-robin theo pattern:  [echo-1, echo-2] → [echo-2, echo-1] → …
echo-2 chết:  thử echo-2 → ECONNREFUSED → thử echo-1 → 200
```

| Lỗi | Đã tới service? | Gửi sang instance khác? |
|---|---|---|
| `ECONNREFUSED` (chưa kết nối) | **Chắc chắn chưa** | **Có**, kể cả POST |
| Đứt giữa chừng, timeout | Không biết | Không (502 / 504) |
| Lỗi từ service | Đã tới | Không |

Note: Câu chốt: chỉ failover khi chắc chắn service chưa thấy request, nên không thể tạo trùng. "Không biết" là chuyện của retry (Bước 5), cần idempotency. Kiểm chứng thật: 2 echo nhận 2/4 request; tắt một echo vẫn 4/4 là 200. Hạn chế: round-robin chưa biết instance nào chết, mỗi lượt thứ hai vẫn thử nó trước; cần outlier detection.

---

## Bẫy thực tế

- **Lỗi qua TCP mất kiểu**: `RpcException` thành object thường, thiếu handler thành chuỗi, mất kết nối là `Error` có `code`
- **Client TCP cache kết nối thất bại**: service bật lại vẫn lỗi mãi; phải bỏ client khỏi pool
- **NestJS ghi đè error handler của Fastify**: lỗi 413/415 phải xử lý bằng exception filter
- **Wildcard Express ≠ Fastify**: `{*path}` làm app crash, Fastify dùng `*`

Note: Kể một bug theo khung: triệu chứng, cách điều tra (đọc source thư viện), cách sửa, cách kiểm chứng (tắt echo thì 502, bật lại thì 200).

---

## Thiết kế code

- **Core không biết NestJS**: `src/gateway/` là thư viện thuần, NestJS chỉ là lớp vỏ
- **Dependency inversion**: handler phụ thuộc interface `ServiceDiscovery`, `RpcTransport`
- **Một chỗ dịch lỗi**: mọi lỗi quy về `GatewayError` rồi mới thành HTTP
- **Test 3 tầng**: unit với fake, integration với TCP thật, e2e HTTP → TCP

Note: Lợi ích thật: unit test toàn bộ bảng mã lỗi mà không cần mạng; đổi StaticDiscovery sang registry thật không sửa handler.

---

## Đánh đổi đã chấp nhận

| Chọn | Đổi lại |
|---|---|
| Tìm service theo pattern | Không biết lúc khởi động pattern nào chưa có service (503 lúc chạy) |
| Dịch HTTP → TCP | Khó stream file lớn, gắn với NestJS |
| Hợp đồng copy ở từng service | Đổi hợp đồng phải sửa tay nhiều nơi |
| Một instance một project | Nhiều process hơn, đổi lại cô lập lỗi |

Note: Phỏng vấn viên thích nghe đánh đổi hơn nghe ưu điểm. Mỗi dòng nói được "vì sao vẫn chọn".
