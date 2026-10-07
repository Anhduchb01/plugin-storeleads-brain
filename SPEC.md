# StoreLeads Brain — spec

Bộ nhớ chung ("second brain") cho plugin StoreLeads. Mỗi câu hỏi của user được **tra ký ức trước**, **trả lời
bằng query mới**, rồi **ghi lại câu hỏi và câu trả lời** để (1) đúc kết thành ký ức cho lần sau và (2) phân tích
xem team dùng vào việc gì, hỏng ở đâu, thiếu dữ liệu gì.

Chạy được ở mọi nơi: Claude Code (Mac, Windows), Claude Desktop, claude.ai web.

## 1. Kiến trúc

```
                ┌──────────── storeleads-brain (remote MCP, Streamable HTTP, OAuth Slack) ────────────┐
claude.ai web ─┐│  recall(question)   → ký ức liên quan + mở "lượt"                                 │
Desktop       ─┼▶  query_sql(sql)     → ClickHouse slim (user chỉ-đọc) + ghi SQL/lỗi/số dòng vào lượt  │
Claude Code   ─┘│  record(answer,…)   → đóng lượt                                                    │
                └───────────────┬─────────────────────────────────────────────────────────────────────┘
                                ▼ lượt có chạy query hoặc Claude tự gọi record
                usage.qa_log ──▶ Distiller (Claude) ──▶ usage.qa_distill (nhãn) + usage.memory (ký ức)
```

Thay cho `mcp-grafana` chạy trên máy user: không còn `uv`, không còn token `glsa_`, user đăng nhập bằng Slack.

## 2. Ba tool

| Tool | Ai gọi | Làm gì |
|---|---|---|
| `recall(question, via?)` | Hook `UserPromptSubmit` (Claude Code) hoặc Claude (web) | Tìm ký ức theo từ khoá, mở một lượt mới cho cuộc hội thoại |
| `query_sql(sql)` | Claude | Chặn SQL nguy hiểm → chạy trên `slim` với user chỉ-đọc, tối đa 500 dòng, 60 s → gắn vào lượt |
| `record(answer, outcome?, data_gap?, via?)` | Hook `Stop` (Claude Code) hoặc Claude (web) | Gắn câu trả lời vào lượt và đóng lượt |

"Cuộc hội thoại" = một MCP session (`Mcp-Session-Id`). Session gắn với user tạo ra nó; user khác dùng lại sẽ nhận 404.

### Hai đường ghi nhận

- **Claude Code + plugin:** hook kiểu `mcp_tool` gọi `recall` với `${prompt}` (nguyên văn) và `record` với
  `${last_assistant_message}` (nguyên văn). Chắc chắn, không phụ thuộc Claude có nhớ hay không, chạy trên cả
  Mac lẫn Windows vì không cần shell. Hook dùng chính kết nối MCP đã đăng nhập, không cần thêm khoá nào.
- **Web / Desktop chat (không có hook):** skill và mô tả tool yêu cầu Claude gọi `recall` trước, `record` cuối.
  Không chắc chắn 100%, nên server tự bù: `query_sql` tự mở lượt nếu chưa có, lượt bỏ dở được đóng sau
  `TURN_IDLE_MINUTES`. Đo mức tuân thủ bằng `answer_source = 'none'` theo `client`.

Khi cả hai cùng chạy (Claude Code, Claude vẫn tự gọi `recall`/`record`): server giữ câu hỏi nguyên văn từ hook,
và chờ câu trả lời nguyên văn từ hook `Stop` thay vì bản tóm tắt của Claude.

### Lượt nào được lưu

Hook chạy với **mọi** prompt trong **mọi** project. Server chỉ lưu lượt **có chạy `query_sql`** hoặc **Claude tự gọi
`record`** (Claude chỉ làm vậy với câu hỏi StoreLeads). Prompt không liên quan nằm trong RAM rồi bị bỏ, không ghi xuống đâu.

## 3. Dữ liệu (`sql/schema.sql`, database `usage`)

| Bảng | Một dòng là | Ghi chú |
|---|---|---|
| `qa_log` | một lượt hỏi-đáp | câu hỏi, câu trả lời (TTL 180 ngày), từng SQL + ok/lỗi/số dòng/ms, user, client, lượt trước |
| `qa_distill` | nhãn của một lượt | use_case, outcome, data_gap, apps/categories/countries/months, phản hồi về lượt trước |
| `memory` | một ký ức | kind, scope, keys, text, sql, snapshot_month, status, evidence |
| view `qa` | `qa_log` ⋈ `qa_distill` | dùng cho dashboard |

