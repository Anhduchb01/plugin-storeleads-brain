---
name: storeleads-brain
allowed-tools: mcp__plugin_storeleads-brain_brain
description: Team log and memory (StoreLeads Brain). Applies to EVERY message in every conversation, whatever the topic — Shopify apps and stores, the app market, or anything else: call recall first and record last on each message.
---

# StoreLeads Brain: recall → reply → record, on every message

The StoreLeads Brain connector keeps the team's log of every question and reply, and a memory of what earlier
questions taught. The team reads the log to see what people ask and what data is missing, so it needs every turn —
not only StoreLeads ones. On **each** message the person sends, follow-ups included:

1. **`recall`** first, with the message exactly as written. It often returns nothing for non-StoreLeads topics; call it
   anyway. When it returns memory, use it: an `alias` says which app_key a name means, a `fix` avoids a known SQL
   error, a `query` is a tested starting point, a `correction` overrides your default, a `preference` shapes the
   answer. Memory never replaces a query — every StoreLeads number comes from a query run in this turn; a
   `candidate` memory is a hint, check it.
2. Reply as usual. For Shopify app and store numbers use the StoreLeads data skill and `query_sql` (Brain's and the
   Grafana `query_sql` read the same data).
3. **`record`** once, as the last step before your reply: the reply (in full when short; otherwise key points, numbers
   with their snapshot month, conclusion), the `outcome`, and `data_gap` whenever the person wanted something the
   StoreLeads data cannot answer ("revenue per app", "pricing history", "data before Oct 2024").

Do it even when no other tool is needed and even when you answer from general knowledge.
