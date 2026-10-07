#!/usr/bin/env bash
# StoreLeads Brain cho Claude Code — cài bằng một dòng (Mac / Linux):
#   curl -fsSL https://raw.githubusercontent.com/Anhduchb01/plugin-storeleads-brain/main/install.sh | bash
# Không có ô nhập (chạy trong Claude Code, Orca, CI): truyền token vào cuối lệnh —
#   curl -fsSL …/install.sh | bash -s -- <token>
# Chạy lại bất cứ lúc nào để đổi token hoặc cập nhật plugin.
set -euo pipefail

REPO="${BRAIN_REPO:-Anhduchb01/plugin-storeleads-brain}"   # BRAIN_REPO=owner/repo#branch for testing
SERVER="https://storeleads-brain.ecvision.ai"
PLUGIN="storeleads-brain@storeleads-brain"
say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v claude >/dev/null || die "Chưa có Claude Code. Cài trước: https://claude.com/claude-code rồi chạy lại dòng này."
command -v git >/dev/null || die "Máy chưa có git. Trên Mac: chạy 'xcode-select --install', xong chạy lại dòng này."

# 1 · token: first argument, else BRAIN_TOKEN, else ask (read from the terminal, since stdin is this script)
TOKEN="${1:-${BRAIN_TOKEN:-}}"
if [ -z "$TOKEN" ]; then
  { : </dev/tty; } 2>/dev/null || die "Không có bàn phím để hỏi token. Dán token vào cuối lệnh:
  curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash -s -- <token>"
  printf 'Dán token StoreLeads Brain, rồi Enter: '
  IFS= read -rs TOKEN </dev/tty; echo
fi
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
[ -n "$TOKEN" ] || die "Chưa có token."
who="$(curl -fsS -m 20 -H "Authorization: Bearer $TOKEN" "$SERVER/whoami" 2>/dev/null || true)"
[ -n "$who" ] || die "Token không dùng được. Kiểm tra lại hoặc xin token mới."
say "✓ Token hợp lệ ($(printf '%s' "$who" | sed -n 's/.*"userName":"\([^"]*\)".*/\1/p'))"

# 2 · plugin (public repo → HTTPS, no GitHub account needed)
export CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1
if claude plugin marketplace list 2>/dev/null | grep -q "${REPO%%#*}"; then
  claude plugin marketplace update storeleads-brain >/dev/null 2>&1 || true
else
  claude plugin marketplace add "$REPO" >/dev/null || die "Không thêm được nguồn plugin từ GitHub."
fi
claude plugin install "$PLUGIN" >/dev/null 2>&1 || true
claude plugin update "$PLUGIN" >/dev/null 2>&1 || true   # install is a no-op when already installed
claude plugin enable "$PLUGIN" >/dev/null 2>&1 || true
printf '{"brain_token":"%s"}' "$TOKEN" | claude plugin configure "$PLUGIN" --values-stdin >/dev/null \
  || die "Lưu token không được. Nhắn Đức kèm ảnh chụp màn hình này."
say "✓ Plugin StoreLeads Brain đã cài, token lưu trong keychain"

# 3 · pre-approve only this plugin's tools so nobody meets a permission prompt. Other permissions stay as they were.
SETTINGS="$HOME/.claude/settings.json"
if command -v python3 >/dev/null; then
  python3 - "$SETTINGS" <<'PY' || echo "  (bỏ qua bước cấp quyền — Claude Code sẽ hỏi quyền lần đầu, cứ chọn Yes)"
import json, os, sys
p = sys.argv[1]
s = json.load(open(p)) if os.path.exists(p) and os.path.getsize(p) else {}
allow = s.setdefault("permissions", {}).setdefault("allow", [])
if "mcp__plugin_storeleads-brain_brain" not in allow:
    allow.append("mcp__plugin_storeleads-brain_brain")
os.makedirs(os.path.dirname(p), exist_ok=True)
json.dump(s, open(p, "w"), indent=2, ensure_ascii=False)
PY
  say "✓ Đã cho phép plugin chạy không cần hỏi"
fi

echo
say "Xong! Mở lại Claude Code (gõ: claude) và dùng như bình thường."
