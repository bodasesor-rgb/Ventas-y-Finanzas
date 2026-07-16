import express from "express";
import { ventasRouter } from "./ventasRouter";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Kommo a veces envía application/x-www-form-urlencoded con JSON embebido
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(ventasRouter);

const scriptUrl = (
  process.env.URL_BODASESOR_DIRECCION_SHEETS ||
  process.env.APPS_SCRIPT_VENTAS_URL ||
  ""
).trim();
const phase = scriptUrl ? 2 : 1;

app.listen(PORT, () => {
  console.log(
    `[ventas] listening on :${PORT} | phase=${phase}` +
      (phase === 1
        ? " (log only — falta URL_BODASESOR_DIRECCION_SHEETS /exec)"
        : " (escribe a Sheet vía Apps Script)")
  );
});


