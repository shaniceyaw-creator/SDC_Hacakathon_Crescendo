import { Router, type IRouter } from "express";
import { GetCustomerHomeResponse, GetPublicEventsResponse } from "@workspace/api-zod";
import { requireRole } from "../../lib/session";
import { respond } from "../../lib/respond";

const router: IRouter = Router();

router.get("/customer/home", requireRole("customer"), async (req, res): Promise<void> => {
  await respond(req, res, "customer-home", {}, GetCustomerHomeResponse);
});

router.get("/public-events", requireRole(), async (req, res): Promise<void> => {
  await respond(req, res, "public-events", {}, GetPublicEventsResponse);
});

export default router;
