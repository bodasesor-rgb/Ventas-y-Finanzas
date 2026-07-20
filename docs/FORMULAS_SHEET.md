# Estado de Resultados + Metricas Auto (Sheet)

## v22 — Copia de Metricas + resumen semanal

**Original:** `Metricas YYYY` — **nunca se modifica**  
**Copia de prueba:** `Metricas YYYY Auto` — duplicado + resumen semanal de Eventos  
**Visible ER:** `Estado de Resultados YYYY`  
**Oculto:** `Banco YYYY`

### Flujo

1. Se duplica `Metricas 2026` → `Metricas 2026 Auto`
2. En la **Auto** se escribe el bloque semanal (columna N+ o AA+)
3. Cuando confirmes que funciona, migrás / renombras a ese espacio

### Semanal (Eventos → Metricas Auto)

| Origen | Qué |
|--------|-----|
| `Eventos YYYY` col **U** | `WEEKNUM(Fecha de cierre, 2)` |
| `Eventos YYYY` **AD:AK** | Tabla semanal 1–53 |
| `Metricas YYYY Auto` **N+** | Bloque `RESUMEN SEMANAL` |

## Cómo publicar

1. Pegar `apps-script/Codigo.gs` (`2026-07-20-v22`)
2. Ejecutar **`restoreMetricasSemanal_`** (crea/actualiza la pestaña Auto)
3. Implementar → Nueva versión → misma `/exec`
4. Confirmar `"version":"2026-07-20-v22"`

`Metricas 2026` original queda intacta.
