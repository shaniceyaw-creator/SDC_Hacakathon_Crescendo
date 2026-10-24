import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { APP_BASE_PATH, LEGACY_APP_BASE_PATH, SIGN_IN_PATH, canonicalAppPath } from "./lib/public-paths";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
const secret = process.env.SESSION_SECRET;
if (!secret) {
  throw new Error("SESSION_SECRET must be set for demo sign-in.");
}
app.use(cookieParser(secret));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true }));

// The main address opens the current OpusEvents sign-in page.
app.get("/", (_req, res) => {
  res.redirect(302, SIGN_IN_PATH);
});

// The static web artifact owns the slash-terminated prefix.
app.get(/^\/opusevents$/i, (req, res) => {
  res.redirect(308, `${APP_BASE_PATH}/${req.originalUrl.slice(req.path.length)}`);
});

// The first version was retired; keep old bookmarks pointed at the current app.
app.get(["/streamlit", "/streamlit/{*path}"], (_req, res) => {
  res.redirect(302, SIGN_IN_PATH);
});

app.use("/api", router);
// Browser requests follow the public brand; keep previous API links usable.
app.use(`${APP_BASE_PATH}/api`, router);
app.use(`${LEGACY_APP_BASE_PATH}/api`, router);

// Old page bookmarks retain their destination and query string.
app.get([LEGACY_APP_BASE_PATH, `${LEGACY_APP_BASE_PATH}/{*path}`], (req, res) => {
  res.redirect(308, canonicalAppPath(req.originalUrl));
});

export default app;
