import { cookies } from "next/headers";
import { z } from "zod";
import { checkAccessToken, issueSession, SESSION_COOKIE, verifySession } from "@/server/auth";
import { handle, json } from "@/server/http";
import { HttpError } from "@/server/workflows";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const c = await cookies();
  return json({ authenticated: Boolean(verifySession(c.get(SESSION_COOKIE)?.value)) });
});

export const POST = handle(async (req: Request) => {
  const { token } = z.object({ token: z.string().min(1).max(200) }).parse(await req.json());
  if (!checkAccessToken(token)) throw new HttpError(401, "invalid operator access token");
  const s = issueSession("operator");
  const c = await cookies();
  c.set(SESSION_COOKIE, s.value, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    path: "/",
    maxAge: s.maxAge,
  });
  return json({ authenticated: true });
});

export const DELETE = handle(async () => {
  (await cookies()).delete(SESSION_COOKIE);
  return json({ authenticated: false });
});
