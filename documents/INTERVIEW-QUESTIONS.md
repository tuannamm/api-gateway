# Ngân hàng câu hỏi phỏng vấn: API Gateway & Microservices

> Dùng cùng [KNOWLEDGE.md](./KNOWLEDGE.md). Ký hiệu `📚 #n` = mục n trong KNOWLEDGE.

## Cách luyện

1. Đọc câu hỏi, **nói thành tiếng** câu trả lời trong 1–2 phút (không nhìn ý chính).
2. So với **Ý chính**: thiếu ý nào thì đọc lại mục 📚 tương ứng.
3. Đánh dấu: `[x]` khi trả lời đủ ý, tự tin; để `[ ]` và thêm 🔁 nếu cần ôn lại.
4. Với câu ở Phần B, luôn **gắn với code thật** ("trong dự án của em, ở file ...").
5. Mỗi câu trả lời tốt thường có 3 phần: **định nghĩa → vì sao / đánh đổi → ví dụ từ dự án**.

Mức độ: 🟢 cơ bản · 🟡 trung bình · 🔴 nâng cao

---

## Phần A. Kiến thức nền

### A1. API Gateway
- [ ] 🟢 **API Gateway là gì? Vì sao microservices cần nó?**
  *Ý chính:* điểm vào duy nhất; ẩn cấu trúc nội bộ; gom việc chung (auth, rate limit, log); tách client khỏi service. · 📚 #1
- [ ] 🟢 **Gateway khác reverse proxy và load balancer thế nào?**
  *Ý chính:* LB chia tải giữa các bản sao của một dịch vụ; reverse proxy chuyển tiếp HTTP; gateway hiểu API (route theo operation, auth, policy, dịch giao thức). · 📚 #1, #6
- [ ] 🟢 **Cái gì KHÔNG nên đặt ở gateway?**
  *Ý chính:* business logic, lưu dữ liệu nghiệp vụ; gateway "béo" = monolith ở cửa trước. · 📚 #1
- [ ] 🟡 **Gateway là single point of failure, xử lý thế nào?**
  *Ý chính:* stateless, nhiều instance sau LB, health check, cấu hình đã nạp vẫn chạy khi control plane chết. · 📚 #1, #15
- [ ] 🟡 **Gateway và service mesh khác nhau thế nào? Có cần cả hai không?**
  *Ý chính:* bắc-nam vs đông-tây; mesh = sidecar cạnh từng service; bổ sung cho nhau. · 📚 #17, #18
- [ ] 🟡 **BFF là gì? Khi nào cần?**
  *Ý chính:* gateway riêng cho từng loại client; khi web/mobile cần dữ liệu khác nhau. · 📚 #18
- [ ] 🔴 **Gateway có nên gộp dữ liệu từ nhiều service (aggregation) không?**
  *Ý chính:* tiện cho client, giảm round-trip; nhưng đưa logic vào gateway, độ trễ = service chậm nhất, lỗi một phần xử lý sao. · 📚 #18
- [ ] 🟡 **Khi nào tự build gateway, khi nào dùng Kong/Envoy/AWS API Gateway?**
  *Ý chính:* tự build khi nhu cầu đặc thù / học; sản phẩm sẵn có khi cần ổn định, plugin, vận hành. · 📚 #17

### A2. Control plane / data plane
- [ ] 🟡 **Control plane và data plane là gì? Vì sao tách?**
  *Ý chính:* cấu hình vs thực thi; tần suất khác nhau; hiệu năng; cập nhật không gián đoạn; data plane sống khi control plane chết. · 📚 #2
- [ ] 🟡 **Cập nhật cấu hình gateway không downtime thế nào?**
  *Ý chính:* dựng cấu hình mới riêng, validate, atomic swap; lỗi thì giữ cũ. · 📚 #2, #5
- [ ] 🟢 **Cho ví dụ control/data plane ngoài đời.**
  *Ý chính:* Kubernetes, Istio (istiod / Envoy), router mạng. · 📚 #2

### A3. Routing
- [ ] 🟡 **Match URL với hàng nghìn route thế nào cho nhanh?**
  *Ý chính:* trie / radix tree theo segment; O(số segment) thay vì O(số route). · 📚 #4
- [ ] 🟡 **`/users/me` và `/users/{id}` cùng tồn tại, xử lý ra sao?**
  *Ý chính:* tĩnh ưu tiên; backtrack; backtrack phải tính method. · 📚 #4
- [ ] 🟢 **404 khác 405 thế nào?**
  *Ý chính:* không có path / có path sai method + `Allow`. · 📚 #4, #19
