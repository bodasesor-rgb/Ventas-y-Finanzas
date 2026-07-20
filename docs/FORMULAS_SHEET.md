# Estado de Resultados (Sheet)

## v18 — pestaña nueva

Además de **Banco YYYY** (detalle del estado de cuenta), el bot crea:

**`Estado de Resultados YYYY`**

Columnas: Concepto | enero … diciembre | TOTAL

Bloques:
- INGRESOS (venta, otros ingresos, total)
- EGRESOS / COSTO (proveedores, costo evento)
- UTILIDAD BRUTA + margen %
- GASTOS DE OPERACIÓN (ads, apps, pass, comisiones, servicios, RH, transf, revisar, otro…)
- UTILIDAD NETA + margen %
- CAPITAL Y BANCO (socios, neto, depósitos/retiros oficiales)

## Cómo publicar

1. Pegar `apps-script/Codigo.gs` (`2026-07-20-v18`)
2. Ejecutar **`restoreEstadoResultados_`**
3. Implementar → Nueva versión → misma `/exec`
4. Confirmar `"version":"2026-07-20-v18"`
5. En `/pnl/` → **Enviar a Estado de Resultados**

Metricas no se toca.
