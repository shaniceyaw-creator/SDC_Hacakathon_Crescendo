import { Router, raw, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import {
  ListBookingsResponse, GetBookingProgressResponse, UpdateBookingProgressBody,
  UpdateBookingProgressResponse, SaveEventStaffingBody, SaveEventStaffingResponse,
} from "@workspace/api-zod";
import { requireRole, actorOf } from "../../lib/session";
import { planner } from "../../lib/eventops-v2";
import { badInput, respond, sendError } from "../../lib/respond";
import { receiptFile } from "../../lib/receipt-storage";
import { requireReceiptIdentity } from "../../lib/receipt-auth";

const router: IRouter = Router();
const idOf = (req: { params: Record<string, string | string[]> }) => String(req.params.eventId);

router.get("/bookings", requireRole("manager", "worker"), async (req, res): Promise<void> => {
  await respond(req, res, "list-bookings", {}, ListBookingsResponse);
});
router.get("/bookings/:eventId/progress", requireRole("manager", "worker"), async (req, res): Promise<void> => {
  await respond(req, res, "booking-progress", { id: idOf(req) }, GetBookingProgressResponse);
});
router.patch("/bookings/:eventId/progress", requireRole("manager", "worker"), async (req, res): Promise<void> => {
  const body = UpdateBookingProgressBody.safeParse(req.body);
  if (!body.success) return badInput(res, body.error.issues);
  await respond(req, res, "update-progress", { id: idOf(req), ...body.data }, UpdateBookingProgressResponse);
});
router.put("/events/:eventId/staffing", requireRole("manager"), async (req, res): Promise<void> => {
  const body = SaveEventStaffingBody.safeParse(req.body);
  if (!body.success) return badInput(res, body.error.issues);
  await respond(req, res, "save-staffing", { id: idOf(req), ...body.data }, SaveEventStaffingResponse);
});

// Synthetic demonstration receipts only. Existing internal demo accounts are
// intentionally retained; this is not authentication suitable for private financial files.
router.post("/bookings/:eventId/receipts", requireRole("manager", "worker"), requireReceiptIdentity,
  raw({ type: ["image/png", "image/jpeg", "application/pdf"], limit: "5mb" }), async (req, res): Promise<void> => {
    const type = (req.get("content-type") || "").split(";")[0];
    const bytes = req.body as Buffer;
    const valid = Buffer.isBuffer(bytes) && bytes.length > 0 && (
      (type === "application/pdf" && bytes.subarray(0, 5).toString() === "%PDF-") ||
      (type === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
      (type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255));
    if (!valid) { res.status(400).json({ error: "Upload a PNG, JPEG or PDF demo receipt, up to 5 MB." }); return; }
    const id = idOf(req);
    const rid = randomUUID();
    let name: string;
    try { name = decodeURIComponent(req.get("x-file-name") || "Receipt"); }
    catch { res.status(400).json({ error: "Invalid file name." }); return; }
    name = name.replace(/[^\p{L}\p{N} ._()-]/gu, "_").slice(0, 120) || "Receipt";
    const path = `/opusevents/api/bookings/${encodeURIComponent(id)}/receipts/${rid}`;
    const actor = actorOf(req.account!);
    try {
      await planner("booking-progress", { id, actor });
      const file = receiptFile(id, rid);
      await file.save(bytes, { resumable: false, metadata: { contentType: type } });
      try {
        await planner("receipt", { id, actor, receipt_id: rid, register: true, path, name, content_type: type });
      } catch (error) {
        await file.delete({ ignoreNotFound: true }).catch(() => {});
        throw error;
      }
      res.status(201).json({ path, name });
    } catch (error) { sendError(req, res, error, "receipt-upload"); }
  });

router.get("/bookings/:eventId/receipts/:receiptId", requireRole("manager", "worker"), requireReceiptIdentity, async (req, res): Promise<void> => {
  try {
    const id = idOf(req);
    const rid = String(req.params.receiptId);
    const metadata = await planner("receipt", { id, receipt_id: rid, actor: actorOf(req.account!) }) as { name: string; content_type: string };
    res.set({
      "Content-Type": metadata.content_type,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(metadata.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Cache-Control": "private, no-store",
    });
    receiptFile(id, rid).createReadStream().on("error", (error) => {
      req.log.error({ err: error.message }, "Receipt download failed");
      if (!res.headersSent) res.status(503).end("Receipt unavailable.");
      else res.destroy();
    }).pipe(res);
  } catch (error) { sendError(req, res, error, "receipt-download"); }
});
export default router;
