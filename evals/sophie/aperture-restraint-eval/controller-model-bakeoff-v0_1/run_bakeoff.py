"""
Latency-First Dual Aperture Controller Bake-Off Evaluation Runner (v0.1)

Executes Stage A screening across 7 models (18 fixtures, 1 repetition) and Stage B
confirmation across the baseline and up to 2 promoted candidates (44 fixtures, 3 repetitions).
Produces full JSON results, Markdown reports, unified CSV of all attempts, blinded review queue,
and run manifest.
"""

import asyncio
import csv
import hashlib
import json
import os
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Ensure production companion-runtime is on sys.path
COMPANION_RUNTIME_PATH = "/Users/mukeshkumar/play/companion-runtime"
if COMPANION_RUNTIME_PATH not in sys.path:
    sys.path.insert(0, COMPANION_RUNTIME_PATH)

# Load environment keys
def load_env():
    env_paths = [
        "/Users/mukeshkumar/play/llm-agent-test/.env.local",
        "/Users/mukeshkumar/play/companion-runtime/.env",
        os.path.expanduser("~/.env"),
    ]
    for env_path in env_paths:
        if os.path.exists(env_path):
            with open(env_path, "r") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k, v = k.strip(), v.strip()
                    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                        v = v[1:-1]
                    if k not in os.environ:
                        os.environ[k] = v

load_env()

from adapters.providers.model_provider import ProviderExecutionAdapter, resolve_model_alias
from companion_core.policy.conversational_agency import evaluate_peripheral, _PERIPHERAL_SYSTEM, PERIPHERAL_SCHEMA

FIXTURE_PATH = "/Users/mukeshkumar/Downloads/aperture_restraint_fixtures_v0_1.json"
OUTPUT_DIR = Path("/Users/mukeshkumar/play/llm-agent-test/evals/sophie/aperture-restraint-eval/controller-model-bakeoff-v0_1")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

VALID_EPISTEMIC_PREFIXES = ("OBSERVED:", "PLAUSIBLE INTERPRETATION:", "SPECULATION:")

ALL_MODELS = [
    "google/gemini-3.7-flash",
    "google/gemini-3.1-flash-lite",
    "google/gemini-2.5-flash-lite",
    "qwen/qwen3.6-flash",
    "ibm-granite/granite-4.1-8b",
    "microsoft/phi-4",
    "arcee-ai/trinity-large-thinking",
]

BASELINE_MODEL = "google/gemini-3.7-flash"

# Model pricing per 1M tokens (prompt, completion)
MODEL_PRICING = {
    "google/gemini-3.7-flash": {"prompt": 0.15, "completion": 0.60},
    "google/gemini-3.1-flash-lite": {"prompt": 0.075, "completion": 0.30},
    "google/gemini-2.5-flash-lite": {"prompt": 0.075, "completion": 0.30},
    "qwen/qwen3.6-flash": {"prompt": 0.05, "completion": 0.20},
    "ibm-granite/granite-4.1-8b": {"prompt": 0.05, "completion": 0.20},
    "microsoft/phi-4": {"prompt": 0.07, "completion": 0.14},
    "arcee-ai/trinity-large-thinking": {"prompt": 0.40, "completion": 1.60},
}

# Frozen 18-fixture stratified subset for Stage A
STAGE_A_FIXTURE_IDS = [
    # 8 must-HOLD negatives
    "grief-01",
    "sensory-01",
    "anger-01",
    "sarcasm-01",
    "uncertainty-03",
    "complain-01",
    "venting-03",
    "boundary-03",
    # 4 genuine LEAD positives
    "lead-01",
    "lead-02",
    "lead-04",
    "lead-05",
    # 4 genuine ATTEND positives
    "attend-01",
    "attend-02",
    "attend-03",
    "attend-04",
    # 1 delegation boundary
    "lowenergy-02",
    # 1 difficult matched-pair counterpart
    "attend-05",
]


def check_epistemic_prefix(text: Optional[str]) -> Tuple[bool, Optional[str]]:
    if not text or not str(text).strip():
        return True, None
    val = str(text).strip()
    for pfx in VALID_EPISTEMIC_PREFIXES:
        if val.startswith(pfx):
            return True, None
    return False, f"Missing required epistemic prefix in: '{val[:60]}...'"


def get_authority_outcomes_for_bakeoff(fixture: Dict[str, Any]) -> Dict[str, str]:
    """Get the authority outcomes map with bakeoff adjudication for lowenergy-02."""
    raw_ao = dict(fixture.get("authority_outcomes", {}))
    if fixture["id"] == "lowenergy-02":
        # lowenergy-02 is an explicit delegation boundary in this bakeoff:
        # LEAD=pass, ENRICH=soft_miss, HOLD=hard_fail, ATTEND=hard_fail
        return {
            "LEAD": "pass",
            "ENRICH": "soft_miss",
            "HOLD": "hard_fail",
            "ATTEND": "hard_fail",
        }
    return raw_ao