- [ ] 🔴 **Vì sao phải decode tham số SAU khi match?**
  *Ý chính:* `%2F` thành `/` làm lệch số segment. · 📚 #4

### A4. Contract-first & cấu hình
- [ ] 🟢 **Contract-first khác code-first?**
  *Ý chính:* spec trước là hợp đồng giữa các team; code-first nhanh nhưng spec dễ lệch. · 📚 #3
- [ ] 🟢 **OpenAPI dùng làm gì ngoài tài liệu?**
  *Ý chính:* validate, mock, sinh client/server, cấu hình gateway. · 📚 #3
- [ ] 🟡 **Fail-fast là gì? Khi nào fail-fast, khi nào graceful degradation?**
  *Ý chính:* lỗi cấu hình → dừng khi khởi động; lỗi runtime của phụ thuộc → giảm cấp (stale cache, 503). · 📚 #5
- [ ] 🟡 **Multi-tenant một process hay mỗi tenant một instance?**
  *Ý chính:* cô lập lỗi/tải vs tiết kiệm tài nguyên; độ phức tạp. · 📚 #3
- [ ] 🟡 **Path traversal là gì, chặn thế nào?**
  *Ý chính:* `../` thoát khỏi thư mục; whitelist ký tự + kiểm tra đường dẫn sau resolve. · 📚 #5, #21

### A5. Giao tiếp giữa service
- [ ] 🟢 **RPC khác messaging/event?**
  *Ý chính:* chờ kết quả vs không chờ; một nhận vs nhiều nhận; khi nào dùng. · 📚 #6, #22
- [ ] 🟡 **Protocol translation khác reverse proxy? Ưu nhược?**
  *Ý chính:* dựng payload vs chuyển nguyên; hợp đồng thống nhất, kiểm soát dữ liệu vs khó stream, gắn framework. · 📚 #6
- [ ] 🟢 **502, 503, 504 khác nhau?**
  *Ý chính:* upstream lỗi / không ai phục vụ / quá thời gian. · 📚 #6, #19
- [ ] 🟡 **Vì sao phải bỏ hop-by-hop headers khi làm reverse proxy?**
  *Ý chính:* chỉ có nghĩa giữa hai nút kề nhau (`Connection`, `Keep-Alive`, `Upgrade`). · 📚 #6
- [ ] 🟡 **Connection pool là gì? Vì sao gateway cần?**
  *Ý chính:* tái sử dụng kết nối, tránh bắt tay TCP mỗi request; phải loại kết nối hỏng. · 📚 #6
- [ ] 🟡 **`send` khác `emit` trong NestJS?**
  *Ý chính:* request/response vs fire-and-forget; `@MessagePattern` vs `@EventPattern`. · 📚 #23

### A6. Service discovery & registry
- [ ] 🟢 **Vì sao cần service discovery?**
  *Ý chính:* địa chỉ instance thay đổi liên tục (scale, deploy, crash). · 📚 #7
- [ ] 🟡 **Client-side vs server-side discovery?**
  *Ý chính:* client tự hỏi + tự chọn vs qua LB; ví dụ Eureka+Ribbon / K8s Service. · 📚 #7
- [ ] 🟡 **Self-registration vs third-party registration?**
  *Ý chính:* service tự đăng ký + heartbeat vs orchestrator đăng ký thay. · 📚 #7
- [ ] 🔴 **Registry nên AP hay CP? Vì sao?**
  *Ý chính:* discovery thường ưu tiên AP (danh sách hơi cũ tốt hơn không trả lời); Eureka AP, etcd/ZooKeeper CP. · 📚 #16
- [ ] 🟡 **Làm sao phát hiện instance đã chết?**
  *Ý chính:* heartbeat + TTL; health check chủ động/thụ động; self-preservation khi mất heartbeat hàng loạt. · 📚 #16
- [ ] 🟡 **Registry chết thì hệ thống có sập không?**
  *Ý chính:* cache phía client + stale-on-error; data plane vẫn chạy. · 📚 #7, #8

### A7. Cache & load balancing
- [ ] 🟡 **Cache ở gateway có rủi ro gì? Chọn TTL thế nào?**
  *Ý chính:* dữ liệu cũ (gọi instance đã chết) vs tải lên registry. · 📚 #8
- [ ] 🔴 **Cache stampede là gì, tránh thế nào?**
  *Ý chính:* nhiều request cùng làm mới khi hết hạn; request coalescing, jitter TTL. · 📚 #8
