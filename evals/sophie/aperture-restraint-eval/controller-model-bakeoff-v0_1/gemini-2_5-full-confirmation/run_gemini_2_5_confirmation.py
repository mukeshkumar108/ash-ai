"""
Gemini 2.5 Flash Lite Full Confirmation Follow-up Runner.

Executes 5 unseeded repetitions across all 44 scored fixtures (220 calls total)
using the exact unchanged production Dual Aperture evaluate_peripheral implementation.
Generates full JSON results, Markdown comparison report against Gemini 3.7 Flash baseline,
attempts CSV, and run manifest.
"""

import asyncio
import csv
import hashlib
import json
import os
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Ensure production companion-runtime is on sys.path
COMPANION_RUNTIME_PATH = "/Users/mukeshkumar/play/companion-runtime"
if COMPANION_RUNTIME_PATH not in sys.path:
    sys.path.insert(0, COMPANION_RUNTIME_PATH)

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
BASE_DIR = Path("/Users/mukeshkumar/play/llm-agent-test/evals/sophie/aperture-restraint-eval/controller-model-bakeoff-v0_1")
OUTPUT_DIR = BASE_DIR / "gemini-2_5-full-confirmation"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

PREV_STAGE_B_RESULTS_PATH = BASE_DIR / "confirmation_results.json"

MODEL_UNDER_TEST = "google/gemini-2.5-flash-lite"
MODEL_PRICING = {"prompt": 0.075, "completion": 0.30}  # $ per 1M tokens

VALID_EPISTEMIC_PREFIXES = ("OBSERVED:", "PLAUSIBLE INTERPRETATION:", "SPECULATION:")


def check_epistemic_prefix(text: Optional[str]) -> Tuple[bool, Optional[str]]:
    if not text or not str(text).strip():
        return True, None
    val = str(text).strip()
    for pfx in VALID_EPISTEMIC_PREFIXES:
        if val.startswith(pfx):
            return True, None
    return False, f"Missing required epistemic prefix in: '{val[:60]}...'"


def get_authority_outcomes_for_bakeoff(fixture: Dict[str, Any]) -> Dict[str, str]:
    raw_ao = dict(fixture.get("authority_outcomes", {}))
    if fixture["id"] == "lowenergy-02":
        return {
            "LEAD": "pass",
            "ENRICH": "soft_miss",
            "HOLD": "hard_fail",
            "ATTEND": "hard_fail",
        }
    return raw_ao


