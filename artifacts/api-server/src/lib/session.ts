import type { NextFunction, Request, Response, CookieOptions } from "express";
import { planner, PlanningError, type Actor } from "./eventops-v2";

// Demo sign-in: the browser holds a signed cookie with the account ID only.
// Every request looks the account up again on the server, so roles cannot be faked.

export const COOKIE = "eo2_account";

export type Account = Actor & { title: string; client_id?: string };

let accounts: Map<string, Account> | null = null;

export async function allAccounts(): Promise<{ featured: Account[]; staff: Account[] }> {
  const list = (await planner("accounts")) as { featured: Account[]; staff: Account[] };
  accounts = new Map([...list.featured, ...list.staff].map((a) => [a.id, a]));
  return list;
}

export async function findAccount(id: unknown): Promise<Account | null> {
  if (typeof id !== "string" || !id) return null;
  if (!accounts) await allAccounts();
  return accounts!.get(id) ?? null;
}

export const cookieOptions: CookieOptions = {
  httpOnly: true,
  signed: true,
  // The preview runs inside an iframe on another site, so the cookie must be allowed cross-site.
  secure: true,
  sameSite: "none",
  partitioned: true,
  maxAge: 1000 * 60 * 60 * 24 * 14,
  path: "/",
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      account?: Account;
    }
  }
}

export function actorOf(account: Account): Actor {
  return { id: account.id, role: account.role, name: account.name, ...(account.staff_id ? { staff_id: account.staff_id } : {}) };
}

/** Attach the signed-in account, then allow only the listed roles. */
export function requireRole(...roles: Account["role"][]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const account = await findAccount(req.signedCookies?.[COOKIE]);
      if (!account) {
        res.status(401).json({ error: "Please sign in." });
        return;
      }
      if (roles.length && !roles.includes(account.role)) {
        res.status(403).json({ error: "This page is not available for your account." });
        return;
      }
      req.account = account;
      next();
    } catch (error) {
      const status = error instanceof PlanningError ? error.status : 503;
      res.status(status).json({ error: "Sign-in is unavailable right now. Please retry." });
    }
  };
}