- [ ] 🟢 **Các thuật toán load balancing?**
  *Ý chính:* round-robin, weighted, least-connections, power of two choices, consistent hashing. · 📚 #9
- [ ] 🟡 **Round-robin có nhược điểm gì?**
  *Ý chính:* không tính tải thực / thời gian xử lý khác nhau. · 📚 #9
- [ ] 🟡 **Layer 4 vs Layer 7 load balancing?**
  *Ý chính:* theo TCP/IP vs theo nội dung HTTP. · 📚 #9
- [ ] 🟡 **Vì sao bộ đếm round-robin nên tách theo từng pattern?**
  *Ý chính:* bộ đếm chung + request xen kẽ nhiều pattern làm mỗi pattern luôn rơi vào một instance. · 📚 #9
- [ ] 🟡 **Load balancer biết instance chết bằng cách nào?**
  *Ý chính:* health check chủ động (gọi định kỳ) / thụ động (theo lỗi thực tế), outlier detection, registry gỡ instance hết TTL. · 📚 #9, #16
- [ ] 🟡 **Sticky session là gì, nên dùng không?**
  *Ý chính:* gắn client với một instance; cản scale/failover; thay bằng stateless + store chung. · 📚 #9

### A8. Bảo mật
- [ ] 🟢 **Authentication khác authorization?**
  *Ý chính:* bạn là ai vs bạn được làm gì. · 📚 #10
- [ ] 🟢 **401 khác 403?** · 📚 #19
- [ ] 🟡 **Cấu trúc JWT? Gateway kiểm tra những gì?**
  *Ý chính:* header.payload.signature; chữ ký, `exp`, `nbf`, `iss`, `aud`. · 📚 #10
- [ ] 🟡 **RS256 vs HS256? Vì sao gateway nên dùng RS256?**
  *Ý chính:* bất đối xứng, gateway chỉ giữ public key. · 📚 #10
- [ ] 🟡 **JWKS là gì? Xoay khoá thế nào?**
  *Ý chính:* tập public key theo `kid`; cache, tải lại khi gặp `kid` lạ, giới hạn tần suất. · 📚 #10
- [ ] 🔴 **User đã logout nhưng access token còn hạn?**
  *Ý chính:* JWT stateless; token ngắn hạn + huỷ refresh token; blacklist `jti` / introspection. · 📚 #10
- [ ] 🟡 **Verify token ở gateway hay ở từng service?**
  *Ý chính:* gọn vs service phải tin gateway; zero trust, mTLS. · 📚 #10
- [ ] 🟡 **Verify cục bộ vs introspection?**
  *Ý chính:* nhanh, độc lập vs thu hồi tức thì nhưng thêm độ trễ, điểm nghẽn. · 📚 #10
- [ ] 🟢 **CORS là gì? Vì sao chỉ trình duyệt bị ràng buộc?** · 📚 #21
- [ ] 🟡 **Các biện pháp bảo vệ gateway khỏi DoS?**
  *Ý chính:* body limit, rate limit, timeout (slowloris), giới hạn kết nối. · 📚 #21

### A9. Rate limiting & validation
- [ ] 🟢 **Các thuật toán rate limit?**
  *Ý chính:* fixed window, sliding window, token bucket, leaky bucket. · 📚 #11
- [ ] 🟡 **Token bucket khác fixed window?**
  *Ý chính:* burst có kiểm soát vs burst gấp đôi ở ranh giới khung. · 📚 #11
- [ ] 🔴 **Thiết kế rate limiter cho nhiều instance gateway.**
  *Ý chính:* counter dùng chung (Redis), thao tác atomic (Lua/INCR+EXPIRE), khoá theo user/IP/route, 429 + Retry-After. · 📚 #11
- [ ] 🔴 **Redis chết thì rate limiter fail-open hay fail-closed?**
  *Ý chính:* đánh đổi sẵn sàng vs bảo vệ; tuỳ route (login nên closed). · 📚 #11
- [ ] 🟡 **Validate request ở gateway hay service? Cần cả hai không?**
  *Ý chính:* chặn sớm, tiết kiệm vs schema phải đồng bộ; defense in depth. · 📚 #12

### A10. Resilience
- [ ] 🟢 **Timeout, retry, circuit breaker, bulkhead là gì?** · 📚 #14
- [ ] 🟡 **Circuit breaker có mấy trạng thái, chuyển thế nào?**
  *Ý chính:* closed → open (quá ngưỡng lỗi) → half-open (thử lại) → closed/open. · 📚 #14
