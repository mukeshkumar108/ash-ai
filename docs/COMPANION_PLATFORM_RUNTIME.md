# Companion platform runtime — production handoff

**Status:** production source-of-truth map, updated 2026-08-27.

This is the entry point for agents changing Sophie or the shared companion
platform. Behavioral archives are evidence; deployed code is implementation
truth.

## Repository ownership

| Repository / deployment | Owns | Does not own |
|---|---|---|
| `ash-ai` / `llm-agent-test` on Vercel | UI, auth, canonical chats/messages, chronology, entry context, cross-chat operational state, voice transport, runtime streaming/persistence, Cortex outbox | Production conversational-agency decisions or Python foreground prompt |
| `companion-runtime` on VPS | Turn policy, Dual Aperture, capability/gear routing, tenure/release, prompt compilation, provider calls, beats, LIVE SITUATION, provenance, `next_session_state` | Canonical messages, auth, durable continuity extraction |
| `synapse-cortex` on VPS | Expectations, open loops, suppressions/resolutions, deadlines, recurring intentions and bounded continuity packets | Canonical chronology, foreground generation, conversational authority |
| Honcho | Semantic messages, observations, conclusions and retrieval | Routing, prompt authority, lifecycle state |

`ash-ai/main` triggers Vercel production. `companion-runtime/main` is pulled and
rebuilt at `/home/deploy/companion-runtime`. Synapse-Cortex deploys separately.
Never assume pushing one repository deploys another.

## Production reactive turn

1. `app/(chat)/api/chat/route.ts` authenticates, loads canonical history,
   computes cross-chat chronology and builds `entry_context`.
2. It loads `CompanionUserState`; user-owned LIVE SITUATION and explicit
   behavioral corrections follow the user across chat IDs.
3. The canonical user message is persisted. The BFF sends history, parts,
   transcript reliability, trusted context and prior `session_routing` to the
   runtime.
4. `TurnExecutionPipeline.execute_turn` derives scene/time and concurrently
   obtains epistemic classification, Honcho JIT memory and Cortex continuity.
5. Eligible reply-only social/emotional turns run the three-message Dual
   Aperture. Task/mixed and specialist lanes retain deterministic/director
   authority.
6. Runtime separates authority (`HOLD | ENRICH | LEAD | ATTEND`) from model
   capability (`default | mid | frontier`) and resolves persisted tenure/release.
7. `build_sophie_reply_system_prompt` compiles one selective prompt. The chosen
   foreground model writes the visible reply directly; there is no rewrite model.
8. LIVE SITUATION proposes next-turn state concurrently. Elevated generation
   subsequently receives `STAY` or `DOWNGRADE_OK`.
9. Runtime returns reply, beats, provenance and `next_session_state`; the BFF
   persists assistant output, per-chat routing and user operational state.
10. The BFF asynchronously enqueues the canonical turn in `CortexOutbox`; cron
    delivery to Synapse-Cortex is leased/retried and never blocks chat.

## Authority and capability

Dual Aperture sees only `User N-1 / Sophie N-1 / User N`, generates two
attention candidates and an impulse, then chooses authority:

- `HOLD`: user retains trajectory; Sophie retains independent judgment.
- `ENRICH`: optional `[PREPARED OPPORTUNITIES]` reaches normal Sophie.
- `LEAD`: `[YOU HAVE THE REINS]` grants local trajectory ownership.
- `ATTEND`: `[ATTEND — HIGH-JUDGMENT GENERATION]` meets an important buried or
  glossed-over issue; it is not generic emotion or therapy classification.

| Function | Production default |
|---|---|
| Dual Aperture | `google/gemini-3.7-flash`, low reasoning, reasoning excluded |
| Ordinary foreground | `deepseek/deepseek-v4-flash` |
| Ordinary fallback | `nex-agi/nex-n2-mini` |
| Mid capability | `openai/gpt-5.6-luna-pro` |
| Frontier capability | `anthropic/claude-sonnet-5` |

Authority and capability are independent. Mid/frontier have two-turn minimum
tenure. `STAY` retains; `DOWNGRADE_OK` permits frontier → mid → base after
tenure. Explicit redirect releases the conversational objective. Safety,
image and specialist routes can override ordinary social routing.

## Prompt compilation: additive and subtractive

Production uses
`companion-runtime/companion_core/prompts/sophie_prompt_builder.py`.
`lib/agent/system-prompt.ts` is the rollback fallback and must retain parity.

Final order:

1. stable companion kernel;
2. `[TRUSTED NOW]`;
3. one intent module: task, social, emotional or mixed;
4. one behavioral authority block: LEAD/ATTEND objective, HOLD guidance,
   character-first social freedom, or non-social director move;
5. optional `[ARRIVAL — OWN THE WELCOME]`;
6. compact reciprocity evidence;
7. selected context modules;
8. optional ENRICH opportunities;
9. medium/output and hard truthfulness, independence and beat invariants.

Conditionally additive material:

- at most eight explicit user corrections;
- prior committed LIVE SITUATION facts filtered by per-field freshness;
- transcript reliability when present;
- current/relevant scene state;
- selected relevant Cortex continuity;
- Honcho memory only for grounded callback/object work;
- authoritative entry context on new session/UserDay;
- retrieval provenance for task/mixed work;
- ambient location only for relevant location/weather/travel objectives.

