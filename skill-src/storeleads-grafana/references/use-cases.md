# Use cases people are taught (user guide catalogue)

The team's user guide teaches these prompts (Vietnamese or English). Match the person's question to a case, run its
recipes (numbers = `## Recipes` in SKILL.md), say its caveats, and answer in the shape described. Answer in the
language the person used. Generated from `src/data/guide-cases.ts` by `npm run skill:grafana`; never edit by hand.

## Caveat codes

- `latest`: "Now" is the latest snapshot (month 23, Sep 2026); "last N days" counts back from 2026-09-27.
- `history`: No data before Oct 2024 — say so, never extrapolate.
- `app-key`: Resolve apps to app_key first; ask when a name is ambiguous.
- `losses`: losses include stores that left the data; real uninstalls = recipe 7 dropped_app (store still active).
- `domains`: One shop with several domains counts once — counts run slightly under StoreLeads' own.
- `crawl`: Crawl artefacts: Plus dips Feb 2025 / Feb 2026, store jump Nov 2025, some app spikes Sep 2026 — flag them.
- `draft-group`: Level 1 / Level 2 is a DRAFT grouping — say so whenever an answer leans on it.
- `licence`: Internal analysis only (StoreLeads ToS §2); store lists capped, never for outreach.

## competitor

### app-size

- **Asked like:** "How many active stores run Klaviyo, and what share are on Plus?" · "Where does Loox rank among all Shopify apps?" · "Klaviyo đang có bao nhiêu store, bao nhiêu % là Shopify Plus?" · "Loox đứng thứ mấy trong tất cả app Shopify?"
- **Intent:** Install base now (store count, Plus share), rank among all apps, short trend. Use stores from app_month_agg, not StoreLeads installs, unless asked.
- **Recipes:** 0, 1, 2
- **Caveats:** `latest`, `app-key`, `domains`
- **Dashboard to link:** sl-app-overview (Overview) — https://storedata.ecvision.ai/d/sl-app-overview

### app-competitors

- **Asked like:** "Who competes with Judge.me in its category, and who gained most over the last 12 months?" · "Ai là đối thủ của Judge.me trong cùng category, ai đang thắng 12 tháng qua?"
- **Intent:** Same primary category, now vs N months ago (default 12), gains/losses and share. Name the comparison window.
- **Recipes:** 0, 3
- **Caveats:** `latest`, `app-key`, `crawl`
- **Dashboard to link:** sl-app-competition (Competition) — https://storedata.ecvision.ai/d/sl-app-competition

### app-brief · /storeleads:competitor-brief

- **Asked like:** "Write a competitor brief on Yotpo." · "Làm brief đối thủ cho Yotpo."
- **Intent:** Run recipes 1, 3, 4, 5, 7 for one app (all of recipe 7, including where droppers went) and write a one-page brief in plain words; keep every caveat.
- **Recipes:** 0, 1, 3, 4, 5, 7
- **Caveats:** `latest`, `app-key`, `losses`, `crawl`
- **Dashboard to link:** sl-app-overview (Overview → all tabs) — https://storedata.ecvision.ai/d/sl-app-overview

### app-stack

- **Asked like:** "Among stores running both Klaviyo and Judge.me, what else do they most often have?" · "Store dùng cả Klaviyo và Judge.me thì hay dùng thêm app gì?"
- **Intent:** Order-free stack: companions of A (and of A+B) with share of stack AND lift (vs platform rate). Never imply install order or add shares across companions.
- **Recipes:** 0, 4
- **Caveats:** `latest`, `app-key`
- **Dashboard to link:** sl-app-stack (Stack) — https://storedata.ecvision.ai/d/sl-app-stack

## opportunity

### gap

- **Asked like:** "Which categories are crowded but have a weak or fragmented leader?" · "Category nào nhiều store dùng nhưng app dẫn đầu rating thấp hoặc chưa ai thống trị?"
- **Intent:** Category leaders with share + rating. Rank only categories where the leader holds under 20% of stores OR is rated under 4.5; never call a leader at 20%+ fragmented.
- **Recipes:** 8
- **Caveats:** `latest`, `draft-group`, `crawl`
- **Dashboard to link:** sl-cat-leaders (Leaders) — https://storedata.ecvision.ai/d/sl-cat-leaders

### idea-check · /storeleads:app-idea-check

- **Asked like:** "We're thinking of an upsell app. Is it worth it?" · "Mình định làm app upsell. Thị trường này có đáng làm không?"
- **Intent:** Pick the matching categories and name them. Count apps and stores from app_month_agg at month 23. Then saturation, leader strength (share + rating per leader), newcomers, price points, Plus whitespace. Verdict by rule: go = leader under 20% or rated under 4.5 and newcomers gaining; no = a leader over 40% rated 4.7+; else maybe. State which rule fired.
- **Recipes:** 3, 6, 8
- **Caveats:** `latest`, `draft-group`, `crawl`
- **Dashboard to link:** sl-cat-map (Map) — https://storedata.ecvision.ai/d/sl-cat-map

### newcomers

- **Asked like:** "Which app listed in the last 12 months has the most stores in upsell and cross-sell?" · "App nào mới lên App Store trong 12 tháng qua mà đã có nhiều store nhất trong category upsell?"
- **Intent:** Apps first listed in the window, ranked by stores now, within the category if given.
- **Recipes:** 8
- **Caveats:** `latest`, `draft-group`
- **Dashboard to link:** sl-cat-entrants (Entrants) — https://storedata.ecvision.ai/d/sl-cat-entrants

### category-scan · /storeleads:category-scan

