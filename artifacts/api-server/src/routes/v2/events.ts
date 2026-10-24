import { Router, type IRouter } from "express";
import {
  CreateEventBody, CreateEventResponse, GetEventParams, GetEventResponse, UpdateEventParams, UpdateEventBody,
  UpdateEventResponse, DecideEventParams, DecideEventBody, DecideEventResponse, GetCalendarQueryParams, GetCalendarResponse,
} from "@workspace/api-zod";
import { requireRole } from "../../lib/session";
import { respond, badInput } from "../../lib/respond";

const router: IRouter = Router();

router.post("/events", requireRole("manager", "customer"), async (req, res): Promise<void> => {
  const body = CreateEventBody.safeParse(req.body);
  if (!body.success) return badInput(res, body.error.issues);
  await respond(req, res, "create-event", body.data, CreateEventResponse);
});

router.get("/events/:eventId", requireRole("manager"), async (req, res): Promise<void> => {
  const params = GetEventParams.safeParse(req.params);
  if (!params.success) return badInput(res, params.error.issues);
  await respond(req, res, "get-event", { id: params.data.eventId }, GetEventResponse);
});

router.patch("/events/:eventId", requireRole("manager"), async (req, res): Promise<void> => {
  const params = UpdateEventParams.safeParse(req.params);
  const body = UpdateEventBody.safeParse(req.body);
  if (!params.success) return badInput(res, params.error.issues);
  if (!body.success) return badInput(res, body.error.issues);
  // Only pass crew / price when the browser sent them, so "not sent" differs from "reset to model".
  const payload: Record<string, unknown> = { id: params.data.eventId, expected_version: body.data.expected_version };
  if (body.data.event) payload.event = body.data.event;
  if ("crew" in req.body) payload.crew = body.data.crew ?? null;
  if ("price_rm" in req.body) payload.price_rm = body.data.price_rm ?? null;
  await respond(req, res, "update-event", payload, UpdateEventResponse);
});

router.post("/events/:eventId/decision", requireRole("manager"), async (req, res): Promise<void> => {
  const params = DecideEventParams.safeParse(req.params);
  const body = DecideEventBody.safeParse(req.body);
  if (!params.success) return badInput(res, params.error.issues);
  if (!body.success) return badInput(res, body.error.issues);
  await respond(req, res, "decide-event", { id: params.data.eventId, ...body.data }, DecideEventResponse);
});

router.get("/calendar", requireRole("manager", "worker"), async (req, res): Promise<void> => {
  const query = GetCalendarQueryParams.safeParse(req.query);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!query.success || !iso.test(query.data.from) || !iso.test(query.data.to)) {
    res.status(400).json({ error: "Choose a valid date range." });
    return;
  }
  await respond(req, res, "calendar", query.data, GetCalendarResponse);
});

export default router;