- [ ] 🔴 **Khi nào gateway được phép gửi request sang instance khác? Vì sao POST cũng được khi gặp `ECONNREFUSED`?**
  *Ý chính:* chỉ khi chắc chắn chưa gửi được (chưa mở kết nối); service chưa thấy request nên không thể tạo trùng; mất kết nối giữa chừng / timeout thì không biết → không gửi lại. · 📚 #14
- [ ] 🟡 **Failover khác retry thế nào?**
  *Ý chính:* failover = chưa gửi được, an toàn mọi method; retry = có thể đã xử lý, chỉ cho method idempotent hoặc có Idempotency-Key. · 📚 #14, #27
- [ ] 🟡 **Vì sao retry có thể làm hệ thống tệ hơn?**
  *Ý chính:* retry storm, nhân tải; backoff + jitter + giới hạn; chỉ retry idempotent. · 📚 #14
- [ ] 🟢 **Idempotency là gì? Method nào idempotent?** · 📚 #19, #27
- [ ] 🟡 **Làm sao để `POST` thanh toán retry an toàn?**
  *Ý chính:* client gửi `Idempotency-Key`, giữ nguyên khi retry; service lưu key → kết quả, gặp lại trả kết quả cũ. · 📚 #27
- [ ] 🔴 **Service cài đặt chống trùng theo `Idempotency-Key` thế nào?**
  *Ý chính:* unique index; lưu cùng transaction với dữ liệu; TTL; cùng key khác body → 422; đồng thời → 409; lỗi tạm thời không lưu. · 📚 #27
- [ ] 🟡 **Vì sao gateway chỉ chuyển `Idempotency-Key` mà không tự chống trùng?**
  *Ý chính:* chống trùng gắn với dữ liệu và transaction của service; gateway stateless. · 📚 #27
- [ ] 🔴 **Gateway trả 504 rồi, service có dừng xử lý không?**
  *Ý chính:* không; thao tác vẫn có thể hoàn tất → client retry có thể tạo trùng → cần Idempotency-Key. · 📚 #14

### A11. Observability
- [ ] 🟢 **Ba trụ cột observability?**
  *Ý chính:* logs, metrics, traces. · 📚 #13
- [ ] 🟡 **Correlation id / `x-request-id` là gì? Ai sinh, ai truyền?** · 📚 #13
- [ ] 🟡 **`x-request-id` khác `Idempotency-Key`?**
  *Ý chính:* truy vết (mỗi lần mới) vs chống trùng (retry giữ nguyên). · 📚 #13
- [ ] 🟡 **Debug một request đi qua 5 service thế nào?**
  *Ý chính:* correlation id trong log tập trung; distributed tracing (OpenTelemetry, traceparent). · 📚 #13
- [ ] 🟡 **Vì sao đo p99 thay vì trung bình?**
  *Ý chính:* trung bình che đuôi chậm; người dùng gặp đuôi. · 📚 #13
- [ ] 🟢 **Liveness vs readiness probe?** · 📚 #13

### A12. Event-driven
- [ ] 🟡 **Khi nào gọi đồng bộ, khi nào dùng event?** · 📚 #22
- [ ] 🔴 **At-least-once / at-most-once / exactly-once?**
  *Ý chính:* exactly-once thực tế = at-least-once + consumer idempotent. · 📚 #22
- [ ] 🔴 **Outbox pattern giải quyết gì?**
  *Ý chính:* dual-write giữa DB và broker; ghi cùng transaction rồi publish sau. · 📚 #22
- [ ] 🔴 **Saga là gì? Choreography vs orchestration?** · 📚 #22
- [ ] 🟡 **202 Accepted dùng khi nào?** · 📚 #19, #22

### A13. Node.js / NestJS
- [ ] 🟢 **Event loop là gì? Vì sao Node hợp với gateway?** · 📚 #20
- [ ] 🟡 **Điều gì làm nghẽn event loop?**
  *Ý chính:* CPU nặng: JSON lớn, crypto, regex tệ; giới hạn body, worker threads. · 📚 #20
- [ ] 🟡 **Node một luồng, scale gateway thế nào?**
  *Ý chính:* nhiều process / container, stateless. · 📚 #20
- [ ] 🟡 **Exception filter trong NestJS là gì? Dynamic module dùng khi nào?** · 📚 #23
- [ ] 🟡 **Service NestJS báo lỗi cho bên gọi thế nào?**
  *Ý chính:* `RpcException` với payload theo hợp đồng. · 📚 #23

