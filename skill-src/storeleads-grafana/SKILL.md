---
name: storeleads-grafana
allowed-tools: Read, mcp__plugin_storeleads_grafana, mcp__grafana
description: Answer questions about Shopify apps and stores with the StoreLeads data through the Grafana MCP (storedata.ecvision.ai, datasource "StoreLeads ClickHouse", database slim). Use for any question about an app's install base, growth, Shopify Plus stores, competitors, app stacks, churn, countries, categories, new apps, merchants or store lists — "how many stores run X", "is X growing", "who competes with X", "what do X's merchants also use", "where do stores go after dropping X", "which category is heating up", "list Plus stores using X". Internal analysis only.
---

# StoreLeads through the Grafana MCP

**The data:** Shopify stores and the apps they run, from StoreLeads. 24 monthly snapshots, Oct 2024 → Sep 2026,
active Shopify stores only. Query it with the Grafana MCP tool `query_sql`, datasource uid `storeleads-ch`,
database `slim`. Read-only.

## Read with care (say these when they apply)

1. **Months are numbers 0–23.** 0 = Oct 2024, 23 = Sep 2026 (the latest). Date of month m:
   `addMonths(toDate('2024-10-01'), m)`. "Now", "right now", "this month" and "last month" all mean the LATEST
   snapshot, month 23 (Sep 2026) — people say "last month" because the newest data is last month's. "The month
   before" = 22. "N months ago" = 23 − N ("12 months ago" = 11).
   "Last N days" counts back from the snapshot date **2026-09-27**, never from today's date.
   Data before Oct 2024 does not exist — say so, never guess.
