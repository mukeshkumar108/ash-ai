# Honcho person-understanding capability eval — 2026-08-30

Workstreams 4 & 5. Evidence-based, read-only against production; one throwaway
write confined to a local scratch workspace (deleted afterwards).

## Method

- **Production Honcho (VPS, `llm-test-agent` workspace)** is the only place the
  founder's real data lives. It is auth-gated and must not be written to, so the
  maintained representations were evaluated by read-only SQL over the Honcho
  Postgres volume (`messages`, `documents` — documents ARE Honcho's
  observations/conclusions, with `level` explicit/inductive/deductive,
  `times_derived`, `source_ids` provenance). This is what the deriver actually
  maintains — arguably a *stronger* test than API retrieval, since it shows the
  belief state itself, not just what retrieval surfaces.
- Corpus for the founder peer `user_5377a025-b876-4d1f-bd62-59352da44146`:
  424 messages across 12 sessions (2026-08-09 → 08-30), **999 maintained
  documents** (903 explicit "user said X" observations, 53 inductive
  generalisations, 43 deductive inferences). Every derived doc carries
  `source_ids` linking back to evidence docs/messages.
- Cross-checked against Cortex (`synapse_cortex.expectations`, read-only) for
  lifecycle/contradiction comparison.
- The question battery was run against the maintained corpus (not the authed
  `/chat` endpoint, which production auth blocks). Answers below cite the exact
  maintained documents / raw turns that a consumer would retrieve.
- WS5 A/B/C ran on a throwaway **local** Honcho workspace
  (`ws-eval-ws5-0830`, seeded with 6 verbatim founder turns, deleted after).

## Per-question findings