### A14. Khác
- [ ] 🟡 **Các cách versioning API? Thế nào là breaking change?** · 📚 #24
- [ ] 🟡 **Test pyramid? Unit test thành phần gọi mạng thế nào?**
  *Ý chính:* fake/stub qua interface (dependency injection). · 📚 #25
- [ ] 🟡 **Contract testing là gì, khác e2e?** · 📚 #25
- [ ] 🟡 **Dependency Inversion là gì? Ví dụ?** · 📚 #26
- [ ] 🔴 **Hexagonal architecture là gì? Lợi ích thật?** · 📚 #26
- [ ] 🟡 **12-factor app là gì? Cấu hình qua env có lợi gì?** · 📚 #15
- [ ] 🟡 **Graceful shutdown là gì? Vì sao cần?** · 📚 #15

---

## Phần B. Đào sâu vào dự án của bạn

Phỏng vấn viên sẽ hỏi "vì sao" cho mọi quyết định. Trả lời phải nêu được **phương án khác đã cân nhắc** và **đánh đổi**.

- [ ] 🟢 **Giới thiệu dự án trong 2 phút.** · 📚 #0
- [ ] 🟡 **Vì sao dùng `operationId` làm message pattern?**
  *Ý chính:* định danh duy nhất, ổn định, không đổi khi đổi URL; spec và service nói cùng một "ngôn ngữ". · 📚 #3
- [ ] 🟡 **Vì sao không bắt `operationId` theo dạng `<service>.<action>`?**
  *Ý chính:* tìm service qua registry theo pattern; tách service không cần sửa spec. Đánh đổi: không kiểm tra lúc khởi động. · 📚 #7
- [ ] 🔴 **Pattern trong spec nhưng chưa service nào đăng ký: phát hiện lúc nào? Cải thiện ra sao?**
  *Ý chính:* lúc request (503) + cảnh báo khi khởi động (`unservedPatterns`); có thể log định kỳ. · 📚 #7
- [ ] 🔴 **Hai service đăng ký cùng một pattern thì sao?**
  *Ý chính:* registry từ chối (409); nếu cho phép thì gateway không biết gửi ai. · 📚 #7
- [ ] 🟡 **Vì sao chọn TCP thay vì HTTP proxy hay RabbitMQ RPC?**
  *Ý chính:* nhanh, trực tiếp, registry có vai trò thật; RMQ RPC phụ thuộc broker; HTTP proxy không khớp ý tưởng message pattern. · 📚 #6
- [ ] 🟡 **Message RPC không có HTTP status, gateway trả 201/204 bằng cách nào?**
  *Ý chính:* lấy mã 2xx nhỏ nhất trong `responses` của spec. · 📚 #6
- [ ] 🔴 **Lỗi đi qua TCP mất kiểu, bạn phân loại thế nào?**
  *Ý chính:* `TimeoutError` / `Error` có `code` / chuỗi no-handler / object thường; 4 lớp lỗi → 504/502/502/mã của service. · 📚 #6
- [ ] 🔴 **Kể một bug khó bạn gặp và cách tìm ra.**
  *Ý chính (chọn một):* client TCP cache promise kết nối thất bại; NestJS ghi đè error handler của Fastify; wildcard Express vs Fastify. Nói được **triệu chứng → cách điều tra (đọc source thư viện) → sửa → kiểm chứng**. · 📚 #6
- [ ] 🟡 **Vì sao payload dựng theo allowlist thay vì chuyển nguyên header?**
  *Ý chính:* chống giả danh tính, hợp đồng rõ ràng. · 📚 #6, #21
- [ ] 🟡 **Vì sao một instance gateway chỉ phục vụ một project?** · 📚 #3
- [ ] 🟡 **Vì sao để hợp đồng trong gateway mà không dùng lib chung? Đánh đổi?**
  *Ý chính:* đơn giản, app không phụ thuộc app; đổi hợp đồng phải sửa tay bản copy ở từng service. · 📚 #6
- [ ] 🟡 **Vì sao tách core khỏi NestJS?**
  *Ý chính:* test không cần framework; đổi framework/transport dễ; hexagonal. · 📚 #26
- [ ] 🟡 **Route trie của bạn hoạt động thế nào? Độ phức tạp?** · 📚 #4
- [ ] 🟡 **Load balancer của bạn trả về gì và vì sao?**
  *Ý chính:* trả về thứ tự thử thay vì một instance: phần tử đầu là lựa chọn chính, phần còn lại dùng luôn cho failover. · 📚 #9
