import express from "express";
import path from "path";
import { ventasRouter } from "./ventasRouter";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

/**
 * Hostinger congela Node sin tráfico: setInterval deja de correr.
 * En cada request, si el poll está viejo, disparamos uno en background.
 */
app.use((_req, _res, next) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { kickPollIfStale } = require("./pollClosedDeals") as typeof import("./pollClosedDeals");
    kickPollIfStale(90_000);
  } catch {
    // poller opcional al boot
  }
  next();
});

// Ventas siempre (crítico)
app.use(ventasRouter);

// P&L opcional: si falla el require, la app de ventas sigue viva
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { pnlRouter } = require("./pnl/pnlRouter") as typeof import("./pnl/pnlRouter");
  app.use(pnlRouter);
  console.log("[boot] pnl router OK");
} catch (err) {
  console.error("[boot] pnl router NO cargó (ventas sigue activa)", err);
}

app.use(
  express.static(path.join(process.cwd(), "public"), {
    etag: false,
    lastModified: false,
    setHeaders(res, filePath) {
      if (/\.(js|css|html)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      }
    },
  })
);

app.get("/", (_req, res) => {
  res.redirect("/pnl/");
});

// Health ultra simple por si /health del router fallara
app.get("/ping", (_req, res) => {
  res.status(200).send("pong");
});

const scriptUrl = (
  process.env.URL_BODASESOR_DIRECCION_SHEETS ||
  process.env.APPS_SCRIPT_VENTAS_URL ||
  ""
).trim();
const phase = scriptUrl ? 2 : 1;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[ventas+pnl] 0.0.0.0:${PORT} | ventas phase=${phase} | UI=/pnl/`);
  // Backup: si Kommo no dispara el webhook, igual subimos cierres al Sheet
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { startClosedDealsPoller } = require("./pollClosedDeals") as typeof import("./pollClosedDeals");
    // 30s en proceso despierto; el cron externo mantiene el proceso vivo
    startClosedDealsPoller(30_000);
  } catch (err) {
    console.error("[boot] poller de cierres NO arrancó", err);
  }

  // Registrar webhook Kommo → subida al instante al ganar
  try {
    const publicBase = (
      process.env.PUBLIC_BASE_URL ||
      process.env.HOSTINGER_URL ||
      "https://lightcyan-reindeer-284498.hostingersite.com"
    ).replace(/\/$/, "");
    const dest = `${publicBase}/webhooks/kommo/deal-won`;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ensureKommoStatusWebhook } = require("./kommoApi") as typeof import("./kommoApi");
    void ensureKommoStatusWebhook(dest).then((r) => {
      if (r.ok) {
        console.log(
          `[boot] Kommo webhook ${r.created ? "creado" : "ya existía"} → ${r.destination}`
        );
      } else {
        console.warn("[boot] Kommo webhook NO registrado:", r.error);
      }
    });
  } catch (err) {
    console.error("[boot] ensure webhook falló", err);
  }
});
