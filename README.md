# storeleads-brain

Remote MCP server cho plugin StoreLeads: `query_sql` trên ClickHouse `slim` + bộ nhớ chung của team
(`recall` / `record`) + nhật ký hỏi-đáp (`usage.qa_log`) để phân tích. Thiết kế: [SPEC.md](SPEC.md).

**Trạng thái hiện tại:** chỉ ghi log. Bộ chưng cất tắt (`DISTILL_DISABLED=1`), đăng nhập bằng token cá nhân
(`AUTH_MODE=token`, dùng từ Claude Code). Bật Slack sign-in và bộ chưng cất sau.

```
src/
  server.ts      khởi động: config, ClickHouse, distiller, HTTP
  app.ts         Express: /mcp (Streamable HTTP, session theo user), OAuth routes, /healthz
  mcp.ts         3 tool: recall, query_sql, record
  turns.ts       ghép câu hỏi ↔ SQL ↔ câu trả lời theo cuộc hội thoại
  memory.ts      recall + khối <storeleads-memory>
  distiller.ts   gán nhãn lượt + đúc kết ký ức (Claude)
  store.ts       ClickHouse + in-memory store
  sqlGuard.ts    chặn SQL ghi / bảng ngoài slim / table function
  keys.ts        chuẩn hoá từ khoá (bỏ dấu, judge.me, cặp từ)
  auth/          static.ts (token cá nhân), slack.ts (OAuth 2.1 + Slack OIDC), tokens.ts (JWT)
sql/schema.sql   database usage
deploy/          docker-compose + script cho máy ecvision
plugin/          plugin Claude Code storeleads-brain (.mcp.json, hooks), marketplace ở .claude-plugin/
install.sh/.ps1  installer một dòng cho user
skill-src/       bản sao skill StoreLeads + mục Team memory (nguồn cho build:skill và test)
scripts/         build-skill.mjs, smoke.ts
```

## Deploy trên ecvision

Máy ecvision đã chạy `storeleads-clickhouse` và `storeleads-grafana` (mạng docker `clickhouse_default`) và
Cloudflare tunnel `ecvision-staging`.

```bash
git clone https://github.com/Anhduchb01/plugin-storeleads-brain.git ~/storeleads-brain
cd ~/storeleads-brain/deploy
./setup.sh               # .env với secret ngẫu nhiên + tokens/tokens.txt (giữ nguyên nếu đã có)
./clickhouse-setup.sh    # database usage, user brain_read (chỉ SELECT slim), brain_write (SELECT/INSERT usage)
docker compose up -d --build
curl -s localhost:3210/healthz
```

Cloudflare Zero Trust → Networks → Tunnels → `ecvision-staging` → Public hostnames → Add:
`storeleads-brain.ecvision.ai` → `HTTP` → `localhost:3210`.

Cấp / thu hồi token (server tự nạp lại trong vài giây, không cần restart):

```bash
./new-token.sh U012ABC "Nguyễn Văn A"   # in token ra một lần
./revoke-token.sh U012ABC
```

Cập nhật: `git pull && docker compose up -d --build`.

Kiểm tra từ máy bất kỳ: `BRAIN_URL=https://storeleads-brain.ecvision.ai BRAIN_TOKEN=<token> npm run smoke`.

## Cài cho user (Claude Code)

Gửi cho user token (từ `./new-token.sh`) và một dòng tương ứng, rồi Enter, dán token khi được hỏi:

**Mac / Linux** — Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/Anhduchb01/plugin-storeleads-brain/main/install.sh | bash
```

**Windows** — PowerShell:

```powershell
irm https://raw.githubusercontent.com/Anhduchb01/plugin-storeleads-brain/main/install.ps1 | iex
```

Installer kiểm tra token, cài plugin `storeleads-brain` (kết nối MCP + hook ghi câu hỏi/câu trả lời), lưu token
trong keychain và cho phép tool của plugin chạy không cần hỏi. Mở lại Claude Code là xong. Dùng song song với
plugin StoreLeads hiện tại; chạy lại dòng cài để đổi token hoặc cập nhật.

Không có ô nhập (chạy trong Claude, Orca): dán token vào cuối lệnh —
`curl -fsSL …/install.sh | bash -s -- <token>` ·
`& ([scriptblock]::Create((irm …/install.ps1))) <token>`.

Gỡ: `claude plugin uninstall storeleads-brain@storeleads-brain`.

## Phát triển

```bash
npm install
npm test
cp .env.example .env   # AUTH_MODE=token, ACCESS_TOKENS=tok-me:U_ME, CLICKHOUSE_URL=http://localhost:8123 …
set -a; . ./.env; set +a; npm run dev
BRAIN_URL=http://localhost:8080 BRAIN_TOKEN=tok-me npm run smoke
npm run build:skill    # → dist/storeleads-skill.zip cho claude.ai
```