Kết quả query **không** được lưu (chỉ số dòng). Hai user ClickHouse: `brain_read` chỉ có `SELECT ON slim.*`
(profile `readonly = 2`), `brain_write` chỉ có `SELECT, INSERT ON usage.*`. User đọc không đọc được `usage`, nên
Claude không thể xem câu hỏi của người khác qua `query_sql`.

## 4. Ký ức

| kind | Ví dụ | scope |
|---|---|---|
| `alias` | "Yotpo" = `yotpo-product-reviews`, không phải Yotpo SMS | team |
| `query` | SQL đã chạy đúng cho dạng câu hỏi chưa có recipe | team |
| `fix` | lỗi ClickHouse "correlated subquery" → đặt alias cột trong CTE | team |
| `correction` | người dùng sửa định nghĩa / cách trả lời | team |
| `insight` | "9/2026: leader category reviews chiếm 31%" — **bắt buộc** gắn tháng snapshot | team |
| `preference` | "bạn A luôn chỉ cần store Plus" | riêng user |

Vòng đời: `candidate` (lần đầu) → `verified` khi **3 lượt khác nhau** cùng sinh ra nó, hoặc người dùng xác nhận ở
câu kế tiếp → `rejected` nếu người dùng nói câu trả lời sai (chỉ áp dụng cho candidate). Ký ức trùng nhau được gộp
qua `dedupe_key` (vd. `alias:yotpo`).

Recall: chuẩn hoá câu hỏi (bỏ dấu tiếng Việt, giữ `judge.me`, thêm cặp từ), tìm ký ức có key trùng, xếp theo số
key trùng → verified trước → evidence → mới nhất. Tối đa 8 ký ức + 3 preference. Không trùng gì thì không chèn gì.
Khối chèn vào luôn nhắc: **số liệu phải lấy từ query mới**, ký ức chỉ là gợi ý.

Chặn phía server (không phụ thuộc model): ký ức có ≥ 3 domain bị bỏ (không lưu danh sách store — StoreLeads ToS §2),
insight thiếu tháng bị bỏ.

## 5. Distiller

Chạy nền sau mỗi lượt được lưu, tuần tự, thử lại khi API lỗi tạm thời. Một lời gọi Claude (structured output,
`DISTILL_MODEL`, mặc định `claude-opus-5-5`, effort `low`, có `fallbacks: "default"`) nhận câu hỏi, câu trả lời,
các SQL kèm lỗi, và lượt trước đó; trả về nhãn + 0–n ký ức. Danh mục use case lấy theo 18 id trong
`references/use-cases.md`; câu không khớp → `new:<nhãn>` (ứng viên cho recipe/command mới).

Muốn giảm chi phí: đặt `DISTILL_MODEL=claude-haiku-4-5` (việc phân loại này không cần model lớn) — nên đo chất
lượng trên vài chục lượt thật trước khi đổi.

## 6. Đăng nhập

Hai chế độ (`AUTH_MODE`):

- **`token`** (đang dùng): token cá nhân 48 ký tự do admin cấp bằng `deploy/new-token.sh`, lưu trong
  `deploy/tokens.txt` (`token user_id tên`), server tự nạp lại khi file đổi. Gửi qua header `Authorization: Bearer`.
  Chỉ dùng được từ Claude Code (claude.ai / Desktop chat cần OAuth).
- **`slack`**: OAuth 2.1 (đăng ký client động + PKCE) theo chuẩn MCP, đăng nhập bằng **Sign in with Slack**
  (OpenID Connect), chỉ thành viên `SLACK_TEAM_ID`. Có thể dùng lại Slack app đang dùng cho Grafana, chỉ cần thêm
  redirect URL `PUBLIC_URL/oauth/slack/callback`. Không lưu trạng thái: client id, mã code, access/refresh token đều
  là JWT ký HS256 bằng `JWT_SECRET`; mã code dùng một lần. Access token 1 giờ, refresh token 7 ngày → người rời
  Slack mất quyền trong tối đa 7 ngày. Đổi `JWT_SECRET` = đăng xuất tất cả.

## 7. Phân tích (dashboard Grafana trên view `usage.qa`)

```sql
-- Use case hay dùng và tỉ lệ hỏng, 30 ngày
SELECT use_case, count() AS turns, round(countIf(outcome IN ('failed','partial')) / turns, 3) AS bad_rate
FROM usage.qa WHERE started_at > now() - INTERVAL 30 DAY GROUP BY use_case ORDER BY turns DESC;

-- Dữ liệu còn thiếu, xếp theo số lần được hỏi → backlog thu thập
SELECT data_gap, count() AS asked, uniq(user_id) AS people FROM usage.qa
WHERE data_gap != '' GROUP BY data_gap ORDER BY asked DESC LIMIT 50;

-- Use case mới chưa có trong catalogue → ứng viên recipe / command
SELECT use_case, count() AS turns, any(question) AS example FROM usage.qa
WHERE use_case LIKE 'new:%' GROUP BY use_case ORDER BY turns DESC;

-- Lỗi SQL hay gặp → sửa recipe / thêm caveat
SELECT err, count() AS n FROM usage.qa_log ARRAY JOIN q_error AS err WHERE err != '' GROUP BY err ORDER BY n DESC LIMIT 30;

-- Web có gọi record không? (answer_source = 'none' là bị mất câu trả lời)
SELECT client, count() AS turns, round(countIf(answer_source = 'none') / turns, 3) AS missing_answer FROM usage.qa_log GROUP BY client;
```

