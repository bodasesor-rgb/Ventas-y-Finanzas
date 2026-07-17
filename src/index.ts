import express from "express";
import path from "path";
import { ventasRouter } from "./ventasRouter";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

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

app.use(express.static(path.join(process.cwd(), "public")));

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
});
