import type { Evidence } from "../src/evidence.js";
export function reportFixture() {
  const end = new Date(),
    start = new Date(end.getTime() - 600000);
  const evidence: Evidence[] = [
    "prometheus",
    "loki",
    "deployments",
    "calculations",
  ].map((source) => ({
    source,
    status: source === "deployments" ? "EMPTY" : "OK",
    window: {
      service: "checkout-service",
      start: start.toISOString(),
      end: end.toISOString(),
    },
    collected_at: end.toISOString(),
    locator: { kind: "synthetic-fixture" },
    data:
      source === "calculations"
        ? {
            comparisons: {
              error_ratio: {
                before_mean: 0.1,
                after_mean: 0.6,
                absolute_delta: 0.5,
              },
            },
          }
        : {},
  }));
  const report = {
    version: 1,
    mode: "deterministic",
    model_status: "DISABLED",
    model_name: null,
    ai_performed: false,
    status: "PARTIAL",
    conclusion: "HYPOTHESES_ONLY",
    hypotheses: [
      {
        rank: 1,
        category: "application",
        title: "Possible application error",
        supporting_fact_ids: ["metrics.error_after"],
        contradicting_fact_ids: [],
        uncertainty: "high",
        certainty: "hypothesis",
      },
    ],
    facts: [
      {
        id: "metrics.error_after",
        source: "calculations",
        pointer: "/data/comparisons/error_ratio/after_mean",
        value: 0.6,
      },
    ],
    limitations: [
      "CORRELATION_NOT_CAUSATION",
      "DEPLOYMENTS_EMPTY",
      "MODEL_DISABLED",
    ],
  };
  return { report, evidence };
}
