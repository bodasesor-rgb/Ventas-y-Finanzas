# Metricas semanal desde Eventos (v25)

## Idea
**No se crean columnas.** En `Metricas 2026 Auto` se ponen **formulas** en tu tabla semanal (Ingresos, # Eventos, etc.) leyendo `Eventos 2026` por **Fecha de cierre**.

| Fila | Fuente |
|------|--------|
| Ingresos | `SUMIFS` Venta (J) en el rango de la semana |
| # Eventos | `COUNTIFS` clientes con cierre en la semana |
| Ticket | Ingresos / # Eventos |
| WoW | vs columna anterior |
| Ganancias | `SUMIFS` Ganancia (N) |
| Margen | Ganancias / Ingresos |
| Gasto | **manual — no se toca** |
| Ganancias brutas | Ganancias − Gasto − Banco |

La fecha del **encabezado de cada columna** = inicio de semana (ej. 20/07/2026 = sem 30, del 20 al 26).

## Activar
1. Pegar `Codigo.gs` v25
2. Ejecutar **`restoreMetricasSemanal_`**
3. Implementar → Nueva versión
4. O: `POST /api/ventas/setup-metricas-auto`

Original `Metricas 2026` no se modifica.
