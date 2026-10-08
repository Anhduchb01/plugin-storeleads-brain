# StoreLeads Brain cho Claude Code — cài trên Windows (PowerShell), một dòng:
#   irm https://raw.githubusercontent.com/Anhduchb01/plugin-storeleads-brain/main/install.ps1 | iex
# Không có ô nhập (chạy trong Claude/Orca): truyền token vào —
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Anhduchb01/plugin-storeleads-brain/main/install.ps1))) <token>
# Không cần bash hay WSL. Chạy được trên Windows PowerShell 5.1 và PowerShell 7. Never `exit` (irm | iex runs in
# the user's own shell): return.

function Install-StoreLeadsBrain {
  param([string]$Token)
  $Repo = 'Anhduchb01/plugin-storeleads-brain'
  $Server = 'https://storeleads-brain.ecvision.ai'
  $Plugin = 'storeleads-brain@storeleads-brain'
  function Say($m) { Write-Host $m -ForegroundColor Green }
  function Fail($m) { Write-Host "✗ $m" -ForegroundColor Red }

  if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Fail 'Chưa có Claude Code. Cài trước: https://claude.com/claude-code rồi chạy lại.'; return }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'Máy chưa có Git. Cài Git for Windows (https://git-scm.com/download/win) rồi chạy lại.'; return }

  # 1 · token: argument, else BRAIN_TOKEN, else ask (hidden input)
  if (-not $Token) { $Token = $env:BRAIN_TOKEN }
  if (-not $Token) {
    try {
      $sec = Read-Host 'Dán token StoreLeads Brain, rồi Enter' -AsSecureString
      $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    } catch { Fail 'Không hỏi được token. Truyền token vào cuối lệnh (xem README).'; return }
  }
  $Token = ($Token -replace '\s', '')
  if (-not $Token) { Fail 'Chưa có token.'; return }
  try { $who = Invoke-RestMethod -Uri "$Server/whoami" -Headers @{ Authorization = "Bearer $Token" } -TimeoutSec 20 }
  catch { Fail 'Token không dùng được. Kiểm tra lại hoặc xin token mới.'; return }
  Say "✓ Token hợp lệ ($($who.userName))"

  # 2 · plugin (public repo → HTTPS, no GitHub account needed)
  $env:CLAUDE_CODE_PLUGIN_PREFER_HTTPS = '1'
  $known = (claude plugin marketplace list 2>$null | Out-String)
  if ($known -match [regex]::Escape($Repo)) { claude plugin marketplace update storeleads-brain *> $null }
  else {
    claude plugin marketplace add $Repo *> $null
    if ($LASTEXITCODE -ne 0) { Fail 'Không thêm được nguồn plugin từ GitHub.'; return }
  }
  claude plugin install $Plugin *> $null
  claude plugin update $Plugin *> $null   # install is a no-op when already installed
  claude plugin enable $Plugin *> $null
  $values = @{ brain_token = $Token } | ConvertTo-Json -Compress
  $values | claude plugin configure $Plugin --values-stdin *> $null
  if ($LASTEXITCODE -ne 0) { Fail 'Lưu token không được. Nhắn Đức kèm ảnh chụp màn hình này.'; return }
  Say '✓ Plugin StoreLeads Brain đã cài, token lưu an toàn'

  # 3 · pre-approve only this plugin's tools and turn on background auto-update for this marketplace (off by
  #     default, no CLI flag). Nothing else is touched.
  try {
    $p = Join-Path $HOME '.claude\settings.json'
    New-Item -ItemType Directory -Force -Path (Join-Path $HOME '.claude') | Out-Null
    $s = if ((Test-Path $p) -and (Get-Item $p).Length -gt 0) { Get-Content $p -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
    if (-not $s.PSObject.Properties['permissions']) { $s | Add-Member permissions ([pscustomobject]@{}) }
    if (-not $s.permissions.PSObject.Properties['allow']) { $s.permissions | Add-Member allow @() }
    $allow = @($s.permissions.allow)
    if ($allow -notcontains 'mcp__plugin_storeleads-brain_brain') { $allow += 'mcp__plugin_storeleads-brain_brain' }
    $s.permissions.allow = $allow
    if (-not $s.PSObject.Properties['extraKnownMarketplaces']) { $s | Add-Member extraKnownMarketplaces ([pscustomobject]@{}) }
    if (-not $s.extraKnownMarketplaces.PSObject.Properties['storeleads-brain']) {
      $s.extraKnownMarketplaces | Add-Member 'storeleads-brain' ([pscustomobject]@{ source = [pscustomobject]@{ source = 'github'; repo = $Repo } })
    }
    $m = $s.extraKnownMarketplaces.'storeleads-brain'
    if ($m.PSObject.Properties['autoUpdate']) { $m.autoUpdate = $true } else { $m | Add-Member autoUpdate $true }
    $json = $s | ConvertTo-Json -Depth 50
    [IO.File]::WriteAllText($p, $json, (New-Object Text.UTF8Encoding $false))
    Say '✓ Đã cho phép plugin chạy không cần hỏi, bật tự cập nhật'
  } catch { Write-Host '  (bỏ qua bước cấp quyền — Claude Code sẽ hỏi quyền lần đầu, cứ chọn Yes)' }

  Write-Host ''
  Say 'Xong! Mở lại Claude Code (gõ: claude) và dùng như bình thường.'
}

Install-StoreLeadsBrain -Token $(if ($args.Count -gt 0) { $args[0] } else { '' })
