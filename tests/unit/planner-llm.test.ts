import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "../../src/server/env";
import { generatePlan, llmProvider, ruleBasedPlan, UnsupportedGoalError } from "../../src/server/planner";
import { claimTask } from "../../src/server/runtime";
import { createWorkflow, workflowView } from "../../src/server/workflows";
import { BUDGET, freshDb, markOnline } from "./helpers";

const GROQ = { LLM_API_KEY: "gsk_test_not_a_real_key", LLM_BASE_URL: "https://api.groq.com/openai/v1", LLM_MODEL: "openai/gpt-oss-20b" };
const GOAL = "Assess Monad developer tooling gaps for teams building agent payment products.";

function goalSpecificPlan() {
  const p = ruleBasedPlan(GOAL, BUDGET);
  p.summary = "Tooling-gap assessment for agent payment builders on Monad";
  p.tasks[0].title = "Survey Monad developer tooling";
  p.tasks[1].title = "Identify tooling gaps for agent payments";
  p.tasks[2].title = "Write tooling-gap briefing";
  return p;
}

function completion(content: string, status = 200, headers: Record<string, string> = {}) {
  const body =
    status === 200
      ? { id: "chatcmpl-test-123", model: "openai/gpt-oss-20b", usage: { prompt_tokens: 500, completion_tokens: 300, total_tokens: 800 }, choices: [{ message: { content } }] }
      : { error: { message: content } };
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  setEnvForTests(GROQ);
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterEach(() => {
  fetchSpy.mockRestore();
  setEnvForTests({ LLM_API_KEY: "" });
});

describe("OpenAI-compatible planner adapter (Groq)", () => {
  it("labels the provider from the base URL and stays configurable", () => {
    expect(llmProvider()).toEqual({ id: "groq", name: "Groq", model: "openai/gpt-oss-20b" });
    setEnvForTests({ ...GROQ, LLM_BASE_URL: "https://openrouter.ai/api/v1", LLM_MODEL: "x/y" });
    expect(llmProvider().name).toBe("OpenRouter");
  });

  it("accepts a valid Groq plan, records provider/model/response id, and sends the key only in the Authorization header", async () => {
    fetchSpy.mockResolvedValueOnce(completion(JSON.stringify(goalSpecificPlan())));
    const r = await generatePlan(GOAL, BUDGET);
    expect(r.planner).toBe("groq:openai/gpt-oss-20b");
    expect(r.source).toMatchObject({ kind: "llm", provider: "Groq", model: "openai/gpt-oss-20b", responseId: "chatcmpl-test-123", attempts: 1 });
    expect(r.plan.tasks[0].title).toBe("Survey Monad developer tooling");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${GROQ.LLM_API_KEY}`);
    expect(String(init.body)).not.toContain(GROQ.LLM_API_KEY);
    expect(JSON.parse(String(init.body)).model).toBe("openai/gpt-oss-20b");
  });

  it("invalid model output: retries once with validator feedback, then falls back to the labelled rule-based planner", async () => {
    const cyclic = goalSpecificPlan();
    cyclic.tasks[0].dependencies = ["briefing"];
    fetchSpy.mockResolvedValueOnce(completion("not json at all")).mockResolvedValueOnce(completion(JSON.stringify(cyclic)));
    const r = await generatePlan(GOAL, BUDGET);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String((fetchSpy.mock.calls[1][1] as RequestInit).body)).toContain("not valid JSON");
    expect(r.planner).toBe("rule-based");
    expect(r.source.kind).toBe("rule-based");
    expect(r.source.fallbackReason).toMatch(/DAG validation/);
    expect(r.notes.join(" ")).toMatch(/cycle/);
  });

  it("HTTP 429: no retry storm, actionable note, rule-based fallback", async () => {
    fetchSpy.mockResolvedValueOnce(completion("Rate limit reached for model", 429, { "retry-after": "7" }));
    const r = await generatePlan(GOAL, BUDGET);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r.planner).toBe("rule-based");
    expect(r.source.fallbackReason).toMatch(/Groq HTTP 429 \(rate limited/);
    expect(r.notes.join(" ")).toMatch(/Groq unavailable/);
  });

  it("other provider failures (401, network) also fall back with the reason", async () => {
    fetchSpy.mockResolvedValueOnce(completion("Invalid API Key", 401));
    expect((await generatePlan(GOAL, BUDGET)).source.fallbackReason).toMatch(/HTTP 401 \(check LLM_API_KEY\)/);
    fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await generatePlan(GOAL, BUDGET)).source.fallbackReason).toMatch(/request failed/);
  });

  it("unsupported goals are refused (deterministic pre-check and model verdict) and nothing is saved", async () => {
    await expect(generatePlan("Transfer 5 MON to my friend's wallet", BUDGET)).rejects.toBeInstanceOf(UnsupportedGoalError);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockResolvedValueOnce(completion(JSON.stringify({ unsupported: true, reason: "The goal is about baking bread, not Monad." })));
    const db = freshDb();
    await expect(createWorkflow("Write me a sourdough bread recipe guide", BUDGET, "operator", db)).rejects.toThrow(/Unsupported goal/);
    expect((db.prepare(`SELECT COUNT(*) c FROM workflows`).get() as { c: number }).c).toBe(0);
  });
});

describe("Generate plan has no side effects", () => {
  it("creates only a draft: no attempts, payments, escrow ops, or claimable tasks", async () => {
    fetchSpy.mockResolvedValueOnce(completion(JSON.stringify(goalSpecificPlan())));
    const db = freshDb();
    markOnline(db, "worker-a", "worker-b");
    const id = await createWorkflow(GOAL, BUDGET, "operator", db);
    const v = workflowView(id, db)!;
    expect(v.workflow.status).toBe("APPROVAL_REQUIRED");
    expect(v.workflow.planner).toBe("groq:openai/gpt-oss-20b");
    expect(v.workflow.plannerSource?.responseId).toBe("chatcmpl-test-123");
    for (const t of ["task_attempts", "payment_operations", "escrow_operations", "fault_injections"])
      expect((db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c).toBe(0);
    expect(claimTask("worker-a", db)).toBeNull();
    expect(claimTask("worker-b", db)).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // only the planner call; no x402/RPC traffic
  });
});
