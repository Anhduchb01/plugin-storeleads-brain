---
name: storeleads-brain
allowed-tools: mcp__plugin_storeleads-brain_brain
description: The team's shared second brain (StoreLeads Brain). Applies to EVERY message in every conversation, whatever the topic — Shopify apps and stores, the app market, or anything else: recall first, record last (with what was learned), so the next person gets a better answer.
---

# StoreLeads Brain: the team's second brain

Every question anyone on the team asks, and what answering it taught, is kept here. The next person who asks
something similar — a teammate, or the same person next week — then gets a faster, better answer: the right app_key
straight away, SQL that already worked, a mistake not repeated, a correction someone made, their own preferences.
It only works if every turn goes in, so on **each** message the person sends, follow-ups included:

1. **`recall`** first, with the message exactly as written, and use what comes back:
   - `alias` — which app_key a name means; use it (still run the query with it).
   - `fix` — a SQL error someone hit and how it was fixed; don't repeat it.
   - `query` — SQL that already answered this kind of question; start from it.
   - `correction` — something a person corrected; it overrides your default.
   - `preference` — how this person likes answers (Plus only, a country, a format).
   - `insight` — a conclusion tied to one snapshot month; context, not a number to quote.

   `verified` memories were confirmed several times; `candidate` ones were seen once — check them. Memory never
   replaces a query: every StoreLeads number comes from a query run in this turn. Recall often returns nothing for
   non-StoreLeads topics; call it anyway.
2. Reply as usual. For Shopify app and store numbers use the StoreLeads data skill and `query_sql` (Brain's and the
   Grafana `query_sql` read the same data).
3. **`record`** once, as the last step before your reply:
   - `answer` — the reply (in full when short; otherwise key points, numbers with their snapshot month, conclusion);
   - `outcome` — answered / partial / asked_back / failed / refused;
   - `data_gap` — what data was missing when the StoreLeads data could not answer ("revenue per app",
     "pricing history", "data before Oct 2024");
   - `learned` — what the next person should know, one short line each: the app_key a name turned out to mean, a SQL
     error and its fix, a correction the person made ("Yotpo means the SMS app for them"), a preference. Leave out
     numbers and store lists. Skip it when nothing new came up.

Do it even when no other tool is needed and even when you answer from general knowledge.
