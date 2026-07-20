# Estado de Resultados + Metricas semanal (Sheet)

## v21 — Resumen semanal en Metricas

**Visible:** `Estado de Resultados YYYY` (por mes)  
**Metricas:** tu dashboard en **A:L no se toca**. El bot adjunta un **resumen semanal** de Eventos a la derecha (columna **N+**, o **AA+** si N está ocupada).  
**Oculto:** `Banco YYYY` (respaldo técnico del PDF)

### Semanal (Eventos → Metricas)

| Origen | Qué |
|--------|-----|
| `Eventos YYYY` col **U** | `WEEKNUM(Fecha de cierre, 2)` (semana inicia lunes) |
| `Eventos YYYY` **AD:AK** | Tabla semanal 1–53 (Pagado, Por pagar, Venta, Ganancia, #) |
| `Metricas YYYY` **N+** | Bloque `RESUMEN SEMANAL` con fórmulas que leen AD:AK |

## Cómo publicar

1. Pegar `apps-script/Codigo.gs` (`2026-07-20-v21`)
2. Ejecutar **`restoreMetricasSemanal_`** (adjunta semanal; no borra A:L)
3. Si hace falta ER: **`restoreEstadoResultados_`**
4. Implementar → Nueva versión → misma `/exec`
5. Confirmar `"version":"2026-07-20-v21"`

Metricas **A:L** no se regenera ni se limpia.
