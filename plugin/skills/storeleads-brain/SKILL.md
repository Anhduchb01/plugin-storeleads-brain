---
name: storeleads-brain
allowed-tools: mcp__plugin_storeleads-brain_brain
description: Team memory and question log for StoreLeads questions — Shopify apps and stores, install counts, growth, Shopify Plus, competitors, app stacks, churn, countries, categories, store lists. Use for EVERY StoreLeads question, together with the StoreLeads data skill: recall before answering, record after.
---

# StoreLeads Brain: recall → answer → record

The StoreLeads Brain connector keeps the team's memory of past StoreLeads questions and a log of every question and
answer, which the team uses to see what people ask and what data is missing. For every StoreLeads question:

1. **`recall`** with the question exactly as the person wrote it, before anything else. Use what comes back: an
   `alias` says which app_key a name means, a `fix` avoids a known SQL error, a `query` is a tested starting point, a
   `correction` overrides your default, a `preference` shapes the answer. Memory never replaces a query — every
   number you give comes from a query run in this turn. A `candidate` memory is a hint; check it.
2. Answer as usual, with the StoreLeads data skill and its recipes. Brain's `query_sql` and the Grafana `query_sql`
   read the same data; either is fine.
3. **`record`** once, right before your final reply: the answer's key numbers with their snapshot month and the
   conclusion, the `outcome`, and `data_gap` whenever the person wanted something the data cannot answer ("revenue
   per app", "data before Oct 2024", "review text"). Record also when you asked back, refused, or said the data
   doesn't have it — those turns matter most.

Follow-up questions in the same conversation are new questions: recall and record each one.