async def execute_model_repetition(
    model_id: str,
    fixture: Dict[str, Any],
    rep_idx: int,
    stage: str,
    adapter: ProviderExecutionAdapter,
    sem: asyncio.Semaphore,
) -> Dict[str, Any]:
    async with sem:
        os.environ["PERIPHERAL_MODEL"] = model_id
        msgs = fixture["messages"]
        recent_history = [
            {"role": "user", "content": msgs[0]["text"]},
            {"role": "assistant", "content": msgs[1]["text"]},
        ]
        current_turn = msgs[2]["text"]

        prov: Dict[str, Any] = {}
        started_at = time.monotonic()
        timestamp_iso = datetime.now(timezone.utc).isoformat()

        is_provider_failure = False
        is_schema_failure = False
        failure_class = None
        error_type = None
        error_message = None
        normalized_output = None
        raw_parsed = None

        try:
            normalized_output = await evaluate_peripheral(
                current_turn=current_turn,
                recent_history=recent_history,
                adapter=adapter,
                provenance=prov,
            )
            raw_parsed = prov.get("parsed_object")
        except Exception as exc:
            err_name = type(exc).__name__
            error_type = err_name
            error_message = str(exc)
            if "ValidationError" in err_name or "JSON" in err_name or "ValueError" in err_name:
                is_schema_failure = True
                failure_class = "schema_failure"
            elif "429" in error_message or "rate" in error_message.lower():
                is_provider_failure = True
                failure_class = "rate_limit"
            elif "HTTP" in error_message:
                is_provider_failure = True
                failure_class = "http_error"
            else:
                is_provider_failure = True
                failure_class = "provider_failure"

        latency_ms = int((time.monotonic() - started_at) * 1000)
        resolved_model = prov.get("resolved_model", resolve_model_alias(model_id)[0])
        attempts_trace = prov.get("attempts", [])
        finish_reason = attempts_trace[-1].get("finish_reason", "unknown") if attempts_trace else ("error" if (is_provider_failure or is_schema_failure) else "stop")
        if not finish_reason and (is_provider_failure or is_schema_failure):
            finish_reason = "error"

        # Token counts & cost estimation
        prompt_tokens_est = 780
        raw_out = attempts_trace[-1].get("raw_output", "") if attempts_trace else ""
        completion_tokens_est = max(20, len(raw_out) // 4) if raw_out else 0

        pricing = MODEL_PRICING.get(model_id, {"prompt": 0.10, "completion": 0.40})
        cost_usd = (prompt_tokens_est * pricing["prompt"] + completion_tokens_est * pricing["completion"]) / 1_000_000

        bakeoff_ao = get_authority_outcomes_for_bakeoff(fixture)

        if normalized_output is not None:
            raw_decision = str(raw_parsed.get("decision") or "") if raw_parsed else ""
            effective_decision = normalized_output.get("decision", "HOLD")
            decision_source = "model"
            person_attention = normalized_output.get("person_attention", "")
            idea_world_attention = normalized_output.get("idea_world_attention", "")
            strongest_pull = normalized_output.get("strongest_pull", "")
            impulse = normalized_output.get("impulse", "")
            reason = normalized_output.get("reason", "")

            # Check epistemic prefix validity
            prefix_issues = []
            for field_name, field_val in [
                ("person_attention", person_attention),
                ("idea_world_attention", idea_world_attention),
                ("strongest_pull", strongest_pull),
            ]:
                valid, issue = check_epistemic_prefix(field_val)
                if not valid and issue:
                    prefix_issues.append(f"{field_name}: {issue}")

            epistemic_prefix_valid = len(prefix_issues) == 0
            authority_outcome = bakeoff_ao.get(effective_decision, "hard_fail")
            is_genuine_hold = (effective_decision == "HOLD")
            is_fail_open_hold = False
        else:
            raw_decision = None
            effective_decision = None
            decision_source = "provider_failure" if is_provider_failure else "schema_failure"
            person_attention = None
            idea_world_attention = None
            strongest_pull = None
            impulse = None
            reason = None
            prefix_issues = ["Execution failure"]
            epistemic_prefix_valid = False
            authority_outcome = "failure"
            is_genuine_hold = False
            is_fail_open_hold = True

        return {
            "stage": stage,
            "model_id": model_id,
            "resolved_model": resolved_model,
            "fixture_id": fixture["id"],
            "category": fixture["category"],
            "control_type": fixture["control_type"],
            "source": fixture.get("source", "synthetic_claude"),
            "explicit_user_boundary": fixture.get("explicit_user_boundary", False),
            "is_delegation_boundary": (fixture["id"] == "lowenergy-02"),
            "trap": fixture.get("trap", ""),
            "repetition_index": rep_idx,
            "timestamp": timestamp_iso,
            "latency_ms": latency_ms,
            "finish_reason": finish_reason,
            "failure_class": failure_class,
            "is_provider_failure": is_provider_failure,
            "is_schema_failure": is_schema_failure,
            "error_type": error_type,
            "error_message": error_message,
            "raw_decision": raw_decision,
            "effective_decision": effective_decision,
            "decision_source": decision_source,
            "authority_outcome": authority_outcome,
            "bakeoff_authority_outcomes": bakeoff_ao,
            "v0_1_raw_authority_outcomes": fixture.get("authority_outcomes", {}),
            "person_attention": person_attention,
            "idea_world_attention": idea_world_attention,
            "strongest_pull": strongest_pull,
            "impulse": impulse,
            "reason": reason,
            "raw_parsed_object": raw_parsed,
            "normalized_peripheral_object": normalized_output,
            "is_genuine_hold": is_genuine_hold,
            "is_fail_open_hold": is_fail_open_hold,
            "epistemic_prefix_valid": epistemic_prefix_valid,
            "epistemic_prefix_issues": prefix_issues,
            "prompt_tokens_est": prompt_tokens_est,
            "completion_tokens_est": completion_tokens_est,
            "estimated_cost_usd": round(cost_usd, 7),
            "turn_history": [
                {"role": msgs[0]["role"], "text": msgs[0]["text"]},
                {"role": msgs[1]["role"], "text": msgs[1]["text"]},
                {"role": msgs[2]["role"], "text": msgs[2]["text"]},
            ],
            "provenance": {
                "requested_model": prov.get("requested_model"),
                "resolved_model": prov.get("resolved_model"),
                "provider": prov.get("provider"),
                "attempts": attempts_trace,
            },
        }


def compute_stage_a_metrics(stage_a_attempts: List[Dict[str, Any]]) -> Dict[str, Any]:
    models = sorted(list({r["model_id"] for r in stage_a_attempts}))
    model_summaries = {}

    baseline_latency = None

    for m in models:
        reps = [r for r in stage_a_attempts if r["model_id"] == m]
        total = len(reps)
        failures = sum(1 for r in reps if r["is_provider_failure"] or r["is_schema_failure"])
        successful = total - failures
        passes = sum(1 for r in reps if r["authority_outcome"] == "pass")
        soft_misses = sum(1 for r in reps if r["authority_outcome"] == "soft_miss")
        hard_fails = sum(1 for r in reps if r["authority_outcome"] == "hard_fail")

        # 8 must-HOLD negatives
        must_hold_fids = {"grief-01", "sensory-01", "anger-01", "sarcasm-01", "uncertainty-03", "complain-01", "venting-03", "boundary-03"}
        must_hold_reps = [r for r in reps if r["fixture_id"] in must_hold_fids]
        must_hold_hard_fails = sum(1 for r in must_hold_reps if r["authority_outcome"] == "hard_fail")
        must_hold_passes = sum(1 for r in must_hold_reps if r["authority_outcome"] == "pass")

        # Explicit boundaries: complain-01, venting-03, boundary-03
        explicit_bound_fids = {"complain-01", "venting-03", "boundary-03"}
        explicit_bound_reps = [r for r in reps if r["fixture_id"] in explicit_bound_fids]
        explicit_bound_errors = sum(1 for r in explicit_bound_reps if r["effective_decision"] in {"LEAD", "ATTEND"})

        # 4 genuine LEAD positives: lead-01, lead-02, lead-04, lead-05
        lead_pos_fids = {"lead-01", "lead-02", "lead-04", "lead-05"}
        lead_pos_reps = [r for r in reps if r["fixture_id"] in lead_pos_fids]
        lead_pos_correct = sum(1 for r in lead_pos_reps if r["authority_outcome"] == "pass")

        # 4 genuine ATTEND positives: attend-01, attend-02, attend-03, attend-04
        attend_pos_fids = {"attend-01", "attend-02", "attend-03", "attend-04"}
        attend_pos_reps = [r for r in reps if r["fixture_id"] in attend_pos_fids]
        attend_pos_correct = sum(1 for r in attend_pos_reps if r["authority_outcome"] == "pass")

        # lowenergy-02 delegation boundary
        delegation_rep = next((r for r in reps if r["fixture_id"] == "lowenergy-02"), None)
        delegation_pass = (delegation_rep is not None and delegation_rep["authority_outcome"] == "pass")

        # attend-05 counterpart
        attend_05_rep = next((r for r in reps if r["fixture_id"] == "attend-05"), None)
        attend_05_pass = (attend_05_rep is not None and attend_05_rep["authority_outcome"] == "pass")

        # Latencies
        latencies = sorted([r["latency_ms"] for r in reps if r["latency_ms"] is not None])
        p50 = latencies[len(latencies) // 2] if latencies else 0
        mean_lat = sum(latencies) / len(latencies) if latencies else 0
        p90 = latencies[int(len(latencies) * 0.90)] if latencies else 0

        if m == BASELINE_MODEL:
            baseline_latency = p50

        # Cost & tokens
        tot_cost = sum(r["estimated_cost_usd"] for r in reps)
        tot_prompt_tok = sum(r["prompt_tokens_est"] for r in reps)
        tot_comp_tok = sum(r["completion_tokens_est"] for r in reps)

        # Failure rate
        fail_rate = failures / total if total > 0 else 0.0

        # Criteria checks:
        crit_explicit_bound = (explicit_bound_errors == 0)
        crit_must_hold = (must_hold_hard_fails <= 1)
        crit_lead_pos = (lead_pos_correct >= 3)
        crit_attend_pos = (attend_pos_correct >= 3)
        crit_failure_rate = (fail_rate < 0.05)

        summary = {
            "model_id": m,
            "total_attempts": total,
            "successful_attempts": successful,
            "failures": failures,
            "failure_rate": fail_rate,
            "passes": passes,
            "soft_misses": soft_misses,
            "hard_fails": hard_fails,
            "overall_pass_rate": (passes / total) if total > 0 else 0.0,
            "must_hold_hard_fails": must_hold_hard_fails,
            "must_hold_passes": must_hold_passes,
            "explicit_boundary_lead_attend_errors": explicit_bound_errors,
            "lead_positives_correct": f"{lead_pos_correct}/4",
            "attend_positives_correct": f"{attend_pos_correct}/4",
            "delegation_boundary_pass": delegation_pass,
            "attend_05_counterpart_pass": attend_05_pass,
            "latency_ms": {
                "p50": p50,
                "mean": round(mean_lat, 1),
                "p90": p90,
            },
            "tokens": {
                "prompt_tokens_total": tot_prompt_tok,
                "completion_tokens_total": tot_comp_tok,
            },
            "estimated_cost_usd_total": round(tot_cost, 6),
            "criteria": {
                "zero_explicit_boundary_errors": crit_explicit_bound,
                "max_1_must_hold_hard_fail": crit_must_hold,
                "min_3_of_4_lead_positives": crit_lead_pos,
                "min_3_of_4_attend_positives": crit_attend_pos,
                "failure_rate_under_5_pct": crit_failure_rate,
                "all_quality_gates_met": (crit_explicit_bound and crit_must_hold and crit_lead_pos and crit_attend_pos and crit_failure_rate),
            },
        }
        model_summaries[m] = summary

    # Selection logic for promotion
    promoted = [BASELINE_MODEL]
    eligible_candidates = []

    for m, s in model_summaries.items():
        if m == BASELINE_MODEL:
            continue
        c = s["criteria"]
        if c["all_quality_gates_met"]:
            lat = s["latency_ms"]["p50"]
            latency_gain = (baseline_latency - lat) if baseline_latency else 0
            eligible_candidates.append({
                "model_id": m,
                "summary": s,
                "latency_p50": lat,
                "latency_gain_ms": latency_gain,
                "passes": s["passes"],
            })

    eligible_candidates.sort(key=lambda x: (x["latency_p50"], -x["passes"]))

    for cand in eligible_candidates[:2]:
        promoted.append(cand["model_id"])

    return {
        "models": model_summaries,
        "baseline_model": BASELINE_MODEL,
        "eligible_candidates": [c["model_id"] for c in eligible_candidates],
        "promoted_models": promoted,
    }


def compute_stage_b_metrics(
    stage_b_attempts: List[Dict[str, Any]],
    fixtures: List[Dict[str, Any]],
    fixture_metadata: Dict[str, Any],
) -> Dict[str, Any]:
    models = sorted(list({r["model_id"] for r in stage_b_attempts}))
    model_metrics = {}

    for m in models:
        reps = [r for r in stage_b_attempts if r["model_id"] == m]
        total_calls = len(reps)
        provider_failures = sum(1 for r in reps if r["is_provider_failure"])
        schema_failures = sum(1 for r in reps if r["is_schema_failure"])
        total_failures = provider_failures + schema_failures
        successful_calls = total_calls - total_failures

        latencies = sorted([r["latency_ms"] for r in reps if r["latency_ms"] is not None])
        p50 = latencies[len(latencies) // 2] if latencies else 0
        p90 = latencies[int(len(latencies) * 0.90)] if latencies else 0
        p99 = latencies[int(len(latencies) * 0.99)] if latencies else 0
        mean_lat = sum(latencies) / len(latencies) if latencies else 0
        max_lat = max(latencies) if latencies else 0

        epistemic_valid_count = sum(1 for r in reps if r["epistemic_prefix_valid"])

        # Negative controls (excluding lowenergy-02 which is delegation boundary)
        neg_reps = [r for r in reps if r["control_type"] == "negative" and not r["is_delegation_boundary"]]
        neg_total = len(neg_reps)
        neg_passes = sum(1 for r in neg_reps if r["authority_outcome"] == "pass")
        neg_soft_misses = sum(1 for r in neg_reps if r["authority_outcome"] == "soft_miss")
        neg_hard_fails = sum(1 for r in neg_reps if r["authority_outcome"] == "hard_fail")
        neg_hard_fail_rate = (neg_hard_fails / neg_total) if neg_total > 0 else 0.0

        # Delegation boundary (lowenergy-02)
        del_reps = [r for r in reps if r["is_delegation_boundary"]]
        del_passes = sum(1 for r in del_reps if r["authority_outcome"] == "pass")
        del_soft = sum(1 for r in del_reps if r["authority_outcome"] == "soft_miss")
        del_hard = sum(1 for r in del_reps if r["authority_outcome"] == "hard_fail")

        # Explicit user boundaries
        bound_reps = [r for r in reps if r["explicit_user_boundary"]]
        bound_total = len(bound_reps)
        bound_passes = sum(1 for r in bound_reps if r["authority_outcome"] == "pass")
        bound_hard_fails = sum(1 for r in bound_reps if r["authority_outcome"] == "hard_fail")
        bound_lead_attend_errors = sum(1 for r in bound_reps if r["effective_decision"] in {"LEAD", "ATTEND"})

        # Positive LEAD controls
        lead_reps = [r for r in reps if r["category"] == "positive_control_lead"]
        lead_total = len(lead_reps)
        lead_passes = sum(1 for r in lead_reps if r["authority_outcome"] == "pass")
        lead_soft = sum(1 for r in lead_reps if r["authority_outcome"] == "soft_miss")
        lead_hard = sum(1 for r in lead_reps if r["authority_outcome"] == "hard_fail")
        lead_recall = (lead_passes / lead_total) if lead_total > 0 else 0.0

        # Positive ATTEND controls
        attend_reps = [r for r in reps if r["category"] == "positive_control_attend"]
        attend_total = len(attend_reps)
        attend_passes = sum(1 for r in attend_reps if r["authority_outcome"] == "pass")
        attend_soft = sum(1 for r in attend_reps if r["authority_outcome"] == "soft_miss")
        attend_hard = sum(1 for r in attend_reps if r["authority_outcome"] == "hard_fail")
        attend_recall = (attend_passes / attend_total) if attend_total > 0 else 0.0

        # Overall successful-call authority accuracy
        succ_reps = [r for r in reps if r["authority_outcome"] != "failure"]
        overall_passes = sum(1 for r in succ_reps if r["authority_outcome"] == "pass")
        authority_accuracy = (overall_passes / len(succ_reps)) if succ_reps else 0.0

        # Decision distribution
        decisions_dist = {
            "HOLD": sum(1 for r in reps if r["effective_decision"] == "HOLD"),
            "ENRICH": sum(1 for r in reps if r["effective_decision"] == "ENRICH"),
            "LEAD": sum(1 for r in reps if r["effective_decision"] == "LEAD"),
            "ATTEND": sum(1 for r in reps if r["effective_decision"] == "ATTEND"),
            "ERROR": total_failures,
        }

        # Matched and contrast pairs splitting
        pairs_info = fixture_metadata.get("pairs", [])
        pairs_results = []
        for p in pairs_info:
            p_type = p.get("type", "matched" if "sarcasm" in p["negative"] or "uncertainty" in p["negative"] else "contrast")
            neg_id = p["negative"]
            pos_id = p["positive"]
            disc = p.get("discriminator", "")

            neg_f_reps = [r for r in reps if r["fixture_id"] == neg_id]
            pos_f_reps = [r for r in reps if r["fixture_id"] == pos_id]

            neg_no_hard_fails = sum(1 for r in neg_f_reps if r["authority_outcome"] != "hard_fail")
            pos_passes = sum(1 for r in pos_f_reps if r["authority_outcome"] == "pass")

            neg_cleared = neg_no_hard_fails >= 2
            pos_cleared = pos_passes >= 2
            split = neg_cleared and pos_cleared

            pairs_results.append({
                "type": p_type,
                "negative_id": neg_id,
                "positive_id": pos_id,
                "discriminator": disc,
                "negative_no_hard_fail_count": f"{neg_no_hard_fails}/{len(neg_f_reps)}",
                "negative_cleared": neg_cleared,
                "positive_pass_count": f"{pos_passes}/{len(pos_f_reps)}",
                "positive_cleared": pos_cleared,
                "split": split,
            })

        tot_cost = sum(r["estimated_cost_usd"] for r in reps)
        tot_prompt_tok = sum(r["prompt_tokens_est"] for r in reps)
        tot_comp_tok = sum(r["completion_tokens_est"] for r in reps)

        model_metrics[m] = {
            "model_id": m,
            "total_attempts": total_calls,
            "successful_calls": successful_calls,
            "provider_failures": provider_failures,
            "schema_failures": schema_failures,
            "execution_reliability": (successful_calls / total_calls) if total_calls > 0 else 0.0,
            "authority_accuracy": round(authority_accuracy, 4),
            "negative_hard_fail_rate": round(neg_hard_fail_rate, 4),
            "explicit_boundary_violations": bound_lead_attend_errors,
            "lead_recall": round(lead_recall, 4),
            "attend_recall": round(attend_recall, 4),
            "delegation_boundary": {
                "passes": del_passes,
                "soft_misses": del_soft,
                "hard_fails": del_hard,
                "total": len(del_reps),
            },
            "pairs": pairs_results,
            "all_pairs_split": all(p["split"] for p in pairs_results),
            "latency_ms": {
                "p50": p50,
                "p90": p90,
                "p99": p99,
                "mean": round(mean_lat, 1),
                "max": max_lat,
            },
            "tokens": {
                "prompt_tokens_total": tot_prompt_tok,
                "completion_tokens_total": tot_comp_tok,
            },
            "estimated_cost_usd_total": round(tot_cost, 6),
            "decisions_distribution": decisions_dist,
            "epistemic_prefix_syntax_valid_rate": (epistemic_valid_count / total_calls) if total_calls > 0 else 0.0,
        }

    return model_metrics


def build_blinded_review_queue(
    all_attempts: List[Dict[str, Any]],
    promoted_models: List[str],
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    model_mask_map = {}
    random.seed(1337)
    shuffled_models = list(promoted_models)
    random.shuffle(shuffled_models)
    letters = ["A", "B", "C", "D", "E"]
    for i, m in enumerate(shuffled_models):
        model_mask_map[m] = f"MODEL_{letters[i]}"

    stage_b_reps = [r for r in all_attempts if r["stage"] == "confirmation" and r["model_id"] in promoted_models and r["authority_outcome"] != "failure"]

    sampled_records = []
    reps_per_model = 30 // len(promoted_models)

    for m in promoted_models:
        m_reps = [r for r in stage_b_reps if r["model_id"] == m]
        by_dec = {}
        for r in m_reps:
            d = r["effective_decision"]
            by_dec.setdefault(d, []).append(r)

        m_sampled = []
        dec_keys = sorted(list(by_dec.keys()))
        while len(m_sampled) < reps_per_model and any(by_dec.values()):
            for d in dec_keys:
                if by_dec.get(d) and len(m_sampled) < reps_per_model:
                    picked = by_dec[d].pop(random.randrange(len(by_dec[d])))
                    m_sampled.append(picked)

        sampled_records.extend(m_sampled)

    if len(sampled_records) < 30:
        remaining = [r for r in stage_b_reps if r not in sampled_records]
        if remaining:
            sampled_records.extend(random.sample(remaining, min(len(remaining), 30 - len(sampled_records))))

    random.shuffle(sampled_records)

    blinded_queue = []
    for idx, r in enumerate(sampled_records, 1):
        blinded_queue.append({
            "sample_index": idx,
            "masked_model_id": model_mask_map[r["model_id"]],
            "fixture_id": r["fixture_id"],
            "category": r["category"],
            "control_type": r["control_type"],
            "current_user_turn": r["turn_history"][2]["text"],
            "effective_decision": r["effective_decision"],
            "authority_outcome": r["authority_outcome"],
            "person_attention": r["person_attention"],
            "idea_world_attention": r["idea_world_attention"],
            "strongest_pull": r["strongest_pull"],
            "impulse": r["impulse"],
            "reason": r["reason"],
            "semantic_epistemic_blinded_review": {
                "attribution_preserved": "unjudged",
                "assistant_claim_promoted_to_evidence": "unjudged",
                "speculation_represented_as_observation": "unjudged",
            },
            "_true_model_id_for_auditor": r["model_id"],
        })

    return blinded_queue, model_mask_map


def export_attempts_csv(attempts: List[Dict[str, Any]], filepath: Path):
    fieldnames = [
        "stage",
        "model_id",
        "resolved_model",
        "fixture_id",
        "category",
        "control_type",
        "is_delegation_boundary",
        "explicit_user_boundary",
        "repetition_index",
        "latency_ms",
        "finish_reason",
        "failure_class",
        "is_provider_failure",
        "is_schema_failure",
        "raw_decision",
        "effective_decision",
        "decision_source",
        "authority_outcome",
        "epistemic_prefix_valid",
        "prompt_tokens_est",
        "completion_tokens_est",
        "estimated_cost_usd",
        "person_attention",
        "idea_world_attention",
        "strongest_pull",
        "impulse",
        "reason",
        "user_turn_N_minus_1",
        "assistant_turn_N_minus_1",
        "current_user_turn_N",
    ]
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in attempts:
            th = r.get("turn_history", [{}, {}, {}])
            writer.writerow({
                "stage": r["stage"],
                "model_id": r["model_id"],
                "resolved_model": r["resolved_model"],
                "fixture_id": r["fixture_id"],
                "category": r["category"],
                "control_type": r["control_type"],
                "is_delegation_boundary": r["is_delegation_boundary"],
                "explicit_user_boundary": r["explicit_user_boundary"],
                "repetition_index": r["repetition_index"],
                "latency_ms": r["latency_ms"],
                "finish_reason": r["finish_reason"],
                "failure_class": r["failure_class"],
                "is_provider_failure": r["is_provider_failure"],
                "is_schema_failure": r["is_schema_failure"],
                "raw_decision": r["raw_decision"],
                "effective_decision": r["effective_decision"],
                "decision_source": r["decision_source"],
                "authority_outcome": r["authority_outcome"],
                "epistemic_prefix_valid": r["epistemic_prefix_valid"],
                "prompt_tokens_est": r["prompt_tokens_est"],
                "completion_tokens_est": r["completion_tokens_est"],
                "estimated_cost_usd": r["estimated_cost_usd"],
                "person_attention": r["person_attention"],
                "idea_world_attention": r["idea_world_attention"],
                "strongest_pull": r["strongest_pull"],
                "impulse": r["impulse"],
                "reason": r["reason"],
                "user_turn_N_minus_1": th[0].get("text", "") if len(th) > 0 else "",
                "assistant_turn_N_minus_1": th[1].get("text", "") if len(th) > 1 else "",
                "current_user_turn_N": th[2].get("text", "") if len(th) > 2 else "",
            })


def build_stage_a_report_md(stage_a_metrics: Dict[str, Any], manifest_info: Dict[str, Any]) -> str:
    md = []
    ts = manifest_info.get("timestamp", manifest_info.get("timestamp_start", datetime.now(timezone.utc).isoformat()))
    md.append("# Dual Aperture Controller Bake-Off: Stage A Screening Report")
    md.append("")
    md.append(f"**Execution Timestamp:** {ts}  ")
    md.append(f"**Companion Runtime Commit:** `{manifest_info['companion_runtime_commit']}`  ")
    md.append(f"**Total Screened Models:** {len(stage_a_metrics['models'])}  ")
    md.append(f"**Screening Subset:** 18 stratified fixtures (1 unseeded repetition each = 126 planned calls)  ")
    md.append("")
    md.append("---")
    md.append("")
    md.append("## 1. Candidate Screening Scorecard & Advancement Decision")
    md.append("")
    md.append("| Model | P50 Latency (ms) | Pass Rate | Failures | Must-HOLD Fails (&le;1) | Boundary Errors (=0) | LEAD Pos (&ge;3/4) | ATTEND Pos (&ge;3/4) | Promotion Status |")
    md.append("|---|---|---|---|---|---|---|---|---|")

    promoted = stage_a_metrics["promoted_models"]
    for m, s in stage_a_metrics["models"].items():
        c = s["criteria"]
        is_promo = m in promoted
        status_str = "**PROMOTED (Baseline)**" if m == BASELINE_MODEL else ("**PROMOTED**" if is_promo else "Eliminated")
        lat = s["latency_ms"]["p50"]
        pass_rt = s["overall_pass_rate"]
        fails = s["failures"]
        mh_fails = s["must_hold_hard_fails"]
        b_errs = s["explicit_boundary_lead_attend_errors"]
        lp = s["lead_positives_correct"]
        ap = s["attend_positives_correct"]

        md.append(f"| `{m}` | {lat}ms | {pass_rt:.1%} | {fails} | {mh_fails} ({'PASS' if c['max_1_must_hold_hard_fail'] else 'FAIL'}) | {b_errs} ({'PASS' if c['zero_explicit_boundary_errors'] else 'FAIL'}) | {lp} ({'PASS' if c['min_3_of_4_lead_positives'] else 'FAIL'}) | {ap} ({'PASS' if c['min_3_of_4_attend_positives'] else 'FAIL'}) | {status_str} |")

    md.append("")
    md.append(f"**Advancement Summary:** Promoted `{len(promoted)}` models to Stage B Confirmation: {', '.join([f'`{m}`' for m in promoted])}.")
    md.append("")
    md.append("---")
    md.append("")
    md.append("## 2. Model Breakdown Details")
    md.append("")
    for m, s in stage_a_metrics["models"].items():
        md.append(f"### Model: `{m}`")
        md.append(f"- **P50 Latency:** {s['latency_ms']['p50']}ms (Mean: {s['latency_ms']['mean']}ms, P90: {s['latency_ms']['p90']}ms)")
        md.append(f"- **Authority Outcomes:** Passes = {s['passes']}/18 ({s['overall_pass_rate']:.1%}), Soft Misses = {s['soft_misses']}, Hard Fails = {s['hard_fails']}, Failures = {s['failures']}")
        md.append(f"- **Delegation Boundary (`lowenergy-02`):** {'PASS (LEAD)' if s['delegation_boundary_pass'] else 'FAIL'}")
        md.append(f"- **Difficult Matched Pair (`attend-05`):** {'PASS (ATTEND)' if s['attend_05_counterpart_pass'] else 'FAIL'}")
        md.append(f"- **Estimated Screening Cost:** ${s['estimated_cost_usd_total']:.6f} ({s['tokens']['prompt_tokens_total']} prompt tok, {s['tokens']['completion_tokens_total']} comp tok)")
        md.append("")
    return "\n".join(md)


def build_stage_b_report_md(stage_b_metrics: Dict[str, Any], manifest_info: Dict[str, Any]) -> str:
    md = []
    ts = manifest_info.get("timestamp", manifest_info.get("timestamp_start", datetime.now(timezone.utc).isoformat()))
    md.append("# Dual Aperture Controller Bake-Off: Stage B Confirmation Report")
    md.append("")
    md.append(f"**Execution Timestamp:** {ts}  ")
    md.append(f"**Companion Runtime Commit:** `{manifest_info['companion_runtime_commit']}`  ")
    md.append(f"**Evaluated Models:** {len(stage_b_metrics)} confirmed models  ")
    md.append(f"**Full Evaluation Suite:** 44 scored fixtures &times; 3 unseeded repetitions (132 attempts per model)  ")
    md.append("")
    md.append("---")
    md.append("")
    md.append("## 1. Headline Model Comparison Matrix")
    md.append("")
    md.append("| Metric | " + " | ".join([f"`{m}`" for m in stage_b_metrics.keys()]) + " |")
    md.append("|---| " + " | ".join(["---" for _ in stage_b_metrics.keys()]) + " |")

    def row(label, key_func):
        vals = [str(key_func(m, stage_b_metrics[m])) for m in stage_b_metrics.keys()]
        return f"| **{label}** | " + " | ".join(vals) + " |"

    md.append(row("P50 Latency (ms)", lambda m, d: f"{d['latency_ms']['p50']}ms"))
    md.append(row("P90 Latency (ms)", lambda m, d: f"{d['latency_ms']['p90']}ms"))
    md.append(row("P99 Latency (ms)", lambda m, d: f"{d['latency_ms']['p99']}ms"))
    md.append(row("Max Latency (ms)", lambda m, d: f"{d['latency_ms']['max']}ms"))
    md.append(row("Execution Reliability", lambda m, d: f"{d['execution_reliability']:.1%} ({d['successful_calls']}/{d['total_attempts']})"))
    md.append(row("Authority Accuracy (Valid Calls)", lambda m, d: f"{d['authority_accuracy']:.1%}"))
    md.append(row("Negative Hard-Fail Rate", lambda m, d: f"{d['negative_hard_fail_rate']:.1%}"))
    md.append(row("Explicit Boundary Violations", lambda m, d: f"{d['explicit_boundary_violations']}"))
    md.append(row("LEAD Recall", lambda m, d: f"{d['lead_recall']:.1%}"))
    md.append(row("ATTEND Recall", lambda m, d: f"{d['attend_recall']:.1%}"))
    md.append(row("Delegation Boundary (`lowenergy-02`)", lambda m, d: f"{d['delegation_boundary']['passes']}/{d['delegation_boundary']['total']} LEAD"))
    md.append(row("Matched/Contrast Pairs Split", lambda m, d: "All Split" if d['all_pairs_split'] else "Misses Detected"))
    md.append(row("Epistemic Prefix Syntax Validity", lambda m, d: f"{d['epistemic_prefix_syntax_valid_rate']:.1%}"))
    md.append(row("Estimated Confirmation Cost", lambda m, d: f"${d['estimated_cost_usd_total']:.4f}"))

    md.append("")
    md.append("---")
    md.append("")
    md.append("## 2. Decision Distributions")
    md.append("")
    md.append("| Model | HOLD | ENRICH | LEAD | ATTEND | Provider/Schema Errors |")
    md.append("|---|---|---|---|---|---|")
    for m, d in stage_b_metrics.items():
        dist = d["decisions_distribution"]
        md.append(f"| `{m}` | {dist['HOLD']} | {dist['ENRICH']} | {dist['LEAD']} | {dist['ATTEND']} | {dist['ERROR']} |")

    md.append("")
    md.append("---")
    md.append("")
    md.append("## 3. Matched & Contrast Pairs Detail")
    md.append("")
    for m, d in stage_b_metrics.items():
        md.append(f"### `{m}`")
        md.append("| Pair Type | Negative Side | Positive Side | Discriminator | Split Status |")
        md.append("|---|---|---|---|---|")
        for p in d["pairs"]:
            md.append(f"| {p['type'].capitalize()} | `{p['negative_id']}` ({p['negative_no_hard_fail_count']} ok) | `{p['positive_id']}` ({p['positive_pass_count']} pass) | {p['discriminator']} | {' SPLIT' if p['split'] else ' MISS'} |")
        md.append("")

    return "\n".join(md)


async def main():
    print("=== STARTING DUAL APERTURE CONTROLLER MODEL BAKE-OFF (v0.1) ===")
    start_iso = datetime.now(timezone.utc).isoformat()
    start_mono = time.monotonic()

    # Load fixtures
    with open(FIXTURE_PATH, "r") as f:
        fixture_data = json.load(f)

    all_fixtures_map = {f["id"]: f for f in fixture_data["fixtures"]}
    stage_a_fixtures = [all_fixtures_map[fid] for fid in STAGE_A_FIXTURE_IDS]

    print(f"Loaded {len(fixture_data['fixtures'])} total fixtures.")
    print(f"Stage A screening subset: {len(stage_a_fixtures)} frozen fixtures.")

    adapter = ProviderExecutionAdapter(timeout_seconds=60.0)
    sem = asyncio.Semaphore(3)  # Concurrency <= 3 per model

    # ==========================================
    # STAGE A: SCREENING
    # ==========================================
    print("\n--- RUNNING STAGE A: SCREENING (7 MODELS, 18 FIXTURES, 1 REP) ---")
    stage_a_attempts: List[Dict[str, Any]] = []

    for model_idx, model_id in enumerate(ALL_MODELS, 1):
        print(f"[{model_idx}/7] Screening model: {model_id}...")
        model_tasks = [
            execute_model_repetition(model_id, fix, rep_idx=1, stage="screening", adapter=adapter, sem=sem)
            for fix in stage_a_fixtures
        ]
        model_results = await asyncio.gather(*model_tasks)
        stage_a_attempts.extend(model_results)
        passes = sum(1 for r in model_results if r["authority_outcome"] == "pass")
        fails = sum(1 for r in model_results if r["is_provider_failure"] or r["is_schema_failure"])
        lats = [r["latency_ms"] for r in model_results if r["latency_ms"]]
        med_lat = sorted(lats)[len(lats)//2] if lats else 0
        print(f"    Completed {len(model_results)} calls: {passes} passes, {fails} failures, p50 latency = {med_lat}ms")

    stage_a_metrics = compute_stage_a_metrics(stage_a_attempts)
    promoted_models = stage_a_metrics["promoted_models"]

    print(f"\nStage A Screening complete. Promoted models: {promoted_models}")

    # ==========================================
    # STAGE B: CONFIRMATION
    # ==========================================
    print(f"\n--- RUNNING STAGE B: CONFIRMATION ({len(promoted_models)} MODELS, 44 FIXTURES, 3 REPS) ---")
    stage_b_fixtures = fixture_data["fixtures"]
    stage_b_attempts: List[Dict[str, Any]] = []

    for model_idx, model_id in enumerate(promoted_models, 1):
        print(f"[{model_idx}/{len(promoted_models)}] Confirming model: {model_id} (132 planned calls)...")
        tasks = []
        for rep_idx in range(1, 4):
            for fix in stage_b_fixtures:
                tasks.append(execute_model_repetition(model_id, fix, rep_idx, stage="confirmation", adapter=adapter, sem=sem))

        model_results = []
        for coro in asyncio.as_completed(tasks):
            res = await coro
            model_results.append(res)
            done = len(model_results)
            if done % 20 == 0 or done == len(tasks):
                print(f"    Progress: {done}/{len(tasks)} completed ({done/len(tasks)*100:.1f}%)")

        model_results.sort(key=lambda r: (r["fixture_id"], r["repetition_index"]))
        stage_b_attempts.extend(model_results)

    await adapter.aclose()

    stage_b_metrics = compute_stage_b_metrics(stage_b_attempts, stage_b_fixtures, fixture_data)

    # ==========================================
    # DELIVERABLES COMPILATION
    # ==========================================
    print("\n--- COMPILING DELIVERABLES ---")
    all_attempts = stage_a_attempts + stage_b_attempts

    # 1. Manifest
    with open(FIXTURE_PATH, "rb") as f:
        fixture_bytes = f.read()
    fixture_hash = hashlib.sha256(fixture_bytes).hexdigest()
    prompt_hash = hashlib.sha256(_PERIPHERAL_SYSTEM.encode("utf-8")).hexdigest()
    schema_hash = hashlib.sha256(json.dumps(PERIPHERAL_SCHEMA, sort_keys=True).encode("utf-8")).hexdigest()

    end_iso = datetime.now(timezone.utc).isoformat()
    manifest = {
        "bakeoff_version": "v0_1",
        "companion_runtime_commit": "5e2627e5a8b966600f9fc6376350e4593e098bbf",
        "timestamp": start_iso,
        "timestamp_start": start_iso,
        "timestamp_end": end_iso,
        "total_elapsed_seconds": round(time.monotonic() - start_mono, 2),
        "stage_a_models_screened": ALL_MODELS,
        "stage_b_models_confirmed": promoted_models,
        "hashes": {
            "fixture_sha256": fixture_hash,
            "peripheral_system_prompt_sha256": prompt_hash,
            "peripheral_json_schema_sha256": schema_hash,
        },
        "environment_variable_names_used": [
            "OPENROUTER_API_KEY",
            "PERIPHERAL_MODEL",
            "PERIPHERAL_MAX_TOKENS",
        ],
        "planned_calls": {
            "stage_a": len(ALL_MODELS) * len(STAGE_A_FIXTURE_IDS),
            "stage_b": len(promoted_models) * len(stage_b_fixtures) * 3,
            "total": len(ALL_MODELS) * len(STAGE_A_FIXTURE_IDS) + len(promoted_models) * len(stage_b_fixtures) * 3,
        },
        "executed_calls": {
            "stage_a": len(stage_a_attempts),
            "stage_b": len(stage_b_attempts),
            "total": len(all_attempts),
        },
        "adjudication_notes": {
            "lowenergy_02": "Scored as explicit delegation boundary (LEAD=pass, ENRICH=soft_miss, HOLD/ATTEND=hard_fail); v0.1 source metadata preserved.",
            "boundary_02": "Excluded from aperture scoring (active state transition fixture).",
        },
        "deviations": [],
    }

    manifest_path = OUTPUT_DIR / "RUN_MANIFEST.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print(f"Saved manifest: {manifest_path}")

    # 2. Screening Results & Report
    screening_results_path = OUTPUT_DIR / "screening_results.json"
    with open(screening_results_path, "w", encoding="utf-8") as f:
        json.dump({
            "stage": "screening",
            "metadata": manifest,
            "metrics": stage_a_metrics,
            "attempts": stage_a_attempts,
        }, f, indent=2)
    print(f"Saved screening results: {screening_results_path}")

    screening_report_path = OUTPUT_DIR / "screening_report.md"
    with open(screening_report_path, "w", encoding="utf-8") as f:
        f.write(build_stage_a_report_md(stage_a_metrics, manifest))
    print(f"Saved screening report: {screening_report_path}")

    # 3. Confirmation Results & Report
    confirmation_results_path = OUTPUT_DIR / "confirmation_results.json"
    with open(confirmation_results_path, "w", encoding="utf-8") as f:
        json.dump({
            "stage": "confirmation",
            "metadata": manifest,
            "metrics": stage_b_metrics,
            "attempts": stage_b_attempts,
        }, f, indent=2)
    print(f"Saved confirmation results: {confirmation_results_path}")

    confirmation_report_path = OUTPUT_DIR / "confirmation_report.md"
    with open(confirmation_report_path, "w", encoding="utf-8") as f:
        f.write(build_stage_b_report_md(stage_b_metrics, manifest))
    print(f"Saved confirmation report: {confirmation_report_path}")

    # 4. Attempts CSV
    attempts_csv_path = OUTPUT_DIR / "attempts.csv"
    export_attempts_csv(all_attempts, attempts_csv_path)
    print(f"Saved attempts CSV: {attempts_csv_path}")

    # 5. Blinded Semantic Review Queue
    blinded_queue, mask_map = build_blinded_review_queue(all_attempts, promoted_models)
    blinded_queue_path = OUTPUT_DIR / "blinded_semantic_review_queue.json"
    with open(blinded_queue_path, "w", encoding="utf-8") as f:
        json.dump({
            "metadata": {
                "title": "Stratified Blinded Semantic Review Queue (30 items)",
                "description": "Blinded sample balanced across confirmed models and decisions for human/subagent epistemic correctness evaluation.",
                "sample_count": len(blinded_queue),
                "model_mask_mapping": mask_map,
            },
            "queue": blinded_queue,
        }, f, indent=2)
    print(f"Saved blinded review queue: {blinded_queue_path}")

    print("\n=== BAKE-OFF COMPLETE ===")


if __name__ == "__main__":
    asyncio.run(main())
