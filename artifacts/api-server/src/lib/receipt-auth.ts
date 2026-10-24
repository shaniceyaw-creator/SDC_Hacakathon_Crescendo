/** Replit OIDC identity check for file access, separate from demo role selection. */
import { createHash, randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import * as oidc from "openid-client";
import { RECEIPT_AUTH_PATH, receiptReturnPath } from "./public-paths";

const COOKIE = "opus_verified_uploader";
const options = { httpOnly: true, secure: true, sameSite: "none" as const, signed: true, path: "/" };
let config: Promise<oidc.Configuration> | undefined;
const oidcConfig = () => config ??= oidc.discovery(new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"), process.env.REPL_ID!);
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const keyOf = (v: string) => `receipt-session:${hash(v)}`;
function origin(req: Request) {
  const host = String(req.get("x-forwarded-host") || req.get("host") || "");
  if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) throw new Error("Invalid host.");
  return `https://${host}`;
}

export async function requireReceiptIdentity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sid = req.signedCookies?.[COOKIE];
    if (typeof sid === "string" && /^[a-f0-9]{64}$/.test(sid)) {
      const result = await pool.query("SELECT value FROM eo2_meta WHERE key=$1", [keyOf(sid)]);
      if (result.rows[0]?.value?.expires > Date.now()) { next(); return; }
    }
    res.status(401).json({ error: "Sign in with Replit in the receipt section before uploading or opening demo receipts.", code: "RECEIPT_SIGN_IN" });
  } catch {
    req.log.warn("Receipt identity lookup failed");
    res.status(503).json({ error: "Receipt sign-in is temporarily unavailable." });
  }
}

export const receiptAuthRouter: IRouter = Router();
receiptAuthRouter.get("/receipt-auth/start", async (req, res): Promise<void> => {
  try {
    const cfg = await oidcConfig();
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const callback = `${origin(req)}${RECEIPT_AUTH_PATH}/callback`;
    // The signed, HttpOnly cookie binds the PKCE/state/nonce to this browser.
    res.cookie("opus_oidc", JSON.stringify({ verifier, state, nonce, callback, returnTo: receiptReturnPath(req.query.returnTo) }),
      { ...options, sameSite: "lax", maxAge: 600_000 });
    const url = oidc.buildAuthorizationUrl(cfg, {
      redirect_uri: callback, scope: "openid profile", state, nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256",
    });
    res.redirect(url.href);
  } catch {
    config = undefined;
    req.log.warn("Receipt OIDC discovery failed");
    res.status(503).send("Receipt sign-in is unavailable. Return to the booking and try again.");
  }
});
receiptAuthRouter.get("/receipt-auth/callback", async (req, res): Promise<void> => {
  const flowCookie = req.signedCookies?.opus_oidc;
  res.clearCookie("opus_oidc", options);
  try {
    if (typeof flowCookie !== "string") throw new Error("Missing sign-in flow.");
    const flow = JSON.parse(flowCookie);
    const tokens = await oidc.authorizationCodeGrant(await oidcConfig(),
      new URL(`${flow.callback}?${new URL(req.originalUrl, origin(req)).searchParams}`),
      { pkceCodeVerifier: flow.verifier, expectedState: flow.state, expectedNonce: flow.nonce, idTokenExpected: true });
    const sub = tokens.claims()?.sub;
    if (!sub) throw new Error("Missing identity.");
    const sid = randomBytes(32).toString("hex");
    // No OIDC access/refresh tokens or profile details need to be retained.
    const expires = Date.now() + 86_400_000;
    await pool.query("INSERT INTO eo2_meta (key,value) VALUES ($1,$2)", [keyOf(sid), JSON.stringify({ sub, expires })]);
    await pool.query("DELETE FROM eo2_meta WHERE key LIKE 'receipt-session:%' AND (value->>'expires')::numeric < $1", [Date.now()]);
    res.cookie(COOKIE, sid, { ...options, maxAge: 86_400_000 });
    res.redirect(receiptReturnPath(flow.returnTo));
  } catch {
    req.log.warn("Receipt OIDC verification failed");
    res.status(400).send("Receipt sign-in could not be verified. Return to your booking and choose Sign in with Replit again.");
  }
});
