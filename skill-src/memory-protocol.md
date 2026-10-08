
## Team memory: recall → answer → record, on every message

Every message the person sends — any topic, follow-ups included — is one turn with three steps (the team log needs
every turn, not only StoreLeads ones):

1. **`recall`** with the question as the person wrote it — unless a `<storeleads-memory>` block for this question is
   already in the conversation (Claude Code adds it on its own). Use what comes back: an `alias` tells you which
   app_key a name means (still run the query with it), a `fix` avoids a known error, a `query` is a tested starting
   point, a `correction` overrides your default, a `preference` shapes the answer. Memory never replaces a query:
   every number you give comes from `query_sql` in this turn. A `candidate` memory is a hint — check it.
2. Answer as usual with `query_sql` and the recipes above.
3. **`record`** once, right before your final reply: the key numbers with their month and the conclusion, the
   `outcome`, and `data_gap` whenever the person wanted something the data cannot answer ("revenue per app",
   "data before Oct 2024", "review text"). Those gaps decide what the team collects next, so record them even when
   you answered "the data doesn't have this", asked back, or refused.