2. **Pick apps by `app_key`, never by name.** Names collide ("Product Reviews" is Shopify's own app). Resolve
   first (recipe 0). For an app or brand NAME ("Yotpo", "Loox"): if one candidate has over 2× the stores of the
   next, take it, say which one in one line and name the others — don't stop to ask. A generic word ("the reviews
   app", "an email app") is never a name: always list candidates and ask (see Working rules).
3. **`losses` counts stores that no longer have the app, INCLUDING stores that left the data** (closed, paused,
   not crawled). To count real uninstalls, use recipe 7 (drops while the store stays active).
4. **One shop with several domains counts once**, so app store counts run 1–7% under StoreLeads' own figures.
   `app_month.installs` is StoreLeads' own number (every domain) — don't mix the two in one comparison.
5. **Crawl artefacts:** Plus dips in Feb 2025 and Feb 2026, a store jump in Nov 2025, some apps jump in Sep 2026.
   Don't read those months as real trends, and don't call Sep 2026 a clean end point when an app jumps there.
6. **Categories:** use the app's `primary_category` (each install counts once, categories add up). Level 1 /
   Level 2 names ("Marketing and conversion", "Social trust"…) are a DRAFT grouping of those categories — look the
   name up in `references/categories.md` (read the file; never fetch the map from a dashboard) and filter with the
   leaf list given there. If the file can't be read, list the leaves with `query_sql` — never shrink a Level 1 / 2
   scan to one leaf; if the scope is incomplete, say so in the first line.
   `category_month_agg` counts an app in every category it is LISTED under — don't sum it across categories.
7. **Licence:** internal analysis only (StoreLeads ToS §2). Never export store lists for outreach. Show at most
   100 stores (500 if asked); for a full list say: *"DM Toàn (Thomas) on Slack with these filters"*.
8. Never use the tables `stg_*`, `land`, `mv_*`, `loaded_months` or anything outside `slim`.

## Working rules

- **Run every query yourself** with `query_sql` (datasource uid `storeleads-ch`) and answer with the result.
  Never hand SQL back to the person or end on "let me run this". If a query errors, read the error, fix it, run
  again; after 3 failed tries, answer with what you have and say what failed.
- **Start from a recipe below** and change only the CAPS values — they are tested. One or two queries answer
  almost every question. Briefs, scans, checks, post-mortems and report pages are taught to the team as use cases:
  `references/use-cases.md` maps each to its recipes, caveats and answer shape.
- **Let SQL do the arithmetic.** Totals over months, differences, shares, averages: compute them in the query
  (`sum`, `sumIf`, `/`), never add up rows by hand.
- **Store counts, not installs.** Sizes, ranks, shares and growth use `stores` from `app_month_agg`.
  `app_month.installs` only when the person asks for StoreLeads' own reported install number.
- **A generic word is not an app.** "the reviews app", "an email app", "upsell" name a category, not one app:
  list the top 3–5 candidates (recipe 0) and ask which one. Answer only when the app is unambiguous.
- **Store lists stop at the cap.** Never give a query, a method or a workaround for pulling the full list — the
  only route to more rows is *"DM Toàn (Thomas) on Slack with these filters"*.
- **Counting stores (platform totals, Plus, by country):** use `store_dim` — `countIf(bitTest(active_months, 23))`,
  `countIf(bitTest(plus_months, 23))`. Don't rebuild store totals from the `*_agg` tables.

## Say it → compute it

| Question says | Formula (month 23 unless stated) |
|---|---|
| "share of X's stores on Plus / in the US" | X's Plus (or US) stores ÷ X's stores — a part of X's OWN base |
| "X's share of Plus stores / of the US" | X's Plus (or US) stores ÷ ALL Plus (or US) stores (`store_dim`) |
| "% of stores on Plus" | Plus stores ÷ active stores, both from `store_dim` |
| "apps per store (average)" | `countIf(bitTest(months, 23))` in `store_app` ÷ active stores in `store_dim` |
| "grew N%" over N months | stores(23) ÷ stores(23 − N) − 1 |
| "lost to real uninstalls" | recipe 7 `dropped_app` (store still active), not `losses` |

Give percentages to one decimal (2.3%), with the two counts behind them.

## The tables (database `slim`)

| Table | One row per | Use for |
|---|---|---|
| `app_dim` | app | `app_id`, `app_key`, `name`, `vendor_name`, `primary_category`, `created_at` (listed), `plans` |
| `app_month_agg` | app × month × country × Plus flag | `stores`, `adds`, `losses` — the fast table for any app trend |
| `app_month` | app × month | StoreLeads-reported `installs`, `installs_30d`, `installs_90d`, `average_rating`, `review_count`, `min_price_cents`, `max_price_cents` (worldwide only) |
| `store_dim` | store | `domain`, `merchant_name`, `country_code`, `plan`, `estimated_sales` (cents/month), `estimated_visits`, `theme_name`, `created_at`, `active_months` / `plus_months` (24-bit masks), `apps_now` |
| `store_app` | store × app | `months` bitmask (`bitTest(months, m)` = had the app in month m), `installed_at`, `country_code`, `leaf` (= app's primary category) |
| `store_month` | store × month | `plan`, `estimated_sales`, `monthly_app_spend`, `product_count`, `app_count` |
| `category_month_agg` | category × month × country × Plus | `stores` (distinct stores with an app LISTED there), `installs`, `apps` |

Plus filter: `is_plus = 1` in the `*_agg` tables; `bitTest(plus_months, m)` on `store_dim`.
Active in month m: `bitTest(active_months, m)`.

## Recipes (replace the values in CAPS)

**0 · Find the app key**
```sql
SELECT d.app_key, d.name, d.vendor_name, d.primary_category, sum(a.stores) AS stores_now
FROM slim.app_dim d LEFT JOIN slim.app_month_agg a ON a.app_id = d.app_id AND a.month = 23
WHERE d.name ILIKE '%NAME%' OR d.app_key ILIKE '%NAME%' GROUP BY 1, 2, 3, 4 ORDER BY stores_now DESC LIMIT 10
```

**1 · Size now, Plus, trend (U1, U3)**
```sql
SELECT addMonths(toDate('2024-10-01'), month) AS m, sum(stores) AS stores, sumIf(stores, is_plus = 1) AS plus_stores,
       sum(adds) AS gained, sum(losses) AS lost
FROM slim.app_month_agg WHERE app_id = (SELECT app_id FROM slim.app_dim WHERE app_key = 'KEY')
GROUP BY month ORDER BY month
```
Add `AND country_code = 'US'` for one country. Growth over N months = stores at 23 vs 23 − N.
Several apps side by side: `WHERE app_id IN (SELECT app_id FROM slim.app_dim WHERE app_key IN ('K1','K2'))`,
`GROUP BY app_id`, and `plus_stores / stores AS plus_share` per app.

**2 · Rank among all apps**
```sql
WITH (SELECT sum(stores) FROM slim.app_month_agg WHERE month = 23 AND app_id = (SELECT app_id FROM slim.app_dim WHERE app_key = 'KEY')) AS me
SELECT 1 + countIf(s > me) AS app_rank, count() AS apps FROM (SELECT app_id, sum(stores) AS s FROM slim.app_month_agg WHERE month = 23 GROUP BY app_id)
```

**3 · Competitors now vs N months ago (S1, S3)** — same primary category
```sql
WITH (SELECT primary_category FROM slim.app_dim WHERE app_key = 'KEY') AS c, 23 - N AS t0
SELECT d.name, sumIf(a.stores, a.month = t0) AS stores_then, sumIf(a.stores, a.month = 23) AS stores_now,
       stores_now - stores_then AS net_change, sumIf(a.stores, a.month = 23 AND a.is_plus = 1) AS plus_now,
       stores_now / sum(stores_now) OVER () AS share_now
FROM slim.app_month_agg a JOIN slim.app_dim d ON d.app_id = a.app_id
WHERE d.primary_category = c AND a.month IN (t0, 23) GROUP BY d.name ORDER BY stores_now DESC LIMIT 15
```

**4 · Stack: what else these stores run (U2)** — order-free; add the `AND store_id IN (…KEY2…)` line for "A and B"
```sql
WITH (SELECT app_id FROM slim.app_dim WHERE app_key = 'KEY') AS a,
  coh AS (SELECT store_id FROM slim.store_app WHERE app_id = a AND bitTest(months, 23)
          /* AND store_id IN (SELECT store_id FROM slim.store_app WHERE app_id = (SELECT app_id FROM slim.app_dim WHERE app_key = 'KEY2') AND bitTest(months, 23)) */)
SELECT d.name, count() AS stores, stores / (SELECT count() FROM coh) AS share_of_stack
FROM slim.store_app s JOIN slim.app_dim d ON d.app_id = s.app_id
WHERE s.store_id IN coh AND bitTest(s.months, 23) AND s.app_id != a GROUP BY d.name ORDER BY stores DESC LIMIT 20
```

**5 · Countries and reach index (U4)**
```sql
WITH (SELECT app_id FROM slim.app_dim WHERE app_key = 'KEY') AS a,
  plat AS (SELECT country_code, countIf(bitTest(active_months, 23)) AS n_all FROM slim.store_dim GROUP BY country_code),
  me AS (SELECT country_code, sum(stores) AS n FROM slim.app_month_agg WHERE app_id = a AND month = 23 GROUP BY country_code),
  (SELECT sum(n) FROM me) / (SELECT sum(n_all) FROM plat) AS rate
SELECT country_code, me.n AS stores, me.n / plat.n_all AS reach, reach / rate AS index_vs_platform
FROM me JOIN plat USING country_code WHERE country_code != '' ORDER BY stores DESC LIMIT 30
```
index > 1 = stronger there than across the platform.

**6 · Plus whitespace: Plus stores with no app in a category (S5)**
```sql
WITH has_c AS (SELECT DISTINCT store_id FROM slim.store_app WHERE leaf = 'CATEGORY' AND bitTest(months, 23))
SELECT country_code, count() AS plus_stores, countIf(store_id NOT IN has_c) AS without_one
FROM slim.store_dim WHERE bitTest(plus_months, 23) AND country_code != '' GROUP BY country_code ORDER BY plus_stores DESC LIMIT 20
```

**7 · Churn: real drops vs stores leaving, and where droppers went (S7)**
```sql
-- drops per month: had it in m-1, not in m; split by whether the store is still active in m
WITH (SELECT app_id FROM slim.app_dim WHERE app_key = 'KEY') AS a,
  l AS (SELECT store_id, bitAnd(bitAnd(bitShiftLeft(months, 1), bitNot(months)), 16777214) AS lost FROM slim.store_app WHERE app_id = a AND lost != 0),
  la AS (SELECT store_id, l.lost AS lost, sd.active_months AS act FROM slim.store_dim sd JOIN l USING store_id WHERE sd.store_id IN (SELECT store_id FROM l))
SELECT addMonths(toDate('2024-10-01'), m) AS month, countIf(bitTest(lost, m) AND bitTest(act, m)) AS dropped_app,
       countIf(bitTest(lost, m) AND NOT bitTest(act, m)) AS store_left_data
FROM la ARRAY JOIN range(1, 24) AS m GROUP BY month ORDER BY month
```
Where they went: apps those droppers ADDED the same or the next month —
`bitAnd(bitAnd(o.months, bitNot(bitShiftLeft(o.months, 1))), bitOr(dm, bitShiftLeft(dm, 1))) != 0`, where `dm` is the
store's drop mask restricted to active months (`bitAnd(lost, act)`). Always alias CTE columns explicitly
(`SELECT store_id, l.lost AS lost …`) — ClickHouse otherwise reports "correlated subquery".

**8 · Category leaders, momentum, newcomers (S1, S2, S3)**
```sql
WITH 23 - N AS t0
SELECT d.primary_category AS category, d.name, sumIf(a.stores, a.month = 23) AS stores_now, sumIf(a.stores, a.month = t0) AS stores_then,
       stores_now / sum(stores_now) OVER (PARTITION BY category) AS share_in_category, d.created_at AS listed
FROM slim.app_month_agg a JOIN slim.app_dim d ON d.app_id = a.app_id
WHERE d.primary_category = 'CATEGORY' AND a.month IN (t0, 23) GROUP BY category, d.name, listed ORDER BY stores_now DESC LIMIT 25
```
Newcomers: add `AND d.created_at >= toDate('2025-09-27')` (listed in the last 12 months).
Fragmented = leader share < 20%. Weak leader = leader rating (`app_month.average_rating`, month 23) < 4.5.

**9 · New stores: what stores created in the last 90 days run (S4, S6)**
`store_dim.created_at >= toDate('2026-09-27') - INTERVAL 90 DAY AND bitTest(active_months, 23)`; join `store_app`
with `bitTest(months, 23)`. Themes: `store_dim.theme_name` with an index vs all active stores.

**10 · Store list (capped, internal)**
```sql
SELECT domain, merchant_name, country_code, plan, estimated_sales / 100 AS est_sales_usd_month, theme_name
FROM slim.store_dim
WHERE bitTest(active_months, 23) AND store_id IN (SELECT store_id FROM slim.store_app WHERE app_id = (SELECT app_id FROM slim.app_dim WHERE app_key = 'KEY') AND bitTest(months, 23))
  /* AND country_code = 'US' AND bitTest(plus_months, 23) */
ORDER BY estimated_sales DESC NULLS LAST LIMIT 100
```
Give the total count separately; past 100 rows, point to Thomas for the full list.

## How to answer

- Resolve names first; quote numbers exactly as returned, with the month they refer to.
- Run every step the question needs; if you skip one, say which. Don't end on a question unless you truly can't
  go on — answer on the most likely reading and say what you assumed.
- Check every "×", "share of" or "% of" claim against the numbers before writing it. Fragmented = leader share
  under 20%; a leader at 20% or more is never "fragmented". Stack answers always show lift.
- Answer in the person's language. Vietnamese: 12.943 and 5,4%. English: 12,943 and 5.4%. Never mix in one answer.
- Say "stores" only for distinct stores; a sum over categories or apps is "installs" (a store can count twice).
  Whenever you cite a number of apps or countries, name the filter or the set (e.g. "apps with 100+ stores", "top 5 countries").
- A report or one-page request: write one self-contained HTML file to `~/Downloads/storeleads-<topic>.html` (charts as
  inline SVG, tables, caveats, the Source line) and give its path. If writing is blocked, put the full HTML in the chat.
- When a standard dashboard shows the answer, add its link (folder StoreLeads, same data): App deep-dive
  `https://storedata.ecvision.ai/d/sl-app-<overview|growth|stack|competition|geo|merchants|churn>/?var-app=KEY`;
  Category overview `/d/sl-cat-<map|momentum|leaders|entrants|geo|stacks>/?var-l1=…&var-l2=…&var-category=…`.
- Say which caveat applies (losses include stores leaving, artefact months, draft categories).
- Keep queries on the `*_agg` tables when possible; `store_app` scans are fine but heavier.
- End with one line people can paste: *"Source: StoreLeads (internal), Oct 2024 – Sep 2026, via Grafana."*
