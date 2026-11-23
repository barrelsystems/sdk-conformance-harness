import { wireIdentity } from "../scenarios/wireIdentity.js";
import type { Scenario } from "./scenario.js";
import { cadenceResilienceScenarios } from "../scenarios/cadenceResilience.js";
import { failOpenScenarios } from "../scenarios/failOpen.js";
import { bufferedFactsScenarios } from "../scenarios/bufferedFacts.js";
import { happyPathCheckIn } from "../scenarios/happyPathCheckIn.js";
import { preActionCheckScenarios } from "../scenarios/preActionCheck.js";
import { updateEligibilityScenarios } from "../scenarios/updateEligibility.js";
import { resilienceScenarios } from "../scenarios/resilience.js";

/** Every scenario needing the check-in handshake (mock backend + signed
 * keypair) -- gated on `supportsCheckIn`, since a test service without it
 * can't run any of these. */
const CHECK_IN_SCENARIOS: ReadonlyArray<Scenario> = [
  happyPathCheckIn,
  wireIdentity,
  ...resilienceScenarios,
  ...failOpenScenarios,
  ...cadenceResilienceScenarios,
  ...updateEligibilityScenarios,
  ...bufferedFactsScenarios,
  ...preActionCheckScenarios,
];

export function scenariosFor(capabilities: {
  readonly supportsCheckIn: boolean;
}): ReadonlyArray<Scenario> {
  if (!capabilities.supportsCheckIn)
    throw new Error("test service does not support required check-in conformance");

  return CHECK_IN_SCENARIOS;
}
