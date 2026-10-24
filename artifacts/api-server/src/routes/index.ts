import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./v2/auth";
import managerRouter from "./v2/manager";
import eventsRouter from "./v2/events";
import workerRouter from "./v2/worker";
import customerRouter from "./v2/customer";
import bookingsRouter from "./v2/bookings";
import { receiptAuthRouter } from "../lib/receipt-auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (["POST", "PATCH"].includes(req.method) && req.headers["content-length"] !== "0" && req.body && !req.is("application/json") && Object.keys(req.body).length) {
    res.status(400).json({ error: "Send this request as JSON." });
    return;
  }
  next();
});
router.use(authRouter);
router.use(managerRouter);
router.use(eventsRouter);
router.use(bookingsRouter);
router.use(receiptAuthRouter);
router.use(workerRouter);
router.use(customerRouter);

export default router;
