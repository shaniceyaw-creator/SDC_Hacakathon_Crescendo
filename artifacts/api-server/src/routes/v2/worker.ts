import { Router, type IRouter } from "express";
import { GetWorkerHomeResponse, GetWorkerTipsResponse, TakeTaskParams, TakeTaskResponse } from "@workspace/api-zod";
import { requireRole, actorOf } from "../../lib/session";
import { respond, badInput, sendError } from "../../lib/respond";
import { planner } from "../../lib/eventops-v2";
import { forecastFor, tipsFor } from "../../lib/weather";

const router: IRouter = Router();
router.use("/worker", requireRole("worker"));

router.get("/worker/home", async (req, res): Promise<void> => {
  await respond(req, res, "worker-home", {}, GetWorkerHomeResponse);
});

router.post("/worker/tasks/:taskId/take", async (req, res): Promise<void> => {
  const params = TakeTaskParams.safeParse(req.params);
  if (!params.success) return badInput(res, params.error.issues);
  await respond(req, res, "take-task", { task_id: params.data.taskId }, TakeTaskResponse);
});

type Home = {
  today: string;
  me: { hours_this_week: number; weekly_cap: number };
  jobs: { name: string; date: string; area: string; lat: number; lon: number; setting: string; start_time: string; end_time: string }[];
};

router.get("/worker/tips", async (req, res): Promise<void> => {
  let home: Home;
  let base: { name: string; lat: number; lon: number };
  try {
    home = (await planner("worker-home", { actor: actorOf(req.account!) })) as Home;
    base = ((await planner("options")) as { base: typeof base }).base;
  } catch (error) {
    sendError(req, res, error, "worker-home");
    return;
  }
  const limit = new Date(Date.parse(home.today) + 14 * 86400000).toISOString().slice(0, 10);
  const job = home.jobs.find((j) => j.date >= home.today && j.date <= limit);
  const place = job ? { name: job.area, lat: job.lat, lon: job.lon } : base;
  const day = job?.date ?? home.today;
  const startHour = job ? Math.max(0, Number(job.start_time.slice(0, 2)) - 2) : 8;
  const endHour = job ? Math.min(23, Number(job.end_time.slice(0, 2)) + 1) : 18;
  const outdoor = job ? job.setting !== "Indoor" : true;

  let forecast = null;
  let problem: string | null = null;
  try {
    forecast = await forecastFor(place.lat, place.lon, day, home.today, startHour, endHour);
  } catch {
    problem = "Weather is unavailable right now.";
  }
  res.json(GetWorkerTipsResponse.parse({
    place: place.name, date: day, for_job: job?.name ?? null, setting: job?.setting ?? "Outdoor",
    forecast, tips: tipsFor(forecast, outdoor, home.me.hours_this_week, home.me.weekly_cap),
    source: "Open-Meteo weather and air quality", error: problem,
  }));
});

export default router;