Subtraction is intentional:

- empty/irrelevant modules are omitted;
- handshake feeds chronology instead of becoming a duplicate prompt block;
- new temporal sessions drop sitting-local director/reciprocity residue and raw
  pre-boundary history while retaining explicit cross-session objects;
- stale scene fields expire independently (activity/movement/journey 3h,
  location 6h, current plan 12h);
- redirects suppress a rejected active peripheral objective;
- server-side afterthoughts are removed from immediate foreground beats;
- Cortex suppressions/recent resolutions prevent repetitive callbacks;
- current task/safety/user evidence outranks optional relational context.

Precedence: safety/current user → explicit correction → trusted current
time/scene → selected operational continuity → Cortex/Honcho evidence → older
bounded history. Chain-of-thought is never persisted.

## Entry, scene and correction state

| Gap/state | Entry treatment |
|---|---|
| under 60m | continuous; no restart greeting |
| 60–179m | light return acknowledgement |
| 180–359m | warm return |
| 360–719m | stronger relationship welcome |
| 720m+ | extended-return welcome |
| first contact in UserDay | authored high-energy welcome; morning may ask about sleep/how they arrive |
| no prior contact | warm cold-start welcome |

Distress, urgency, danger and concrete tasks override greeting ceremony. Entry
metadata is hidden; Sophie cannot invent an off-screen life.

LIVE SITUATION is immediate-world operational state, not relational memory. A
model proposes transitions and code validates confidence, freshness, correction
and clearing. Each field has its own timestamp so changing location cannot keep
an old walking state alive.

Direct future-facing instructions such as “don't ask me…” are conservatively
detected, deduplicated, capped and stored in `CompanionUserState`. Generic
disagreement and immediate factual correction are not converted into permanent
behavior constraints.

## Continuity and initiative

Honcho supplies semantic evidence. Cortex turns lifecycle-worthy evidence into
due/open/suppressed/resolved state and a deterministic bounded attention packet.
The prompt may use it; it cannot command the turn.

Initiative remains a separate app path:

`Cortex candidate → deterministic eligibility/quiet-time policy → editorial
decision (including silence) → repetition policy → composition → transactional
insert`.

Do not make every memory proactive. Scheduled product cadence and onboarding
must not be folded into Dual Aperture; they need an explicit authority contract.

## August 2026 changes

- Character-first ordinary social generation plus Dual Aperture authority.
- HOLD/ENRICH/LEAD/ATTEND, capability gears, tenure, release and provenance.
- Strict structured parsing accepts raw/fenced JSON and rejects prose, malformed
  or schema-invalid output; genuine HOLD differs from fail-open HOLD.
- LIVE SITUATION, then cross-chat ownership and per-field expiry.
- Cross-chat chronology and elapsed-time entry welcomes.
- Compact durable behavioral corrections.
- App-side durable voice recording and ElevenLabs-first transcription fallback.
- Gemini low/excluded reasoning for Dual Aperture after provider bake-off.

## Validation and lessons

Validation covers full runtime tests, app type/build tests, strict-schema tests,
prompt architecture, routing/tenure and live health/config checks. The
low-reasoning release passed 195 runtime tests; a live smoke produced valid HOLD
in one attempt at 2.398s. One smoke is not a latency distribution.

Learnings:

- impulse-first authority can preserve epistemic uncertainty;
- low-reasoning Gemini retained all decisions in the 36-attempt screen while
  improving latency/cost, but production distributions still matter;
- faster small controllers collapsed into HOLD or violated restraint;
- negative controls and human review are necessary;
- harness success does not prove production integration—code-path replay and
  provenance are mandatory;
- synchronous aperture is usable for text dogfooding but unproven for voice.

## Outstanding work — ordered

1. Dogfood entry, cross-chat scene and corrections; inspect real provenance.
2. Measure low-reasoning p50/p90/p99 and schema/provider failure rates in prod.
3. Flagged prototype of parallel aperture + speculative base generation;
   measure first text/audio, discard cost and behavioral parity before shipping.
4. Validate end-to-end voice: local durability, upload retry, transcription
   fallback, streamed text and progressive TTS playback.
5. Shadow-test narrative-scene extraction; never let low richness bias aperture.
6. Design user-accepted `discovery_session_v1` with cooldown and restraint.
7. Keep companion self-stance, provisional guesses and authoritative user
   corrections semantically distinct even if storage primitives are shared.
8. Create first-class product contracts before elderly/child/healthcare variants:
   safety, consent, escalation, voice, retention and identity policy.
9. Repair local Vercel linkage: the checked-in/local link observed during deploy
   pointed to an old empty project while GitHub identified the live project.
10. Keep Python production and TypeScript rollback prompt parity current.

## Agent checklist

Before behavioral work:

1. Inspect `origin/main` and the last 48 hours in every affected repository.
2. Read this guide, `companion-runtime/docs/CONVERSATIONAL_AGENCY_RUNTIME.md`
   and the behavioral master archive/relevant reports.
3. Identify authority owner, persistence owner and prompt insertion point.
4. Preserve compact provenance; never persist chain-of-thought.
5. Test the real path, not only a copied harness prompt.
6. Deploy only repositories whose code/config changed.