## 8. Triển khai

Trên máy ecvision, cạnh `storeleads-clickhouse` và `storeleads-grafana` (chi tiết lệnh: README.md):

1. `deploy/setup.sh` → `deploy/.env` (secret ngẫu nhiên, `AUTH_MODE=token`, `DISTILL_DISABLED=1`) và `tokens.txt`.
2. `deploy/clickhouse-setup.sh` → database `usage` + `brain_read` (profile `readonly = 2`, chỉ `SELECT ON slim.*`)
   + `brain_write` (chỉ `SELECT, INSERT ON usage.*`). Chạy lại được.
3. `docker compose up -d --build` → container `storeleads-brain`, `127.0.0.1:3210`, mạng `clickhouse_default`,
   **một instance** (session MCP nằm trong RAM; restart thì client tự mở session mới, lượt đang mở được ghi trước khi tắt).
4. Cloudflare tunnel `ecvision-staging` (quản lý trên dashboard): public hostname
   `storeleads-brain.ecvision.ai` → `http://localhost:3210`.
5. Plugin (sửa ở repo gốc `qikifyStoreLeadsKnowledge`):
   - `.mcp.json` → `plugin/.mcp.json` (header lấy từ `user_config.brain_token`, thêm `brain_token` vào `userConfig`);
   - `hooks/hooks.json` → `plugin/hooks/hooks.json`;
   - skill → `npm run build:skill` (skill hiện tại + mục Team memory);
   - installer: hỏi token brain thay cho token Grafana, bỏ bước cài `uv`; cấp quyền `mcp__plugin_storeleads_brain`.
6. Sau này: bật Slack sign-in (`AUTH_MODE=slack`), thêm connector cho claude.ai, bật bộ chưng cất
   (`ANTHROPIC_API_KEY`, bỏ `DISTILL_DISABLED`).

Chuyển dần: chạy song song Grafana MCP và brain một thời gian, rồi bỏ Grafana MCP khỏi plugin.

## 9. Đã kiểm chứng / chưa

Đã kiểm chứng:
- 41 test (vitest): chặn SQL (chạy qua **mọi** recipe SQL trong SKILL.md), theo dõi lượt, ký ức, distiller (classifier
  giả), MCP end-to-end, toàn bộ luồng OAuth với Slack giả (PKCE sai, dùng lại code, sai workspace).
- Chạy thật với ClickHouse 25.8 (Docker): grants chặn đọc `usage` và ghi `slim`; recall → query → record ghi đúng
  vào `qa_log`; ký ức được gộp, nâng lên `verified`, bị `rejected` khi người dùng sửa.
- Claude Code 2.1.292 thật với plugin thử: hook ghi đúng câu hỏi và câu trả lời nguyên văn; ký ức được chèn vào
  ngữ cảnh. Phát hiện: kết quả của hook `mcp_tool` chỉ được chèn khi là **JSON `additionalContext`**, text thường
  bị bỏ qua (khác hook `command`) — server đã trả JSON.

- Diễn tập deploy (`deploy/*.sh` + compose) trên ClickHouse 26.8 cùng phiên bản với máy ecvision.

Chưa kiểm chứng:
- Distiller gọi Claude API thật (cần `ANTHROPIC_API_KEY`; mới test với classifier giả).
- Đăng nhập Slack thật và kết nối từ claude.ai / Claude Desktop (cần deploy có HTTPS và Slack app).

## 10. Giới hạn đã biết, việc sau

- Recall theo từ khoá, chưa có embedding. Đủ cho alias / fix (khớp theo tên app); khi số ký ức `query` / `insight`
  lớn thì thêm vector search (ClickHouse có sẵn).
- Session trong RAM → một instance. Cần nhiều instance thì chuyển session sang stateless hoặc sticky session.
- Token không thu hồi được trước hạn (đánh đổi cho thiết kế không trạng thái).
- Bước "tiến hoá thành skill": job hằng tuần lấy ký ức `verified` có evidence cao + use case `new:*` nhiều lượt,
  mở PR vào `qikifyStoreLeadsKnowledge` (recipe / caveat mới) để người duyệt — chưa làm.
