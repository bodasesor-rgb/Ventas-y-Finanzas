# Estado de Resultados + Metricas Auto (Sheet)

## v23 — Crear Metricas Auto a un clic

**Original:** `Metricas YYYY` — **nunca se modifica**  
**Copia:** `Metricas YYYY Auto` — duplicado + resumen semanal  

### Cómo crear la pestaña (elige uno)

**A) Desde Apps Script (ya con v22/v23 pegado)**  
1. Editor → función **`restoreMetricasSemanal_`** → ▶ Ejecutar  
2. Refresca el Sheet → debe aparecer **Metricas 2026 Auto**

**B) Desde Hostinger (requiere v23 publicado)**  
`GET` o `POST`  
`https://TU-HOST/api/ventas/setup-metricas-auto`

**C) Publicar v23**  
1. Pegar `apps-script/Codigo.gs`  
2. Implementar → Nueva versión  
3. Confirmar `"version":"2026-07-20-v23"` en la URL `/exec`

Sheet: https://docs.google.com/spreadsheets/d/1TWbOOjTnm68n2QioiwRsHvXSuARev2PLIhqr1pVctp8/edit