- **Asked like:** "Scan the Marketing and conversion category for me." · "Quét giúp mình category Marketing and conversion."
- **Intent:** Category door end to end over the WHOLE scope (expand a Level 1 / Level 2 name to all its leaves via references/categories.md): momentum vs market, leaders, fragmentation, entrants, Plus whitespace, and stacks (recipe 4 on the top 3 leaders). If the scope is incomplete, say so first.
- **Recipes:** 4, 6, 8
- **Caveats:** `latest`, `draft-group`, `crawl`
- **Dashboard to link:** sl-cat-momentum (Momentum) — https://storedata.ecvision.ai/d/sl-cat-momentum

## growth

### app-growth · /storeleads:growth-check

- **Asked like:** "How much did PageFly grow over the last 6 months?" · "Compare Klaviyo's and Omnisend's growth." · "PageFly tăng bao nhiêu % store trong 6 tháng qua?" · "So sánh tăng trưởng Klaviyo và Omnisend."
- **Intent:** Month-by-month stores (all + Plus), percent change over the window; flag crawl artefacts inside it.
- **Recipes:** 0, 1
- **Caveats:** `latest`, `crawl`, `history`
- **Dashboard to link:** sl-app-growth (Growth) — https://storedata.ecvision.ai/d/sl-app-growth

### fastest

- **Asked like:** "Which app gained the most Plus stores over the last 12 months?" · "App nào tăng nhiều store Plus nhất 12 tháng qua?" · "Trong nhóm Social trust, app nào tăng nhiều nhất?"
- **Intent:** Rank apps by net gain in the window, all-store or Plus, optionally inside a category / Level 2.
- **Recipes:** 3, 8
- **Caveats:** `latest`, `crawl`, `draft-group`
- **Dashboard to link:** sl-cat-momentum (Momentum) — https://storedata.ecvision.ai/d/sl-cat-momentum

## churn

### churn-where

- **Asked like:** "When merchants drop Klaviyo, which email app do they switch to?" · "Khi bỏ Klaviyo, merchant chuyển sang app email nào nhiều nhất?"
- **Intent:** Real drops (store still active) vs stores that left; destinations in the SAME primary category only (an email app, not a form builder). Shares = switchers / real drops, checked against the table.
- **Recipes:** 0, 7
- **Caveats:** `losses`, `app-key`, `crawl`
- **Dashboard to link:** sl-app-churn (Churn) — https://storedata.ecvision.ai/d/sl-app-churn

### churn-postmortem · /storeleads:churn-postmortem

- **Asked like:** "Do a churn post-mortem for Loox." · "Làm post-mortem churn cho Loox."
- **Intent:** Separate real drops from stores leaving; monthly drop rate; destinations by plan and country.
- **Recipes:** 7
- **Caveats:** `losses`, `crawl`
- **Dashboard to link:** sl-app-churn (Churn) — https://storedata.ecvision.ai/d/sl-app-churn

## market

### countries

- **Asked like:** "Which countries hold most Klaviyo stores?" · "Is Judge.me stronger in the UK or Australia relative to its reach?" · "Klaviyo có nhiều store nhất ở 2 nước nào?" · "Judge.me mạnh ở UK hay Úc hơn, so với độ phủ chung?"
- **Intent:** Stores by country plus reach index vs the app's overall share.
- **Recipes:** 0, 5
- **Caveats:** `latest`, `app-key`
- **Dashboard to link:** sl-app-geo (Geo) — https://storedata.ecvision.ai/d/sl-app-geo

### plus-gap · /storeleads:plus-gap

- **Asked like:** "How many US Plus stores have no reviews app?" · "Bao nhiêu store Plus ở Mỹ chưa có app review nào?"
- **Intent:** Plus stores with no app in the category, by country. Counts only — no lists for outreach.
- **Recipes:** 6
- **Caveats:** `latest`, `licence`
- **Dashboard to link:** sl-cat-geo (Geo) — https://storedata.ecvision.ai/d/sl-cat-geo

### new-stores

- **Asked like:** "What share of stores created in the last 90 days run Klaviyo?" · "Bao nhiêu % store mở trong 90 ngày qua dùng Klaviyo?"
- **Intent:** Stores created in the last 90 days (from the snapshot date) and what they run.
- **Recipes:** 9
- **Caveats:** `latest`
- **Dashboard to link:** sl-app-merchants (Merchants) — https://storedata.ecvision.ai/d/sl-app-merchants

### themes

- **Asked like:** "Which theme do Judge.me merchants use most?" · "Merchant của Judge.me dùng theme nào nhiều nhất?"
- **Intent:** Theme mix of the app's stores vs all stores.
- **Recipes:** 9
- **Caveats:** `latest`
- **Dashboard to link:** sl-app-merchants (Merchants) — https://storedata.ecvision.ai/d/sl-app-merchants

## pitch

### report

- **Asked like:** "Make a one-page report on Klaviyo: size, growth, top countries." · "Turn the answers above into one report page." · "Làm một trang báo cáo về Klaviyo: quy mô, tăng trưởng, nước mạnh nhất, để gửi sếp." · "Gộp các câu trả lời ở trên thành một trang báo cáo gửi sếp."
- **Intent:** One self-contained HTML page with charts, tables, caveats and a cite line (data + snapshot date): reuse answers already in this chat, or run the recipes the request names. Save it as a file and give its path.
- **Recipes:** 1, 5
- **Caveats:** `licence`, `latest`

### store-list

- **Asked like:** "Show 20 German Plus stores running Klaviyo but not Shopify Inbox." · "Cho mình 20 store Plus ở Đức đang dùng Klaviyo nhưng chưa có Shopify Inbox."
- **Intent:** Count first; list capped; refuse full exports and point to Thomas (licence).
- **Recipes:** 10
- **Caveats:** `licence`
- **Dashboard to link:** sl-app-merchants (Stores list) — https://storedata.ecvision.ai/d/sl-app-merchants
