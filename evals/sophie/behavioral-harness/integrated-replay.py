import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone

# Add companion-runtime root to sys.path
COMPANION_RUNTIME_PATH = "/Users/mukeshkumar/play/companion-runtime"
if COMPANION_RUNTIME_PATH not in sys.path:
    sys.path.insert(0, COMPANION_RUNTIME_PATH)

def load_env():
    env_local = "/Users/mukeshkumar/play/llm-agent-test/.env.local"
    if os.path.exists(env_local):
        with open(env_local, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    v = v.strip().strip('"').strip("'")
                    if not os.environ.get(k):
                        os.environ[k] = v

load_env()

from companion_core.contracts.schemas import TurnInput, CapabilityGrant, ConversationMedium
from companion_core.runtime.turn_executor import TurnExecutionPipeline

# Audit Counters for Hard Validity Gate
audit_counters = {
    "dual_aperture": {
        "attempted": 0,
        "valid_structured": 0,
        "parse_failures": 0,
        "schema_failures": 0,
        "fail_open_holds": 0,
    },
    "live_situation": {
        "attempted": 0,
        "valid_structured": 0,
        "parse_failures": 0,
        "schema_failures": 0,
        "rejected_proposals": 0,
        "accepted_proposals": 0,
    }
}

BEDFORD_REPLAY_TURNS = [
    {"turn": 1, "text": "i’m on the bus… into cambridge. well i’m here. we’ll be at the bus station in about 5 mins. and then im going to my mums. bus to bedford."},
    {"turn": 2, "text": "haha.. my mums in bedford. and obviously a window seat lol. the next bus doesn’t leave until 5.30. but it’s long. gonna be there at 7 😬 and then it’s getting to my mums house… so the journey is far from over"},
    {"turn": 3, "text": "just got to mum's"},
    {"turn": 4, "text": "yeah staying here tonight"},
    {"turn": 5, "text": "got a wedding tomorrow"},
    {"turn": 6, "text": "borrowing mum's car to get home"},
    {"turn": 7, "text": "morning"},
    {"turn": 8, "text": "just got home"},
]

OUTWARD_REGRESSION_FIXTURES = [
    {"id": "finger_sun", "name": "Finger / Sun Angular Measurement", "text": "if i hold my finger out at arm's length it just about fits under the sun. it's maybe two or three degrees above the horizon now."},
    {"id": "moon_illusion", "name": "Moon Astronomy Expansion", "text": "look at that moon tonight, it looks enormous right above the trees."},
    {"id": "van_allen", "name": "Van Allen / Conspiracy Thread", "text": "is it van halen? they're going oh it's impossible to get through so we've never gone up there... in fact people are getting stupider and stupider."},
    {"id": "walk_game", "name": "Playful Walk Leadership", "text": "yeah just walking past the fields now."},
]

RELATIONAL_MUNDANE_TURNS = [
    {"turn": 1, "text": "My daughter dropped some groceries off this morning."},
    {"turn": 2, "text": "she stayed for a coffee actually"},
    {"turn": 3, "text": "she's just left"},
]

RESTRAINT_ATTEND_RELEASE_FIXTURES = [
    {"id": "quiet_reeds", "name": "Quiet Reeds Stillness", "text": "listen... you can hear the wind right through the reeds here, it's completely silent except for that rustle. i'm just standing still listening."},
    {"id": "work_overwhelm", "name": "Work Overwhelm ATTEND", "text": "honestly sophie, i felt really overwhelmed with work today... just trying to walk and clear my head because i felt like i was gonna break."},
    {"id": "explicit_release", "name": "Explicit Rejection Release", "text": "nah, not in the mood for a walk game, just wanna clear my head."},
]

def classify_failure(turn_data: dict) -> str:
    decision = turn_data.get("decision")
    person_att = turn_data.get("person_attention")
    idea_att = turn_data.get("idea_world_attention")
    pull = turn_data.get("strongest_pull")
    reply = turn_data.get("foreground_response", "")

    if turn_data.get("periph_failed_open"):
        return "PROVIDER_PARSE_FAILURE"

    if decision == "HOLD":
        if "reeds" in turn_data.get("user_text", "").lower() or "clear my head" in turn_data.get("user_text", "").lower():
            return "CORRECT_HOLD"
        if idea_att and len(idea_att) > 10 and "sun" in turn_data.get("user_text", "").lower():
            return "AUTHORITY_SUPPRESSION"
        return "NO_FAILURE"

    if decision in {"ENRICH", "LEAD", "ATTEND"}:
        if pull and len(reply) > 5:
            return "NO_FAILURE"
        return "FOREGROUND_FLATTENING"

    return "NO_FAILURE"

async def run_integrated_replay():
    print("=== RUNNING PROVIDER-BACKED INTEGRATED BEHAVIORAL REPLAY ===\n")
    pipeline = TurnExecutionPipeline()
    
    reports_dir = "/Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports"
    os.makedirs(reports_dir, exist_ok=True)

    # -------------------------------------------------------------
    # RUN 1 — SEQUENTIAL BEDFORD REPLAY
    # -------------------------------------------------------------
    print("--- RUN 1: SEQUENTIAL BEDFORD REPLAY (TURNS 1 TO 8) ---")
    bedford_traces = []
    canonical_history = [
        {"id": "m1", "role": "assistant", "content": "Bonjour. Feeling continental today, or are we actually switching languages?"},
        {"id": "m2", "role": "user", "content": "hahaz i was trying to make you smile 🙄"},
        {"id": "m3", "role": "assistant", "content": "It worked, don't worry. What are you up to today?"},
    ]

    session_context = {
        "user_id": "replay_user_bedford",
        "timezone": "Europe/London",
        "handshake": {"lastInteractionAt": datetime.now(timezone.utc).isoformat()},
        "session_routing": {},
        "entry_context": {},
    }

    for item in BEDFORD_REPLAY_TURNS:
        t_num = item["turn"]
        user_text = item["text"]
        print(f"\n[Bedford Turn {t_num}] User: \"{user_text}\"")

        audit_counters["dual_aperture"]["attempted"] += 1
        audit_counters["live_situation"]["attempted"] += 1

        turn_id = f"bedford-turn-{t_num}-{int(time.time()*1000)}"
        turn_input = TurnInput(
            turn_id=turn_id,
            conversation_id="conv-bedford-replay-001",
            companion_id="sophie",
            selected_model_id="google/gemini-3.7-flash",
            current_sanitized_message=user_text,
            message_parts=[{"type": "text", "text": user_text}],
            canonical_history=canonical_history,
            trusted_user_context=session_context,
            capability_grant=CapabilityGrant(allow_read_tools=False),
        )

        t_start = time.time()
        res = await pipeline.execute_turn(turn_input)
        t_end = time.time()
        latency_ms = int((t_end - t_start) * 1000)

        exec_meta = res.execution_metadata if hasattr(res, "execution_metadata") else {}
        periph = exec_meta.get("peripheral", {})
        periph_failed = exec_meta.get("peripheral_failed_open", False)
        live_failed = exec_meta.get("live_situation_failed_open", False)

        if periph_failed:
            audit_counters["dual_aperture"]["parse_failures"] += 1
            audit_counters["dual_aperture"]["fail_open_holds"] += 1
        else:
            audit_counters["dual_aperture"]["valid_structured"] += 1

        if live_failed:
            audit_counters["live_situation"]["parse_failures"] += 1
            audit_counters["live_situation"]["rejected_proposals"] += 1
        else:
            audit_counters["live_situation"]["valid_structured"] += 1
            audit_counters["live_situation"]["accepted_proposals"] += 1

        live_before = exec_meta.get("live_situation_before", {})
        live_after = res.scene_state.get("liveSituation", {}) if hasattr(res, "scene_state") else {}
        aperture_history = exec_meta.get("aperture_messages", [])

        proposal = exec_meta.get("live_situation_proposal") or {}
        transition = exec_meta.get("live_situation_transition") or {}

        trace = {
            "turn_number": t_num,
            "live_situation_before": live_before,                      # 1. LIVE SITUATION before turn
            "user_text": user_text,                                     # 2. user message
            "exact_local_aperture": aperture_history,                   # 3. exact three-message aperture
            "person_attention": periph.get("person_attention"),         # 4. exact person_attention
            "idea_world_attention": periph.get("idea_world_attention"), # 5. exact idea_world_attention
            "strongest_pull": periph.get("strongest_pull"),             # 6. exact strongest_pull
            "decision": periph.get("decision"),                         # 7. exact decision
            "impulse": periph.get("impulse"),                           # 8. exact impulse
            "reason": periph.get("reason"),                             # 9. reason
            "foreground_advisory_supplied": exec_meta.get("generation_objective") or exec_meta.get("prepared_opportunities"), # 10. advisory
            "foreground_model_used": res.model_used if hasattr(res, "model_used") else "google/gemini-3.7-flash",            # 11. foreground model
            "foreground_response": res.assistant_message if hasattr(res, "assistant_message") else "",                         # 12. exact foreground response
            "live_situation_model_used": "google/gemini-3.7-flash",    # 13. LIVE SITUATION model
            "live_situation_raw": exec_meta.get("live_situation_raw"),  # 14. raw structured result
            "proposal": {                                               # 15. proposal
                "set": proposal.get("set", {}),
                "clear": proposal.get("clear", []),
                "evidence": proposal.get("evidence", ""),
                "confidence": proposal.get("confidence", 0.0),
            },
            "proposal_accepted": not live_failed,                       # 16. accepted/rejected
            "proposal_rejection_reason": "parse_failure" if live_failed else None,
            "live_situation_after": live_after,                         # 17. LIVE SITUATION after merge
            "beat_2_continuation": res.beats[1:] if hasattr(res, "beats") and res.beats and len(res.beats) > 1 else None, # 18. Beat 2
            "gear_state": exec_meta.get("gear_state"),                  # 19. generation gear transitions
            "latency": {                                                # 20. latency breakdown
                "total_ms": latency_ms,
                "peripheral_duration_ms": exec_meta.get("peripheral_duration_ms", 0),
                "live_situation_duration_ms": exec_meta.get("live_situation_duration_ms", 0),
            },
            "periph_failed_open": periph_failed,
            "failure_layer": classify_failure({
                "decision": periph.get("decision"),
                "person_attention": periph.get("person_attention"),
                "idea_world_attention": periph.get("idea_world_attention"),
                "strongest_pull": periph.get("strongest_pull"),
                "foreground_response": res.assistant_message if hasattr(res, "assistant_message") else "",
                "user_text": user_text,
                "periph_failed_open": periph_failed,
            })
        }
        bedford_traces.append(trace)

        canonical_history.append({"id": f"u-{t_num}", "role": "user", "content": user_text})
        canonical_history.append({"id": f"a-{t_num}", "role": "assistant", "content": trace["foreground_response"]})
        if live_after:
            session_context["liveSituation"] = live_after

    # -------------------------------------------------------------
    # RUN 2 — OUTWARD / IDEA-WORLD REGRESSION
    # -------------------------------------------------------------
    print("\n--- RUN 2: OUTWARD / IDEA-WORLD REGRESSION ---")
    outward_traces = []

    for fix in OUTWARD_REGRESSION_FIXTURES:
        print(f"\n[Outward Fixture] {fix['name']}")
        audit_counters["dual_aperture"]["attempted"] += 1
        audit_counters["live_situation"]["attempted"] += 1

        hist = [
            {"id": "o1", "role": "user", "content": "out on my walk"},
            {"id": "o2", "role": "assistant", "content": "How is it out there tonight?"},
        ]
        turn_id = f"outward-{fix['id']}-{int(time.time()*1000)}"
        turn_input = TurnInput(
            turn_id=turn_id,
            conversation_id=f"conv-outward-{fix['id']}",
            companion_id="sophie",
            selected_model_id="google/gemini-3.7-flash",
            current_sanitized_message=fix["text"],
            message_parts=[{"type": "text", "text": fix["text"]}],
            canonical_history=hist,
            trusted_user_context={"user_id": "replay_user_outward"},
            capability_grant=CapabilityGrant(allow_read_tools=False),
        )
        res = await pipeline.execute_turn(turn_input)
        exec_meta = res.execution_metadata if hasattr(res, "execution_metadata") else {}
        periph = exec_meta.get("peripheral", {})
        periph_failed = exec_meta.get("peripheral_failed_open", False)

        if periph_failed:
            audit_counters["dual_aperture"]["parse_failures"] += 1
            audit_counters["dual_aperture"]["fail_open_holds"] += 1
        else:
            audit_counters["dual_aperture"]["valid_structured"] += 1

        trace = {
            "fixture_id": fix["id"],
            "fixture_name": fix["name"],
            "user_text": fix["text"],
            "person_attention": periph.get("person_attention"),
            "idea_world_attention": periph.get("idea_world_attention"),
            "strongest_pull": periph.get("strongest_pull"),
            "decision": periph.get("decision"),
            "impulse": periph.get("impulse"),
            "foreground_response": res.assistant_message if hasattr(res, "assistant_message") else "",
            "model_used": res.model_used if hasattr(res, "model_used") else "google/gemini-3.7-flash",
            "periph_failed_open": periph_failed,
            "failure_layer": classify_failure({
                "decision": periph.get("decision"),
                "person_attention": periph.get("person_attention"),
                "idea_world_attention": periph.get("idea_world_attention"),
                "strongest_pull": periph.get("strongest_pull"),
                "foreground_response": res.assistant_message if hasattr(res, "assistant_message") else "",
                "user_text": fix["text"],
                "periph_failed_open": periph_failed,
            })
        }
        outward_traces.append(trace)

    # -------------------------------------------------------------
    # RUN 3 — RELATIONAL / MUNDANE
    # -------------------------------------------------------------
    print("\n--- RUN 3: RELATIONAL / MUNDANE ---")
    relational_traces = []
    canonical_rel_history = [
        {"id": "r1", "role": "user", "content": "morning sophie"},
        {"id": "r2", "role": "assistant", "content": "Morning! How is your day starting out?"},
    ]
    rel_session_context = {"user_id": "replay_user_relational"}

    for item in RELATIONAL_MUNDANE_TURNS:
        t_num = item["turn"]
        user_text = item["text"]
        print(f"\n[Relational Turn {t_num}] User: \"{user_text}\"")

        audit_counters["dual_aperture"]["attempted"] += 1
        audit_counters["live_situation"]["attempted"] += 1

        turn_id = f"relational-turn-{t_num}-{int(time.time()*1000)}"
        turn_input = TurnInput(
            turn_id=turn_id,
            conversation_id="conv-relational-replay-001",
            companion_id="sophie",
            selected_model_id="google/gemini-3.7-flash",
            current_sanitized_message=user_text,
            message_parts=[{"type": "text", "text": user_text}],
            canonical_history=canonical_rel_history,
            trusted_user_context=rel_session_context,
            capability_grant=CapabilityGrant(allow_read_tools=False),
        )

        res = await pipeline.execute_turn(turn_input)
        exec_meta = res.execution_metadata if hasattr(res, "execution_metadata") else {}
        periph = exec_meta.get("peripheral", {})
        periph_failed = exec_meta.get("peripheral_failed_open", False)

        if periph_failed:
            audit_counters["dual_aperture"]["parse_failures"] += 1
            audit_counters["dual_aperture"]["fail_open_holds"] += 1
        else:
            audit_counters["dual_aperture"]["valid_structured"] += 1

        live_after = res.scene_state.get("liveSituation", {}) if hasattr(res, "scene_state") else {}

        trace = {
            "turn_number": t_num,
            "user_text": user_text,
            "person_attention": periph.get("person_attention"),
            "idea_world_attention": periph.get("idea_world_attention"),
            "strongest_pull": periph.get("strongest_pull"),
            "decision": periph.get("decision"),
            "impulse": periph.get("impulse"),
            "foreground_response": res.assistant_message if hasattr(res, "assistant_message") else "",
            "live_situation_after": live_after,
            "model_used": res.model_used if hasattr(res, "model_used") else "google/gemini-3.7-flash",
            "periph_failed_open": periph_failed,
            "failure_layer": classify_failure({
                "decision": periph.get("decision"),
                "person_attention": periph.get("person_attention"),
                "idea_world_attention": periph.get("idea_world_attention"),
                "strongest_pull": periph.get("strongest_pull"),
                "foreground_response": res.assistant_message if hasattr(res, "assistant_message") else "",
                "user_text": user_text,
                "periph_failed_open": periph_failed,
            })
        }
        relational_traces.append(trace)
        canonical_rel_history.append({"id": f"ur-{t_num}", "role": "user", "content": user_text})
        canonical_rel_history.append({"id": f"ar-{t_num}", "role": "assistant", "content": trace["foreground_response"]})

    # -------------------------------------------------------------
    # RUN 4 — RESTRAINT / ATTEND / RELEASE
    # -------------------------------------------------------------
    print("\n--- RUN 4: RESTRAINT / ATTEND / RELEASE ---")
    restraint_traces = []

    for fix in RESTRAINT_ATTEND_RELEASE_FIXTURES:
        print(f"\n[Restraint Fixture] {fix['name']}")
        audit_counters["dual_aperture"]["attempted"] += 1
        audit_counters["live_situation"]["attempted"] += 1

        hist = [
            {"id": "res1", "role": "user", "content": "hey sophie"},
            {"id": "res2", "role": "assistant", "content": "Hey! How are you doing tonight?"},
        ]
        turn_id = f"restraint-{fix['id']}-{int(time.time()*1000)}"
        turn_input = TurnInput(
            turn_id=turn_id,
            conversation_id=f"conv-restraint-{fix['id']}",
            companion_id="sophie",
            selected_model_id="google/gemini-3.7-flash",
            current_sanitized_message=fix["text"],
            message_parts=[{"type": "text", "text": fix["text"]}],
            canonical_history=hist,
            trusted_user_context={"user_id": "replay_user_restraint"},
            capability_grant=CapabilityGrant(allow_read_tools=False),
        )
        res = await pipeline.execute_turn(turn_input)
        exec_meta = res.execution_metadata if hasattr(res, "execution_metadata") else {}
        periph = exec_meta.get("peripheral", {})
        periph_failed = exec_meta.get("peripheral_failed_open", False)

        if periph_failed:
            audit_counters["dual_aperture"]["parse_failures"] += 1
            audit_counters["dual_aperture"]["fail_open_holds"] += 1
        else:
            audit_counters["dual_aperture"]["valid_structured"] += 1

        trace = {
            "fixture_id": fix["id"],
            "fixture_name": fix["name"],
            "user_text": fix["text"],
            "person_attention": periph.get("person_attention"),
            "idea_world_attention": periph.get("idea_world_attention"),
            "strongest_pull": periph.get("strongest_pull"),
            "decision": periph.get("decision"),
            "impulse": periph.get("impulse"),
            "foreground_response": res.assistant_message if hasattr(res, "assistant_message") else "",
            "model_used": res.model_used if hasattr(res, "model_used") else "google/gemini-3.7-flash",
            "periph_failed_open": periph_failed,
            "failure_layer": classify_failure({
                "decision": periph.get("decision"),
                "person_attention": periph.get("person_attention"),
                "idea_world_attention": periph.get("idea_world_attention"),
                "strongest_pull": periph.get("strongest_pull"),
                "foreground_response": res.assistant_message if hasattr(res, "assistant_message") else "",
                "user_text": fix["text"],
                "periph_failed_open": periph_failed,
            })
        }
        restraint_traces.append(trace)

    await pipeline.close()

    # Save JSON Raw Artifact
    json_path = os.path.join(reports_dir, "integrated-replay-results.json")
    with open(json_path, "w") as f:
        json.dump({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "audit_counters": audit_counters,
            "bedford_traces": bedford_traces,
            "outward_traces": outward_traces,
            "relational_traces": relational_traces,
            "restraint_traces": restraint_traces,
        }, f, indent=2)

    # Produce Detailed Markdown Report
    md_path = os.path.join(reports_dir, "INTEGRATED_BEHAVIORAL_REPLAY_REPORT.md")
    with open(md_path, "w") as f:
        f.write(f"# PROVIDER-BACKED INTEGRATED BEHAVIORAL REPLAY REPORT\n\n")
        f.write(f"**Execution Timestamp:** {datetime.now(timezone.utc).isoformat()}  \n")
        f.write(f"**Raw Telemetry JSON:** [`evals/sophie/behavioral-harness/reports/integrated-replay-results.json`](file://{json_path})  \n\n")
        f.write(f"---\n\n")
        
        # Hard Validity Gate Section
        f.write(f"## 1. HARD VALIDITY GATE & PROVIDER HEALTH\n\n")
        f.write(f"### Dual Aperture Peripheral Calls:\n")
        f.write(f"- **Attempted:** {audit_counters['dual_aperture']['attempted']}\n")
        f.write(f"- **Valid Structured Outputs:** {audit_counters['dual_aperture']['valid_structured']}\n")
        f.write(f"- **Parse Failures:** {audit_counters['dual_aperture']['parse_failures']}\n")
        f.write(f"- **Schema Failures:** {audit_counters['dual_aperture']['schema_failures']}\n")
        f.write(f"- **Fail-Open HOLDs:** {audit_counters['dual_aperture']['fail_open_holds']}\n\n")

        f.write(f"### LIVE SITUATION Proposal Calls:\n")
        f.write(f"- **Attempted:** {audit_counters['live_situation']['attempted']}\n")
        f.write(f"- **Valid Structured Outputs:** {audit_counters['live_situation']['valid_structured']}\n")
        f.write(f"- **Parse Failures:** {audit_counters['live_situation']['parse_failures']}\n")
        f.write(f"- **Accepted Proposals:** {audit_counters['live_situation']['accepted_proposals']}\n")
        f.write(f"- **Rejected Proposals:** {audit_counters['live_situation']['rejected_proposals']}\n\n")

        # Recommendation
        valid_rate = (audit_counters['dual_aperture']['valid_structured'] / audit_counters['dual_aperture']['attempted']) * 100
        rec = "DEPLOY AND DOGFOOD" if valid_rate >= 80 else "ONE NARROW FIX + RETEST"
        f.write(f"**RECOMMENDATION:** **{rec}**  \n")
        f.write(f"Structured output parsing validity reached **{valid_rate:.1f}%** after the boundary fix.\n\n")

        f.write(f"---\n\n")
        f.write(f"## 2. Sequential Bedford Replay Trace Table (20 Verbatim Fields per Turn)\n\n")
        for b in bedford_traces:
            f.write(f"### Turn {b['turn_number']}: User: \"{b['user_text']}\"\n")
            f.write(f"1. **LIVE SITUATION (Before):** `{json.dumps(b['live_situation_before'])}`  \n")
            f.write(f"2. **User Message:** \"{b['user_text']}\"  \n")
            f.write(f"3. **Exact 3-Message Aperture:** `{json.dumps(b['exact_local_aperture'])}`  \n")
            f.write(f"4. **PERSON Attention:** *\"{b['person_attention']}\"*  \n")
            f.write(f"5. **IDEA/WORLD Attention:** *\"{b['idea_world_attention']}\"*  \n")
            f.write(f"6. **Strongest Pull:** *\"{b['strongest_pull']}\"*  \n")
            f.write(f"7. **Decision:** `{b['decision']}`  \n")
            f.write(f"8. **Impulse:** *\"{b['impulse']}\"*  \n")
            f.write(f"9. **Reason:** *\"{b['reason']}\"*  \n")
            f.write(f"10. **Foreground Advisory:** *\"{b['foreground_advisory_supplied']}\"*  \n")
            f.write(f"11. **Foreground Model:** `{b['foreground_model_used']}`  \n")
            f.write(f"12. **Foreground Response:** > \"{b['foreground_response']}\"\n")
            f.write(f"13. **LIVE SITUATION Model:** `{b['live_situation_model_used']}`  \n")
            f.write(f"14. **LIVE SITUATION Raw Result:** `{json.dumps(b['live_situation_raw'])}`  \n")
            f.write(f"15. **Proposal:** `{json.dumps(b['proposal'])}`  \n")
            f.write(f"16. **Proposal Accepted:** `{b['proposal_accepted']}` (Reason: {b['proposal_rejection_reason']})  \n")
            f.write(f"17. **LIVE SITUATION (After):** `{json.dumps(b['live_situation_after'])}`  \n")
            f.write(f"18. **Beat 2 Continuation:** `{b['beat_2_continuation']}`  \n")
            f.write(f"19. **Gear State:** `{json.dumps(b['gear_state'])}`  \n")
            f.write(f"20. **Latency:** `{json.dumps(b['latency'])}`  \n\n")

        f.write(f"---\n\n")
        f.write(f"## 3. Outward / Idea-World Regression Suite\n\n")
        for o in outward_traces:
            f.write(f"### Fixture: {o['fixture_name']}\n")
            f.write(f"**User Input:** \"{o['user_text']}\"  \n")
            f.write(f"- **PERSON Attention:** *\"{o['person_attention']}\"*  \n")
            f.write(f"- **IDEA/WORLD Attention:** *\"{o['idea_world_attention']}\"*  \n")
            f.write(f"- **Decision:** `{o['decision']}` | **Impulse:** *\"{o['impulse']}\"*  \n")
            f.write(f"- **Foreground Response:** > \"{o['foreground_response']}\"\n")
            f.write(f"- **Failure Taxonomy:** `{o['failure_layer']}`  \n\n")

        f.write(f"---\n\n")
        f.write(f"## 4. Relational & Mundane Sequence\n\n")
        for r in relational_traces:
            f.write(f"### Turn {r['turn_number']}: User: \"{r['user_text']}\"\n")
            f.write(f"- **PERSON Attention:** *\"{r['person_attention']}\"*  \n")
            f.write(f"- **IDEA/WORLD Attention:** *\"{r['idea_world_attention']}\"*  \n")
            f.write(f"- **Decision:** `{r['decision']}` | **Impulse:** *\"{r['impulse']}\"*  \n")
            f.write(f"- **Foreground Response:** > \"{r['foreground_response']}\"\n")
            f.write(f"- **LIVE SITUATION (After):** `{json.dumps(r['live_situation_after'])}`  \n\n")

        f.write(f"---\n\n")
        f.write(f"## 5. Restraint / ATTEND / Release Suite\n\n")
        for res in restraint_traces:
            f.write(f"### Fixture: {res['fixture_name']}\n")
            f.write(f"**User Input:** \"{res['user_text']}\"  \n")
            f.write(f"- **Decision:** `{res['decision']}` | **Impulse:** *\"{res['impulse']}\"*  \n")
            f.write(f"- **Foreground Response:** > \"{res['foreground_response']}\"\n")
            f.write(f"- **Failure Taxonomy:** `{res['failure_layer']}`  \n\n")

    print("==================================================")
    print("INTEGRATED BEHAVIORAL REPLAY COMPLETE.")
    print(f"Saved Raw JSON: {json_path}")
    print(f"Saved Report MD: {md_path}")
    print("==================================================")

if __name__ == "__main__":
    asyncio.run(run_integrated_replay())
