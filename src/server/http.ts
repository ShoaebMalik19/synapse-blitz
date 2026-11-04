import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { SESSION_COOKIE, verifySession } from "./auth";
import { getWorkflow, HttpError } from "./workflows";
import { UnsupportedGoalError } from "./planner";

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });

export async function requireSession() {
  const c = await cookies();
  const s = verifySession(c.get(SESSION_COOKIE)?.value);
  if (!s) throw new HttpError(401, "operator session required — sign in at /login");
  return s;
}

/** Session + ownership check for a workflow. */
export async function requireOwner(id: string) {
  const s = await requireSession();
  const wf = getWorkflow(id);
  if (!wf) throw new HttpError(404, "workflow not found");
  if (wf.owner !== s.sub) throw new HttpError(403, "not the owner of this workflow");
  return { session: s, wf };
}

export function handle<T extends unknown[]>(fn: (...args: T) => Promise<Response>) {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      if (err instanceof UnsupportedGoalError) return json({ error: err.message, code: "UNSUPPORTED_GOAL" }, 422);
      if (err instanceof ZodError)
        return json({ error: "Invalid request: " + err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
      console.error(err);
      return json({ error: (err as Error).message ?? "internal error" }, 500);
    }
  };
}
