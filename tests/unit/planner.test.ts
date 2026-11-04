import { describe, expect, it } from "vitest";
import { hasCycle, PlanValidationError, ruleBasedPlan, validatePlan, type ProposedPlan } from "../../src/server/planner";
import { BUDGET } from "./helpers";

const base = (): ProposedPlan => ruleBasedPlan("Research Monad", BUDGET);

describe("planner validation", () => {
  it("accepts the rule-based plan and assigns workers deterministically", () => {
    const plan = validatePlan(base(), BUDGET);
    expect(plan.tasks).toHaveLength(3);
    const research = plan.tasks.find((t) => t.capability === "research")!;
    expect(research.eligibleWorkers).toEqual(["worker-a"]);
    expect(research.backupWorkers).toEqual(["worker-b"]);
    expect(plan.totalEstimatedUsdc).toBeLessThanOrEqual(BUDGET.x402Usdc);
  });

  it("rejects cycles", () => {
    const p = base();
    p.tasks[0].dependencies = ["briefing"];
    expect(() => validatePlan(p, BUDGET)).toThrow(/cycle/);
    expect(hasCycle([{ taskId: "a", dependencies: ["b"] }, { taskId: "b", dependencies: ["a"] }])).toBe(true);
  });

  it("rejects unknown dependencies and duplicate ids", () => {
    const p = base();
    p.tasks[1].dependencies = ["ghost"];
    expect(() => validatePlan(p, BUDGET)).toThrow(/unknown task ghost/);
    const q = base();
    q.tasks[1].taskId = "research";
    expect(() => validatePlan(q, BUDGET)).toThrow(/duplicate taskId/);
  });

  it("rejects unsupported capabilities (schema)", () => {
    const p = base() as unknown as { tasks: { capability: string }[] };
    p.tasks[0].capability = "shell-exec";
    expect(() => validatePlan(p, BUDGET)).toThrow(PlanValidationError);
  });

  it("rejects plans whose estimated cost exceeds the budget", () => {
    const p = base();
    p.tasks[0].estimatedCostUsdc = 0.04;
    p.tasks[0].maxCostUsdc = 0.05;
    expect(() => validatePlan(p, { ...BUDGET, x402Usdc: 0.03 })).toThrow(/exceeds budget/);
  });

  it("rejects paid non-research tasks and unbounded limits", () => {
    const p = base();
    p.tasks[1].estimatedCostUsdc = 0.01;
    p.tasks[1].maxCostUsdc = 0.01;
    expect(() => validatePlan(p, BUDGET)).toThrow(/only research tasks/);
    const q = base() as unknown as { tasks: { retryLimit: number }[] };
    q.tasks[0].retryLimit = 50;
    expect(() => validatePlan(q, BUDGET)).toThrow(PlanValidationError);
  });

  it("requires synthesis to depend on every other task and a bounded task count", () => {
    const p = base();
    p.tasks[2].dependencies = [];
    expect(() => validatePlan(p, BUDGET)).toThrow(/synthesis must/);
    const many = base();
    for (let i = 0; i < 6; i++) many.tasks.push({ ...many.tasks[1], taskId: `extra-${i}` });
    expect(() => validatePlan(many, BUDGET)).toThrow(PlanValidationError);
  });
});
