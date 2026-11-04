import { describe, expect, it } from "vitest";
import { checkAccessToken, issueSession, verifySession } from "../../src/server/auth";
import { assertExpectedChain, ChainMismatchError } from "../../src/server/chain";
import { storeArtifact } from "../../src/server/core";
import { verifyOutput } from "../../src/server/verify";
import { activeWorkflow, freshDb } from "./helpers";

describe("chain guard", () => {
  it("rejects signing when the RPC reports a different chain", async () => {
    await expect(assertExpectedChain({ getChainId: async () => 1 })).rejects.toBeInstanceOf(ChainMismatchError);
    await expect(assertExpectedChain({ getChainId: async () => 143 })).rejects.toBeInstanceOf(ChainMismatchError);
    await expect(assertExpectedChain({ getChainId: async () => 10143 })).resolves.toBe(10143);
  });
});

describe("operator session", () => {
  it("issues verifiable sessions and rejects tampering", () => {
    const s = issueSession("operator");
    expect(verifySession(s.value)).toEqual({ sub: "operator" });
    const [sub, exp, sig] = s.value.split(".");
    expect(verifySession(`attacker.${exp}.${sig}`)).toBeNull();
    expect(verifySession(`${sub}.${Number(exp) + 1}.${sig}`)).toBeNull();
    expect(verifySession(`${sub}.${Date.now() - 1000}.x`)).toBeNull();
    expect(verifySession(undefined)).toBeNull();
  });
  it("checks the access token in constant time", () => {
    expect(checkAccessToken("test-token")).toBe(true);
    expect(checkAccessToken("wrong")).toBe(false);
  });
});

describe("output verification", () => {
  it("fails research output with uncited facts or too few sources", async () => {
    const db = freshDb();
    const wf = await activeWorkflow(db);
    const out = { sources: [{ id: "s1", url: "https://a.org" }], facts: [{ id: "F1", sourceId: "nope", claim: "x" }], dataset: { status: "BLOCKED", reason: "r" } };
    const art = storeArtifact({ workflowId: wf, kind: "t", mime: "application/json", content: JSON.stringify(out) }, db);
    const r = verifyOutput({ workflow_id: wf, task_id: "research", capability: "research", dependencies_json: "[]" }, out, art.id, db);
    expect(r.passed).toBe(false);
    expect(r.checks.find((c) => c.id === "citations")?.passed).toBe(false);
    expect(r.checks.find((c) => c.id === "sources")?.passed).toBe(false);
  });

  it("fails a synthesis whose dependencies are not completed or whose sections are missing", async () => {
    const db = freshDb();
    const wf = await activeWorkflow(db);
    const out = { markdown: "# hi\n## Executive Summary\nshort" };
    const art = storeArtifact({ workflowId: wf, kind: "t", mime: "application/json", content: JSON.stringify(out) }, db);
    const r = verifyOutput({ workflow_id: wf, task_id: "briefing", capability: "synthesis", dependencies_json: '["analysis"]' }, out, art.id, db);
    expect(r.passed).toBe(false);
    expect(r.checks.find((c) => c.id === "deps")?.passed).toBe(false);
    expect(r.checks.find((c) => c.id === "section:Sources")?.passed).toBe(false);
  });

  it("detects artifact tampering via hash", async () => {
    const db = freshDb();
    const wf = await activeWorkflow(db);
    const out = { sources: [], facts: [] };
    const art = storeArtifact({ workflowId: wf, kind: "t", mime: "application/json", content: JSON.stringify(out) }, db);
    db.prepare(`UPDATE artifacts SET content='{"tampered":true}' WHERE id=?`).run(art.id);
    const r = verifyOutput({ workflow_id: wf, task_id: "research", capability: "research", dependencies_json: "[]" }, out, art.id, db);
    expect(r.checks.find((c) => c.id === "hash")?.passed).toBe(false);
  });
});
