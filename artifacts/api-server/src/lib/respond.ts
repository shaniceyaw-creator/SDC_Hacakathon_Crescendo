import type { Request, Response } from "express";
import { planner, PlanningError, type Operation } from "./eventops-v2";
import { actorOf } from "./session";

type Schema = { parse(input: unknown): unknown };

/** Call the planner as the signed-in account and validate the reply against the API contract. */
export async function respond(req: Request, res: Response, op: Operation, payload: Record<string, unknown>, schema: Schema, timeoutMs?: number) {
  try {
    const result = await planner(op, { ...payload, actor: actorOf(req.account!) }, timeoutMs);
    res.json(schema.parse(result));
  } catch (error) {
    sendError(req, res, error, op);
  }
}

export function sendError(req: Request, res: Response, error: unknown, op: string) {
  if (error instanceof PlanningError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  req.log.error({ op, err: error instanceof Error ? error.message.slice(0, 300) : "unknown" }, "Planner reply failed validation");
  res.status(503).json({ error: "The planning service returned unexpected data. Please retry." });
}

/** Turn a zod error into one short sentence for the form. */
export function badInput(res: Response, issues: { path: (string | number)[]; message: string }[]) {
  const first = issues[0];
  const field = first?.path.filter((p) => typeof p === "string").pop();
  res.status(400).json({ error: field ? `Check the ${String(field).replace(/_/g, " ")}.` : "Check the form and try again." });
}
