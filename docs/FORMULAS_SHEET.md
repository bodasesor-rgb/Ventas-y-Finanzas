# Enlace Sheet (Eventos · Banco · P&L · Metricas)

## Cómo aplicar (v17)

1. Pega `apps-script/Codigo.gs` (VERSION `2026-07-20-v17`).
2. Guarda.
3. **`restorePnLBanco_`** → ▶ Ejecutar (arma columnas ene–dic; **no toca Metricas**).
4. Implementar → Nueva versión → misma URL `/exec`.
5. Confirma en `/exec` que `version` sea `2026-07-20-v17`.
6. En `/pnl/`: **Enviar al P&L** → pega resultados en la columna del mes.

## Qué hace "Enviar al P&L"

1. Escribe/actualiza 1 fila en **Banco YYYY**
2. Pega montos en **P&L YYYY**, columna del mes (`B`=enero … `M`=diciembre)

| Fila P&L | Dato pegado |
|----------|-------------|
| Venta / anticipo | cat `venta` |
| Ingreso | cat `ingreso` (o total abonos si no hay desglose) |
| Proveedores | `proveedor` |
| Costo de evento | `evento` |
| Marketing | `ads` |
| RH | `pago` |
| Programas | `apps` + `pass` |
| Otros | comisiones, servicios, transf, revisar, otro… |
| Banco | neto del mes |
| CAPITAL | socios |

TOTAL / Ingreso Bruto / Margen / Ingreso Neto = fórmulas. Metricas no se toca.