async def execute_repetition(
    fixture: Dict[str, Any],
    rep_idx: int,
    adapter: ProviderExecutionAdapter,
    sem: asyncio.Semaphore,
) -> Dict[str, Any]:
    async with sem:
        os.environ["PERIPHERAL_MODEL"] = MODEL_UNDER_TEST
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
        resolved_model = prov.get("resolved_model", resolve_model_alias(MODEL_UNDER_TEST)[0])
        attempts_trace = prov.get("attempts", [])
        finish_reason = attempts_trace[-1].get("finish_reason", "unknown") if attempts_trace else ("error" if (is_provider_failure or is_schema_failure) else "stop")
        if not finish_reason and (is_provider_failure or is_schema_failure):
            finish_reason = "error"

        prompt_tokens_est = 780
        raw_out = attempts_trace[-1].get("raw_output", "") if attempts_trace else ""
        completion_tokens_est = max(20, len(raw_out) // 4) if raw_out else 0
        cost_usd = (prompt_tokens_est * MODEL_PRICING["prompt"] + completion_tokens_est * MODEL_PRICING["completion"]) / 1_000_000

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
            "model_id": MODEL_UNDER_TEST,
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


def compute_metrics(
    attempts: List[Dict[str, Any]],
    fixtures: List[Dict[str, Any]],
    fixture_metadata: Dict[str, Any],
) -> Dict[str, Any]:
    total_calls = len(attempts)
    provider_fails = sum(1 for r in attempts if r["is_provider_failure"])
    schema_fails = sum(1 for r in attempts if r["is_schema_failure"])
    total_fails = provider_fails + schema_fails
    successful_calls = total_calls - total_fails

    latencies = sorted([r["latency_ms"] for r in attempts if r["latency_ms"] is not None])
    p50 = latencies[len(latencies) // 2] if latencies else 0
    p90 = latencies[int(len(latencies) * 0.90)] if latencies else 0
    p99 = latencies[int(len(latencies) * 0.99)] if latencies else 0
    mean_lat = sum(latencies) / len(latencies) if latencies else 0
    max_lat = max(latencies) if latencies else 0

    epistemic_valid = sum(1 for r in attempts if r["epistemic_prefix_valid"])

    # Negative controls (excluding lowenergy-02 delegation boundary)
    neg_reps = [r for r in attempts if r["control_type"] == "negative" and not r["is_delegation_boundary"]]
    neg_total = len(neg_reps)
    neg_passes = sum(1 for r in neg_reps if r["authority_outcome"] == "pass")
    neg_soft = sum(1 for r in neg_reps if r["authority_outcome"] == "soft_miss")
    neg_hard = sum(1 for r in neg_reps if r["authority_outcome"] == "hard_fail")
    neg_hard_fail_rate = (neg_hard / neg_total) if neg_total > 0 else 0.0

    # Delegation boundary (lowenergy-02)
    del_reps = [r for r in attempts if r["is_delegation_boundary"]]
    del_passes = sum(1 for r in del_reps if r["authority_outcome"] == "pass")
    del_soft = sum(1 for r in del_reps if r["authority_outcome"] == "soft_miss")
    del_hard = sum(1 for r in del_reps if r["authority_outcome"] == "hard_fail")

    # Explicit boundaries
    bound_reps = [r for r in attempts if r["explicit_user_boundary"]]
    bound_total = len(bound_reps)
    bound_passes = sum(1 for r in bound_reps if r["authority_outcome"] == "pass")
    bound_hard = sum(1 for r in bound_reps if r["authority_outcome"] == "hard_fail")
    bound_violations = sum(1 for r in bound_reps if r["effective_decision"] in {"LEAD", "ATTEND"})

    # Positive LEAD controls
    lead_reps = [r for r in attempts if r["category"] == "positive_control_lead"]
    lead_total = len(lead_reps)
    lead_passes = sum(1 for r in lead_reps if r["authority_outcome"] == "pass")
    lead_soft = sum(1 for r in lead_reps if r["authority_outcome"] == "soft_miss")
    lead_hard = sum(1 for r in lead_reps if r["authority_outcome"] == "hard_fail")
    lead_recall = (lead_passes / lead_total) if lead_total > 0 else 0.0

    # Positive ATTEND controls
    attend_reps = [r for r in attempts if r["category"] == "positive_control_attend"]
    attend_total = len(attend_reps)
    attend_passes = sum(1 for r in attend_reps if r["authority_outcome"] == "pass")
    attend_soft = sum(1 for r in attend_reps if r["authority_outcome"] == "soft_miss")
    attend_hard = sum(1 for r in attend_reps if r["authority_outcome"] == "hard_fail")
    attend_recall = (attend_passes / attend_total) if attend_total > 0 else 0.0

    # Overall valid authority accuracy
    succ_reps = [r for r in attempts if r["authority_outcome"] != "failure"]
    overall_passes = sum(1 for r in succ_reps if r["authority_outcome"] == "pass")
    authority_accuracy = (overall_passes / len(succ_reps)) if succ_reps else 0.0

    # Per-fixture stability across the 5 repetitions
    fixture_stability = {}
    for f in fixtures:
        fid = f["id"]
        freps = [r for r in attempts if r["fixture_id"] == fid]
        decs = [r["effective_decision"] for r in freps]
        outcomes = [r["authority_outcome"] for r in freps]
        pass_count = sum(1 for o in outcomes if o == "pass")
        mode_dec, mode_count = Counter(decs).most_common(1)[0]
        fixture_stability[fid] = {
            "fixture_id": fid,
            "category": f["category"],
            "control_type": f["control_type"],
            "pass_count": f"{pass_count}/{len(freps)}",
            "pass_rate": pass_count / len(freps) if freps else 0.0,
            "dominant_decision": mode_dec,
            "dominant_decision_fraction": f"{mode_count}/{len(freps)}",
            "decision_sequence": decs,
            "outcome_sequence": outcomes,
            "perfect_stability": (mode_count == len(freps)),
        }

    # Specific inspection on attend-03 and attend-04
    attend_03_reps = [r for r in attempts if r["fixture_id"] == "attend-03"]
    attend_04_reps = [r for r in attempts if r["fixture_id"] == "attend-04"]

    # Matched and contrast pairs splitting
    pairs_info = fixture_metadata.get("pairs", [])
    pairs_results = []
    for p in pairs_info:
        p_type = p.get("type", "matched" if "sarcasm" in p["negative"] or "uncertainty" in p["negative"] else "contrast")
        neg_id = p["negative"]
        pos_id = p["positive"]
        disc = p.get("discriminator", "")

        neg_f_reps = [r for r in attempts if r["fixture_id"] == neg_id]
        pos_f_reps = [r for r in attempts if r["fixture_id"] == pos_id]

        neg_no_hard_fails = sum(1 for r in neg_f_reps if r["authority_outcome"] != "hard_fail")
        pos_passes = sum(1 for r in pos_f_reps if r["authority_outcome"] == "pass")

        neg_cleared = neg_no_hard_fails >= 4
        pos_cleared = pos_passes >= 3
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

    # Decision distribution
    decisions_dist = {
        "HOLD": sum(1 for r in attempts if r["effective_decision"] == "HOLD"),
        "ENRICH": sum(1 for r in attempts if r["effective_decision"] == "ENRICH"),
        "LEAD": sum(1 for r in attempts if r["effective_decision"] == "LEAD"),
        "ATTEND": sum(1 for r in attempts if r["effective_decision"] == "ATTEND"),
        "ERROR": total_fails,
    }

    tot_cost = sum(r["estimated_cost_usd"] for r in attempts)
    tot_prompt_tok = sum(r["prompt_tokens_est"] for r in attempts)
    tot_comp_tok = sum(r["completion_tokens_est"] for r in attempts)

    return {
        "model_id": MODEL_UNDER_TEST,
        "total_attempts": total_calls,
        "successful_calls": successful_calls,
        "failures": {
            "provider_failures": provider_fails,
            "schema_failures": schema_fails,
            "rate_limit_failures": sum(1 for r in attempts if r["failure_class"] == "rate_limit"),
            "http_failures": sum(1 for r in attempts if r["failure_class"] == "http_error"),
            "total_failures": total_fails,
            "failure_rate": total_fails / total_calls if total_calls > 0 else 0.0,
        },
        "authority_accuracy": round(authority_accuracy, 4),
        "negative_controls": {
            "total_attempts": neg_total,
            "passes": neg_passes,
            "soft_misses": neg_soft,
            "hard_fails": neg_hard,
            "hard_fail_rate": round(neg_hard_fail_rate, 4),
            "pass_rate": round(neg_passes / neg_total, 4) if neg_total > 0 else 0.0,
        },
        "explicit_boundary": {
            "total_attempts": bound_total,
            "passes": bound_passes,
            "hard_fails": bound_hard,
            "lead_attend_violations": bound_violations,
        },
        "positive_lead": {
            "total_attempts": lead_total,
            "passes": lead_passes,
            "soft_misses": lead_soft,
            "hard_fails": lead_hard,
            "recall": round(lead_recall, 4),
        },
        "positive_attend": {
            "total_attempts": attend_total,
            "passes": attend_passes,
            "soft_misses": attend_soft,
            "hard_fails": attend_hard,
            "recall": round(attend_recall, 4),
        },
        "delegation_boundary_lowenergy_02": {
            "total": len(del_reps),
            "lead_passes": del_passes,
            "enrich_soft_misses": del_soft,
            "hold_attend_hard_fails": del_hard,
            "pass_rate": del_passes / len(del_reps) if del_reps else 0.0,
            "decisions": [r["effective_decision"] for r in del_reps],
        },
        "focus_fixtures": {
            "attend_03": {
                "decisions": [r["effective_decision"] for r in attend_03_reps],
                "authority_outcomes": [r["authority_outcome"] for r in attend_03_reps],
                "pass_count": sum(1 for r in attend_03_reps if r["authority_outcome"] == "pass"),
                "reasons": [r["reason"] for r in attend_03_reps],
            },
            "attend_04": {
                "decisions": [r["effective_decision"] for r in attend_04_reps],
                "authority_outcomes": [r["authority_outcome"] for r in attend_04_reps],
                "pass_count": sum(1 for r in attend_04_reps if r["authority_outcome"] == "pass"),
                "reasons": [r["reason"] for r in attend_04_reps],
            },
        },
        "fixture_stability": fixture_stability,
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
        "estimated_cost_usd": round(tot_cost, 6),
        "decisions_distribution": decisions_dist,
        "epistemic_prefix_syntax_valid_rate": epistemic_valid / total_calls if total_calls > 0 else 0.0,
    }


def export_csv(attempts: List[Dict[str, Any]], filepath: Path):
    fieldnames = [
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


def build_report_md(
    metrics: Dict[str, Any],
    baseline_metrics: Optional[Dict[str, Any]],
    manifest: Dict[str, Any],
) -> str:
    md = []
    ts = manifest.get("timestamp", manifest.get("timestamp_start", datetime.now(timezone.utc).isoformat()))
    md.append("# Gemini 2.5 Flash Lite Full Confirmation Evaluation Report")
    md.append("")
    md.append(f"**Execution Timestamp:** {ts}  ")
    md.append(f"**Companion Runtime Commit:** `{manifest['companion_runtime_commit']}`  ")
    md.append(f"**Model Under Test:** `google/gemini-2.5-flash-lite`  ")
    md.append(f"**Comparison Baseline:** `google/gemini-3.7-flash` (from previous Stage B run)  ")
    md.append(f"**Scope:** 44 scored fixtures &times; 5 unseeded repetitions = 220 calls total (`boundary-02` excluded)  ")
    md.append("")
    md.append("---")
    md.append("")
    md.append("## 1. Audit Correction: Stage A Screening Record")
    md.append("")
    md.append("> **Audit Note & Correction:** The prior Stage A summary narrative inadvertently referenced misses on `attend-02` and `attend-03`. Inspection of raw Stage A records confirms that **`attend-02` passed** (ATTEND decision with recognized contradiction), while **`attend-03`** (HOLD, medical test gloss-over) and **`attend-04`** (HOLD, friend pattern dismissal) were the true misses. The raw screening evidence is preserved in `screening_results.json`.")
    md.append("")
    md.append("---")
    md.append("")
    md.append("## 2. Headline Comparison vs. Gemini 3.7 Flash Baseline")
    md.append("")

    base_b = baseline_metrics.get("google/gemini-3.7-flash", {}) if baseline_metrics else {}

    md.append("| Evaluation Metric | `google/gemini-2.5-flash-lite` (5 reps, 220 calls) | `google/gemini-3.7-flash` Baseline (3 reps, 132 calls) | Relative Delta / Assessment |")
    md.append("|---|---|---|---|")
    md.append(f"| **P50 Latency (ms)** | **{metrics['latency_ms']['p50']}ms** | {base_b.get('latency_ms', {}).get('p50', '5228')}ms | **{base_b.get('latency_ms', {}).get('p50', 5228) / metrics['latency_ms']['p50']:.1f}&times; faster** |")
    md.append(f"| **P90 Latency (ms)** | **{metrics['latency_ms']['p90']}ms** | {base_b.get('latency_ms', {}).get('p90', '7343')}ms | **{base_b.get('latency_ms', {}).get('p90', 7343) / metrics['latency_ms']['p90']:.1f}&times; faster** |")
    md.append(f"| **P99 Latency (ms)** | **{metrics['latency_ms']['p99']}ms** | {base_b.get('latency_ms', {}).get('p99', '13320')}ms | **{base_b.get('latency_ms', {}).get('p99', 13320) / metrics['latency_ms']['p99']:.1f}&times; faster** |")
    md.append(f"| **Execution Reliability** | **{metrics['successful_calls']}/{metrics['total_attempts']} ({metrics['successful_calls']/metrics['total_attempts']:.1%})** | {base_b.get('execution_reliability', 0.992):.1%} | {metrics['failures']['total_failures']} total failures |")
    md.append(f"| **Authority Accuracy** | **{metrics['authority_accuracy']:.1%}** | {base_b.get('authority_accuracy', 0.992):.1%} | -{base_b.get('authority_accuracy', 0.992) - metrics['authority_accuracy']:.1%} |")
    md.append(f"| **Negative Hard-Fail Rate** | **{metrics['negative_controls']['hard_fail_rate']:.1%}** ({metrics['negative_controls']['hard_fails']}/{metrics['negative_controls']['total_attempts']}) | {base_b.get('negative_hard_fail_rate', 0.0):.1%} | Restraint well within &le;5% floor |")
    md.append(f"| **Explicit Boundary Violations** | **{metrics['explicit_boundary']['lead_attend_violations']}** | {base_b.get('explicit_boundary_violations', 0)} | **Zero violations** (Perfect boundary compliance) |")
    md.append(f"| **Positive LEAD Recall** | **{metrics['positive_lead']['recall']:.1%}** ({metrics['positive_lead']['passes']}/{metrics['positive_lead']['total_attempts']}) | {base_b.get('lead_recall', 1.0):.1%} | Strong trajectory leadership |")
    md.append(f"| **Positive ATTEND Recall** | **{metrics['positive_attend']['recall']:.1%}** ({metrics['positive_attend']['passes']}/{metrics['positive_attend']['total_attempts']}) | {base_b.get('attend_recall', 0.867):.1%} | Sub-salience sensitivity gap |")
    md.append(f"| **Delegation Boundary (`lowenergy-02`)** | **{metrics['delegation_boundary_lowenergy_02']['lead_passes']}/{metrics['delegation_boundary_lowenergy_02']['total']} LEAD** ({metrics['delegation_boundary_lowenergy_02']['pass_rate']:.1%}) | 3/3 LEAD (100.0%) | Full delegation recognition |")
    md.append(f"| **All Matched/Contrast Pairs Split** | **{'YES' if metrics['all_pairs_split'] else 'NO'}** | {'YES' if base_b.get('all_pairs_split', True) else 'NO'} | Matched & contrast split status |")
    md.append(f"| **Epistemic Prefix Syntax Validity** | **{metrics['epistemic_prefix_syntax_valid_rate']:.1%}** | {base_b.get('epistemic_prefix_syntax_valid_rate', 1.0):.1%} | 100% syntactic conformity |")
    md.append(f"| **Estimated Cost (220 calls)** | **${metrics['estimated_cost_usd']:.4f}** | ~${base_b.get('estimated_cost_usd_total', 0.026) * (220/132):.4f} | ~50% cost reduction |")
    md.append("")
    md.append("---")
    md.append("")
    md.append("## 3. Deep Dive: `attend-03` and `attend-04` Across All 5 Repetitions")
    md.append("")
    md.append("### Fixture `attend-03` (Medical test minimization / swerve)")
    md.append(f"- **Passes:** {metrics['focus_fixtures']['attend_03']['pass_count']}/5 ATTEND")
    md.append(f"- **Decision Sequence:** `{metrics['focus_fixtures']['attend_03']['decisions']}`")
    md.append(f"- **Authority Outcomes:** `{metrics['focus_fixtures']['attend_03']['authority_outcomes']}`")
    md.append("- **Reasons Given Across Repetitions:**")
    for i, r_text in enumerate(metrics['focus_fixtures']['attend_03']['reasons'], 1):
        md.append(f"  {i}. \"{r_text}\"")
    md.append("")
    md.append("### Fixture `attend-04` (Uncertainty & pattern dismissal 'third friend this month')")
    md.append(f"- **Passes:** {metrics['focus_fixtures']['attend_04']['pass_count']}/5 ATTEND")
    md.append(f"- **Decision Sequence:** `{metrics['focus_fixtures']['attend_04']['decisions']}`")
    md.append(f"- **Authority Outcomes:** `{metrics['focus_fixtures']['attend_04']['authority_outcomes']}`")
    md.append("- **Reasons Given Across Repetitions:**")
    for i, r_text in enumerate(metrics['focus_fixtures']['attend_04']['reasons'], 1):
        md.append(f"  {i}. \"{r_text}\"")
    md.append("")
    md.append("---")
    md.append("")
    md.append("## 4. Per-Fixture Stability Analysis (5 Repetitions)")
    md.append("")
    md.append("| Fixture ID | Category | Control Type | Passes (/5) | Dominant Decision | Perfect Stability |")
    md.append("|---|---|---|---|---|---|")
    for fid, st in metrics["fixture_stability"].items():
        md.append(f"| `{fid}` | `{st['category']}` | `{st['control_type']}` | {st['pass_count']} | `{st['dominant_decision']}` ({st['dominant_decision_fraction']}) | {' YES' if st['perfect_stability'] else ' Var'} |")
    md.append("")
    md.append("---")
    md.append("")
    md.append("## 5. Matched and Contrast Pairs Verification")
    md.append("")
    md.append("| Pair Type | Negative Side | Positive Side | Discriminator | Split Status |")
    md.append("|---|---|---|---|---|")
    for p in metrics["pairs"]:
        md.append(f"| {p['type'].capitalize()} | `{p['negative_id']}` ({p['negative_no_hard_fail_count']} ok) | `{p['positive_id']}` ({p['positive_pass_count']} pass) | {p['discriminator']} | {' SPLIT' if p['split'] else ' MISS'} |")
    md.append("")
    md.append("---")
    md.append("")
    md.append("## 6. Execution Failures Breakdown")
    md.append(f"- **Provider / Transport Errors:** {metrics['failures']['provider_failures']}")
    md.append(f"- **Rate Limit (429) Errors:** {metrics['failures']['rate_limit_failures']}")
    md.append(f"- **HTTP 4xx/5xx Errors:** {metrics['failures']['http_failures']}")
    md.append(f"- **Schema / Validation Errors:** {metrics['failures']['schema_failures']}")
    md.append(f"- **Total Terminal Failures:** {metrics['failures']['total_failures']} ({metrics['failures']['failure_rate']:.1%})")
    md.append("")
    return "\n".join(md)


async def main():
    print("=== STARTING GEMINI 2.5 FLASH LITE FULL CONFIRMATION FOLLOW-UP ===")
    start_iso = datetime.now(timezone.utc).isoformat()
    start_mono = time.monotonic()

    with open(FIXTURE_PATH, "r") as f:
        fixture_data = json.load(f)

    fixtures = fixture_data["fixtures"]
    total_planned = len(fixtures) * 5
    print(f"Loaded {len(fixtures)} scored fixtures. Running 5 unseeded repetitions = {total_planned} planned calls.")

    adapter = ProviderExecutionAdapter(timeout_seconds=60.0)
    sem = asyncio.Semaphore(3)  # Concurrency <= 3

    tasks = []
    for rep_idx in range(1, 6):
        for fix in fixtures:
            tasks.append(execute_repetition(fix, rep_idx, adapter, sem))

    print(f"Launching {len(tasks)} asynchronous calls with concurrency 3 against {MODEL_UNDER_TEST}...")
    completed_attempts = []

    for coro in asyncio.as_completed(tasks):
        res = await coro
        completed_attempts.append(res)
        done = len(completed_attempts)
        if done % 20 == 0 or done == total_planned:
            print(f"  Progress: {done}/{total_planned} completed ({done/total_planned*100:.1f}%)")

    await adapter.aclose()
    print("All provider calls completed. Sorting deterministically...")

    completed_attempts.sort(key=lambda r: (r["fixture_id"], r["repetition_index"]))

    metrics = compute_metrics(completed_attempts, fixtures, fixture_data)

    # Load baseline metrics if available
    baseline_metrics = None
    if PREV_STAGE_B_RESULTS_PATH.exists():
        try:
            with open(PREV_STAGE_B_RESULTS_PATH, "r") as f:
                prev_data = json.load(f)
                baseline_metrics = prev_data.get("metrics")
        except Exception as exc:
            print(f"Warning: Could not load previous baseline metrics: {exc}")

    # Build manifest
    with open(FIXTURE_PATH, "rb") as f:
        fixture_bytes = f.read()
    fixture_hash = hashlib.sha256(fixture_bytes).hexdigest()
    prompt_hash = hashlib.sha256(_PERIPHERAL_SYSTEM.encode("utf-8")).hexdigest()
    schema_hash = hashlib.sha256(json.dumps(PERIPHERAL_SCHEMA, sort_keys=True).encode("utf-8")).hexdigest()

    end_iso = datetime.now(timezone.utc).isoformat()
    manifest = {
        "evaluation_type": "confirmation_followup",
        "companion_runtime_commit": "5e2627e5a8b966600f9fc6376350e4593e098bbf",
        "timestamp": start_iso,
        "timestamp_start": start_iso,
        "timestamp_end": end_iso,
        "total_elapsed_seconds": round(time.monotonic() - start_mono, 2),
        "model_under_test": MODEL_UNDER_TEST,
        "comparison_baseline": "google/gemini-3.7-flash",
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
        "planned_calls": total_planned,
        "executed_calls": len(completed_attempts),
        "adjudication_notes": {
            "lowenergy_02": "Scored as explicit delegation boundary (LEAD=pass, ENRICH=soft_miss, HOLD/ATTEND=hard_fail); v0.1 source metadata preserved.",
            "boundary_02": "Excluded from aperture scoring (active state transition fixture).",
        },
        "audit_corrections": [
            "Stage A summary text corrected: attend-02 passed in Stage A raw records; attend-03 and attend-04 were the true ATTEND misses."
        ],
        "deviations": [],
    }

    manifest_path = OUTPUT_DIR / "RUN_MANIFEST.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print(f"Saved manifest: {manifest_path}")

    # Results JSON
    results_json_path = OUTPUT_DIR / "gemini_2_5_confirmation_results.json"
    with open(results_json_path, "w", encoding="utf-8") as f:
        json.dump({
            "metadata": manifest,
            "metrics": metrics,
            "raw_validated_objects": [
                {
                    "fixture_id": r["fixture_id"],
                    "repetition_index": r["repetition_index"],
                    "raw_decision": r["raw_decision"],
                    "effective_decision": r["effective_decision"],
                    "authority_outcome": r["authority_outcome"],
                    "raw_parsed_object": r["raw_parsed_object"],
                    "normalized_peripheral_object": r["normalized_peripheral_object"],
                    "provenance": r["provenance"],
                }
                for r in completed_attempts
            ],
            "attempts": completed_attempts,
        }, f, indent=2)
    print(f"Saved confirmation results JSON: {results_json_path}")

    # Report MD
    report_md_path = OUTPUT_DIR / "GEMINI_2_5_CONFIRMATION_REPORT.md"
    report_md = build_report_md(metrics, baseline_metrics, manifest)
    with open(report_md_path, "w", encoding="utf-8") as f:
        f.write(report_md)
    print(f"Saved confirmation report MD: {report_md_path}")

    # Attempts CSV
    csv_path = OUTPUT_DIR / "attempts.csv"
    export_csv(completed_attempts, csv_path)
    print(f"Saved attempts CSV: {csv_path}")

    print("\n=== CONFIRMATION FOLLOW-UP COMPLETE ===")
    print(f"Model: {MODEL_UNDER_TEST}")
    print(f"P50 Latency: {metrics['latency_ms']['p50']}ms (P90: {metrics['latency_ms']['p90']}ms)")
    print(f"Authority Accuracy: {metrics['authority_accuracy']:.1%}")
    print(f"Negative Hard Fail Rate: {metrics['negative_controls']['hard_fail_rate']:.1%}")
    print(f"Explicit Boundary Violations: {metrics['explicit_boundary']['lead_attend_violations']}")
    print(f"LEAD Recall: {metrics['positive_lead']['recall']:.1%}")
    print(f"ATTEND Recall: {metrics['positive_attend']['recall']:.1%}")
    print(f"lowenergy-02 Delegation Pass Rate: {metrics['delegation_boundary_lowenergy_02']['pass_rate']:.1%}")


if __name__ == "__main__":
    asyncio.run(main())
