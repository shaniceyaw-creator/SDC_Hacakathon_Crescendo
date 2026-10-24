import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { logger } from "./logger";

// One long-running Python process keeps the trained model and company data in memory,
// so pages load in milliseconds instead of re-importing scikit-learn on every request.
// Requests are written one JSON line at a time; Python answers in the same order.

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
const bridgeScript = path.join(workspaceRoot, "scripts/eventops_v2_bridge.py");
const MAX_WAITING = 30;

export class PlanningError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export type Actor = { id: string; role: "manager" | "worker" | "customer"; name: string; staff_id?: string };

export type Operation =
  | "accounts" | "login" | "options" | "manager-dashboard" | "estimate" | "create-event" | "get-event"
  | "update-event" | "decide-event" | "calendar" | "insights" | "team" | "leave-sync" | "worker-home"
  | "take-task" | "customer-home" | "public-events" | "assistant-context" | "reset" | "warm"
  | "list-bookings" | "booking-progress" | "update-progress" | "save-staffing" | "receipt";

type Waiting = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

let child: ChildProcessWithoutNullStreams | null = null;
let nextId = 1;
const waiting = new Map<number, Waiting>();

function failAll(message: string) {
  for (const [id, w] of waiting) {
    clearTimeout(w.timer);
    w.reject(new PlanningError(message, 503));
    waiting.delete(id);
  }
}

function start(): ChildProcessWithoutNullStreams {
  const proc = spawn("python", ["-u", bridgeScript, "--serve"], { cwd: workspaceRoot, stdio: ["pipe", "pipe", "pipe"] });
  readline.createInterface({ input: proc.stdout }).on("line", (line) => {
    let reply: { id?: number; ok: boolean; result?: unknown; error?: string; status?: number };
    try {
      reply = JSON.parse(line);
    } catch {
      logger.warn("EventOps planner printed an unreadable line");
      return;
    }
    const w = reply.id != null ? waiting.get(reply.id) : undefined;
    if (!w) return;
    waiting.delete(reply.id!);
    clearTimeout(w.timer);
    if (reply.ok) w.resolve(reply.result);
    else w.reject(new PlanningError(
      reply.error || "The planner could not complete this request.",
      [400, 403, 404, 409, 503].includes(reply.status ?? 0) ? reply.status! : 503,
    ));
  });
  readline.createInterface({ input: proc.stderr }).on("line", (line) => {
    logger.warn({ planner: line.slice(0, 500) }, "EventOps planner message");
  });
  proc.on("exit", (code) => {
    if (child === proc) child = null;
    logger.warn({ code }, "EventOps planner stopped; it restarts on the next request");
    failAll("The planning service restarted. Please retry.");
  });
  proc.stdin.on("error", () => {
    // The exit handler reports the failure.
  });
  return proc;
}

export function planner(operation: Operation, payload: Record<string, unknown> = {}, timeoutMs = 30000): Promise<unknown> {
  if (waiting.size >= MAX_WAITING) {
    return Promise.reject(new PlanningError("The planner is busy. Please retry in a moment.", 503));
  }
  if (!child) child = start();
  const proc = child;
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new PlanningError("The planning service took too long. Please retry.", 503));
      // Replies are ordered, so a stuck request would block the rest: restart the process.
      proc.kill();
    }, timeoutMs);
    waiting.set(id, { resolve, reject, timer });
    proc.stdin.write(JSON.stringify({ id, op: operation, payload }) + "\n");
  });
}

/** Warm the model and data so the first page view is fast. */
export function warmPlanner() {
  planner("warm", {}, 60000).catch(() => undefined);
}
