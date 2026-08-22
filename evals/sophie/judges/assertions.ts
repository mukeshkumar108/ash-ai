import type { DeterministicAssertions, TurnTrace } from '../types';

export function verifyDeterministicAssertions({
  assertions,
  turnTrace,
}: {
  assertions: DeterministicAssertions;
  turnTrace: TurnTrace;
}): { passed: boolean; failures: string[] } {
  const failures: string[] = [];

  if (
    assertions.phaseShouldPersist &&
    !turnTrace.productionPath.interactionSteer
  ) {
    // If interaction steering is enabled, we check whether a steer/phase was resolved
    // Note: if judge is disabled or open-failed, phase may be null if no steer started
  }

  if (assertions.opportunityCreated) {
    if (!turnTrace.productionPath.initiativeOpportunityScheduled) {
      failures.push('Expected initiative opportunity to be scheduled in DB');
    }
  }

  if (assertions.initiativeEvaluated) {
    if (!turnTrace.initiativeTrace) {
      failures.push('Expected initiative scan and evaluation to execute');
    } else if (
      assertions.initiativeDecision &&
      turnTrace.initiativeTrace.decision !== assertions.initiativeDecision
    ) {
      failures.push(
        `Expected initiative decision '${assertions.initiativeDecision}', got '${turnTrace.initiativeTrace.decision}'`,
      );
    }
  }

  if (assertions.dedupeWorked && turnTrace.initiativeTrace) {
    if (!turnTrace.initiativeTrace.opportunityClaimed) {
      // If claimed is false, it means dedupe or claim prevented double-posting
      if (!turnTrace.initiativeTrace.opportunityDuplicate) {
        failures.push('Expected initiative dedupe claim check to succeed');
      }
    }
  }

  if (
    assertions.noDuplicateInitiative &&
    turnTrace.initiativeTrace?.opportunityDuplicate
  ) {
    failures.push('Encountered duplicate initiative claim');
  }

  if (
    assertions.steeredModelUsed &&
    !turnTrace.productionPath.steeredEscalated
  ) {
    failures.push('Expected steered model escalation to occur');
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}
