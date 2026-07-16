import express from "express";
import { ventasRouter } from "./ventasRouter";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Kommo a veces envía application/x-www-form-urlencoded con JSON embebido
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(ventasRouter);

app.listen(PORT, () => {
  console.log(
    `[ventas] listening on :${PORT} | phase=1 (log only, no Sheet write)`
  );
});