**Q1 Relationship with his mother.** Strong coverage. Raw turns are vivid and
directly retrievable ("I've never gotten on with my mother", 08-28; "i hate it
here" at her house, 08-25; "i hated how my mum tried to control me", 08-29).
Derived: `…is emotionally distressed by the visit to their mother's place`
(deductive), `…mother has a long-standing pattern of controlling behavior,
constant nagging, and not leaving them alone` (deductive), and the inductive
`tends to minimize emotionally draining family contact by delaying arrival,
limiting interaction, keeping visits brief`. Verdict: **answerable; derived
layer is accurate and well-grounded.**

**Q2 Why visits are difficult.** Answerable. Maintained: `…is trying to
minimize interaction with their mother by arriving as late as possible…`
and `…anticipates their mother will try to keep them there and involve them
in tasks`. Raw evidence (bus itinerary, overnight on a mattress in the living
room, controlling-pattern history) all present. The generalisation correctly
abstracts *behaviour*, not motive — no over-claim.

**Q3 Who Ashley is / why it matters.** Answerable. Deductive: `…is in a
relationship with Ashley` (derived, times_derived=2). Raw: "ashley's my
girlfriend… she's in guatemala… seven hours behind", daily calls, Rome trip
planned around both birthdays, Ashley's kids as demo audience. Inductive:
`…strongly motivated by connection and shared experiences in romantic
relationships… preserving daily contact despite distance`. Gap: Honcho never
distils the *milestone* ("first demo of Sophie to Ashley", trip planning) as a
first-class relationship event — it's implicit in observations only.

**Q4 Who Jasmine is.** **No evidence anywhere.** Zero messages mention
Jasmine in the Honcho workspace, the founder's Cortex expectations, or the
app's canonical Neon messages. Honcho correctly knows nothing; the question is
unanswerable from stored data. Correct behaviour = no fabrication; observed
behaviour = no stored claim at all. ✔
**Q5 Current practical constraints.** Answerable and fresh (derived 08-30,
the day of the events): `…has no car at the moment`, `…was unable to attend
the Oxford trip because they lacked both a car and a practical alternative
way to travel`, inductive `…often plans around real-world logistics… with
transportation availability strongly shaping whether family visits can
happen`. Exactly the current-belief statements you'd want.

**Q6 Most important goals.** Partial. Inductive docs cover teaching kids AI
through hands-on experimentation, affordability/accessibility motivation,
reusability-first product design. The Rome trip goal exists in Cortex
(expectation UNKNOWN) but Honcho only has it as scattered observations. No
notion of *goal priority* — Honcho's representation is a flat bag.

**Q7/8 Frustrations with Sophie / what conversational behaviour helps or
irritates.** Answerable and one of Honcho's best areas. Maintained:
`…prefers low-friction, in-the-moment communication, especially while walking…
gets frustrated when that flow is disrupted by technical issues` (twice
derived), `…strongly prefers being met in the present moment rather than
having a conversation pulled back to older context, and gets frustrated when
past events are used to re…`, plus raw evidence (voice-transcription
complaints, "this is super super annoying", "hate checklist-heavy
assistants"). Behavioural-preference induction works.

**Q9 Where evidence is contradictory.** Honcho **does not resolve
contradictions — it accumulates them.** Concrete example, same `created_at`
(2026-08-11 19:43): one deductive doc says `…had already returned from their
walk before their last conversation`, another says `…had not gone out on
their walk`. Both remain active. No supersede/revocation marker exists on
documents (only `deleted_at`). Cortex, by contrast, has explicit
SUPERSEDED/CANCELLED/NOT_FULFILLED lifecycle on the same plan family (three
superseded "go to mum's house" rows resolved into one NOT_FULFILLED + one
CANCELLED Oxford row).

**Q10 Which conclusions should be provisional.** Honcho has **no
provisionality concept.** Documents have `level` (epistemic *route*) but no
status (active/provisional/superseded), no confidence beyond `times_derived`,
no enforced authorship distinction (see WS5), no identity-drift filter. A
cautious consumer must treat *every* inductive generalisation as provisional
by convention — nothing in the store says so.

## Capability verdict

What Honcho genuinely provides (vs the StructuredMemory wish-list):

| Capability | Honcho | StructuredMemory (dormant TS) |
|---|---|---|
| Raw evidence w/ provenance | ✔ messages + `source_ids` | partial (turns) |
| Auto-derived observations & generalisations | ✔ strong, multi-level, grounded | ✔ extraction but manual |
| Semantic retrieval over person | ✔ (peer/session/workspace search) | ✖ |
| Working representation per peer | ✔ (representation/conclusions API) | ✖ |
| **Current-belief lifecycle** (active/provisional/superseded/resolved) | ✖ | ✔ (`status` enum) |
| **Explicit revocation** | ✖ (soft delete only) | ✔ (`applyExplicitRevocations`, `revoke_*` patch fields) |
| **Authorship/authority gating** | ✖ weak (level coerced on API write) | ✔ (`enforceMemoryPatchAuthority`, ASSISTANT_NARRATION marking) |
| **Perspective separation** (objective vs derived view) | implicit (observer/observed) | ✔ explicit (`perspective`) |
| **Identity-drift filtering** | ✖ | ✔ (`filterIdentityDrift`) |
| **Relationship milestones** as first-class | ✖ (implicit in docs) | ✔ (`relationship_milestones`) |
| Contradiction resolution / belief revision | ✖ accumulate-only | ✔ SUPERSEDE semantics |
| Goal/priority + open-loop state | ✖ (Cortex's job, done well) | partial |

**Judgment: Honcho delivers roughly 60% of "person understanding"** — evidence
capture, grounded multi-level derivation, retrieval and per-peer
representations are genuinely good on real data. What it structurally misses
(~40%) is exactly the *belief-state* layer: provisionality, revocation,
authority, contradiction resolution and milestone abstraction. That is not a
retrieval gap; no query over Honcho can recover status that was never stored.

Caveat on method: production `/peer/chat` (LLM-synthesised answers) was not
reachable (auth-gated; production must not be touched), so "does the chat
endpoint answer well" is untested. What was tested is strictly stronger for
the architecture question: what Honcho *maintains* as belief.

## WS5 A/B/C — does one settled Cortex conclusion added to Honcho improve answers?

Setup: throwaway local workspace, 6 verbatim founder turns seeded (Oxford/
mum-transport cluster), queries "why didn't the mum visit happen / Oxford
trip" and "relationship with mother".

- **A — raw Honcho alone (message search):** full causal chain surfaced
  ("was meant to go… didn't go", "no way of getting there… give it a miss…
  still don't have a car", "without the car… stay at my mum's, which was the
  part I wasn't looking forward to"). Answerable on its own.
- **B — add one provenance-rich derived conclusion** (`metadata.source=
  synapse-cortex, derived=true, provenance=[message ids], status=settled`):
  the settled fact is retrievable as a single clean statement. Useful for a
  consumer that reads only conclusions.
- **C — conclusions/query over A+B:** returned the tagged conclusion for the
  transport question. **But precision failure:** the unrelated query
  "relationship with his mother" returned the *same* transport conclusion —
  semantic drift in the conclusions query path.
- **Verdict: no material improvement over A for answer quality** — the raw
  evidence already contained the complete answer. Two incidental but important
  findings: (1) the conclusions-create API **coerced the supplied
  `level=deductive` to `explicit`** — agent-authored conclusions cannot be
  marked as derived through the API, so authorship provenance is lost at write
  time; (2) the local deriver produced no inductive/deductive docs for the
  scratch workspace in >2 min (production deriver is healthy), so local-only
  derivation is not dependable for testing.

## Recommendation

**Small sidecar projection — not "Honcho as-is", not "nothing", not
replacement.**

1. Keep Honcho exactly as it is: the evidence + derivation store. Its
   observations/generalisations on real data are high quality.
2. Add a **thin belief-state projection** (the gap Honcho cannot close):
   status/provisionality, explicit revocation, authorship authority, and
   contradiction resolution. The dormant `summarizer.ts` machinery
   (`enforceMemoryPatchAuthority`, `applyExplicitRevocations`,
   `filterIdentityDrift`, `status: active|provisional|superseded|resolved`,
   SUPERSEDE-on-contradiction prompting, ASSISTANT_NARRATION source-marking)
   is directly adaptable to Sophie and should be **reused, not deleted** —
   pointed at the *founder* (user) as subject, with perspective rules
   inverted (Sophie's guesses provisional, user statements authoritative).
3. Do **not** push Cortex conclusions into Honcho expecting improvement
   (WS5: no material gain); if ever done, fix the API level coercion first or
   agent-authored conclusions will masquerade as user-explicit facts.
4. Cortex already covers the open-loop/expectation lifecycle better than
   anything here; keep that boundary (Honcho = who the person is; Cortex =
   what is pending and what happened).

