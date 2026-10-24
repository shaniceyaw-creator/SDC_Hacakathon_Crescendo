import { Router, type IRouter } from "express";
import { ListAccountsResponse, LoginBody, LoginResponse, GetMeResponse, ResetDemoResponse, GetOptionsResponse } from "@workspace/api-zod";
import { allAccounts, findAccount, cookieOptions, COOKIE, requireRole } from "../../lib/session";
import { respond, sendError } from "../../lib/respond";

const router: IRouter = Router();

router.get("/auth/accounts", async (req, res): Promise<void> => {
  try {
    res.json(ListAccountsResponse.parse(await allAccounts()));
  } catch (error) {
    sendError(req, res, error, "accounts");
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const body = LoginBody.safeParse(req.body);
  const account = body.success ? await findAccount(body.data.accountId).catch(() => null) : null;
  if (!account) {
    res.status(400).json({ error: "Choose one of the demo accounts." });
    return;
  }
  res.cookie(COOKIE, account.id, cookieOptions);
  res.json(LoginResponse.parse(account));
});

router.get("/auth/me", requireRole(), (req, res): void => {
  res.json(GetMeResponse.parse(req.account));
});

router.post("/auth/logout", (_req, res): void => {
  res.clearCookie(COOKIE, { ...cookieOptions, maxAge: undefined });
  res.json({ ok: true });
});

router.post("/demo/reset", requireRole(), async (req, res): Promise<void> => {
  await respond(req, res, "reset", {}, ResetDemoResponse, 120000);
});

router.get("/options", requireRole(), async (req, res): Promise<void> => {
  await respond(req, res, "options", {}, GetOptionsResponse);
});

export default router;