- [ ] 🟡 **Bạn test gateway thế nào?** · 📚 #25
- [ ] 🟡 **Vì sao lỗi được chuẩn hoá theo RFC 9457?**
  *Ý chính:* một định dạng cho mọi lỗi; `code` ổn định cho client; `requestId` để truy vết. · 📚 #19
- [ ] 🟡 **Nếu service xử lý chậm hơn timeout thì chuyện gì xảy ra ở cả hai phía?** · 📚 #14
- [ ] 🔴 **Gateway của bạn chưa có gì để chạy production? Bạn sẽ làm tiếp gì?**
  *Ý chính:* load balancing, cache + registry thật, auth, rate limit, metrics/tracing, circuit breaker, hot reload, Docker, TLS. Biết rõ giới hạn của mình là điểm cộng. · 📚 PLAN.md lộ trình

---

## Phần C. Tình huống / system design

Trả lời theo khung: **làm rõ yêu cầu → thiết kế tổng quan → đi sâu 1–2 điểm → đánh đổi → mở rộng**.

- [ ] 🔴 **Thiết kế API gateway cho hệ thống 10.000 request/giây.**
  *Gợi ý:* stateless + scale ngang sau LB; cache discovery; connection pool; rate limit qua Redis; observability; giới hạn CPU trên event loop.
- [ ] 🔴 **Một service downstream chậm làm toàn bộ gateway chậm theo. Vì sao, xử lý thế nào?**
  *Gợi ý:* tài nguyên bị giữ (kết nối, bộ nhớ); timeout, bulkhead theo service, circuit breaker, giới hạn đồng thời.
- [ ] 🔴 **Deploy service mới mà không làm rơi request.**
  *Gợi ý:* readiness, đăng ký vào registry khi sẵn sàng, deregister + drain trước khi tắt, graceful shutdown, rolling deploy.
- [ ] 🔴 **Thiết kế hệ thống login dùng Keycloak + gateway + auth service.**
  *Gợi ý:* phân vai; RS256 + JWKS; route công khai; refresh token; logout. · 📚 #10
- [ ] 🔴 **Thiết kế rate limiter phân tán.** · 📚 #11
- [ ] 🔴 **Thiết kế service registry: API, lưu trữ, heartbeat, cách gateway đồng bộ.** · 📚 #16
- [ ] 🔴 **Đơn hàng cần trừ kho và thanh toán ở 2 service khác nhau, đảm bảo nhất quán thế nào?**
  *Gợi ý:* saga + outbox + idempotency. · 📚 #22
- [ ] 🔴 **Chuyển một monolith sang microservices dần dần.**
  *Gợi ý:* Strangler Fig qua gateway. · 📚 #18
- [ ] 🔴 **Client báo "thỉnh thoảng bị 502". Bạn điều tra thế nào?**
  *Gợi ý:* lấy `requestId` → log gateway (loại lỗi: connection/no-handler/upstream error) → log service; metrics theo instance; kiểm tra instance chết còn trong registry.

---

## Phần D. Câu hỏi đào sâu hay gặp (follow-up)

Phỏng vấn viên thường hỏi tiếp sau câu trả lời của bạn:
- [ ] "Nếu làm lại, bạn sẽ thay đổi gì?"
- [ ] "Cách này có nhược điểm gì?"
- [ ] "Nếu traffic tăng 100 lần thì cái gì vỡ trước?"
- [ ] "Làm sao bạn biết nó hoạt động đúng?" (test, chạy thật, số liệu)
- [ ] "Có phương án nào khác không? Vì sao không chọn?"

---

## Phần E. Câu hỏi hành vi (STAR: Situation, Task, Action, Result)

- [ ] **Kể về một quyết định kỹ thuật bạn phải đánh đổi.** (VD: hợp đồng copy thay vì lib chung; tra theo pattern thay vì tên service)
- [ ] **Kể về lúc bạn phải đọc source thư viện để hiểu vấn đề.** (VD: NestJS TCP client, Fastify error handler)
- [ ] **Kể về lúc yêu cầu thay đổi giữa chừng và bạn xử lý thế nào.** (VD: bỏ quy ước `<service>.<action>`, đổi từ HTTP proxy sang TCP RPC)
- [ ] **Bạn học một công nghệ mới thế nào?** (VD: dự án này: vừa build vừa ghi KNOWLEDGE)

---

## Nhật ký luyện tập

| Ngày | Số câu đã luyện | Câu còn yếu | Ghi chú |
|---|---|---|---|
| | | | |
