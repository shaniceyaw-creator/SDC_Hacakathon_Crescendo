import { Router, type IRouter } from "express";
import {
  GetManagerDashboardResponse, EstimateEventBody, EstimateEventResponse, GetInsightsResponse, GetTeamResponse,
  SyncLeaveResponse, AskAssistantBody,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { requireRole, actorOf } from "../../lib/session";
import { respond, badInput, sendError } from "../../lib/respond";
import { planner } from "../../lib/eventops-v2";

const router: IRouter = Router();
router.use("/manager", requireRole("manager"));

router.get("/manager/dashboard", async (req, res): Promise<void> => {
  await respond(req, res, "manager-dashboard", {}, GetManagerDashboardResponse);
});

router.post("/manager/estimate", async (req, res): Promise<void> => {
  const body = EstimateEventBody.safeParse(req.body);
  if (!body.success) return badInput(res, body.error.issues);
  await respond(req, res, "estimate", body.data, EstimateEventResponse);
});

router.get("/manager/insights", async (req, res): Promise<void> => {
  await respond(req, res, "insights", {}, GetInsightsResponse);
});

router.get("/manager/team", async (req, res): Promise<void> => {
  await respond(req, res, "team", {}, GetTeamResponse);
});

router.post("/manager/leave-sync", async (req, res): Promise<void> => {
  await respond(req, res, "leave-sync", {}, SyncLeaveResponse);
});

const GUIDE = `You are the planning assistant for a small Malaysian event company (Petaling Jaya, KL & Selangor).
You help the manager plan the season, staff and quotes. Answer in short plain sentences or a few bullets.
Use only the facts below and the conversation. If something is not in the facts, say you don't have it.
Prices are in RM. The data is synthetic demo data. You cannot approve or change bookings; suggest what the manager could do in the app.`;

router.post("/manager/assistant", async (req, res): Promise<void> => {
  const body = AskAssistantBody.safeParse(req.body);
  if (!body.success || !body.data.messages.length || body.data.messages.at(-1)!.role !== "user") {
    res.status(400).json({ error: "Type a question first." });
    return;
  }
  let facts: string;
  try {
    facts = ((await planner("assistant-context", { actor: actorOf(req.account!) })) as { facts: string }).facts;
  } catch (error) {
    sendError(req, res, error, "assistant-context");
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  try {
    const stream = await openai.chat.completions.create(
      {
        model: "gpt-5.6-terra",
        max_completion_tokens: 1500,
        stream: true,
        messages: [
          { role: "system", content: `${GUIDE}\n\nFacts:\n${facts}` },
          ...body.data.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      },
      { signal: abort.signal },
    );
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch {
    if (!abort.signal.aborted) {
      req.log.warn("Assistant reply failed");
      res.write(`data: ${JSON.stringify({ error: "The assistant is unavailable right now. Please try again." })}\n\n`);
    }
  }
  res.end();
});

export default router;
