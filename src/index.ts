import express from "express";
import path from "path";
import { ventasRouter } from "./ventasRouter";
import { pnlRouter } from "./pnl/pnlRouter";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(ventasRouter);
app.use(pnlRouter);

app.use(express.static(path.join(process.cwd(), "public")));

app.get("/", (_req, res) => {
  res.redirect("/pnl/");
});

const scriptUrl = (
  process.env.URL_BODASESOR_DIRECCION_SHEETS ||
  process.env.APPS_SCRIPT_VENTAS_URL ||
  ""
).trim();
const phase = scriptUrl ? 2 : 1;

app.listen(PORT, () => {
  console.log(
    `[ventas+pnl] :${PORT} | ventas phase=${phase} | UI=/pnl/`
  );
});
