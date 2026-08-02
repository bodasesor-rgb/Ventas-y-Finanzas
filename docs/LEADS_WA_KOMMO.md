# Leads WA Kommo → Metricas

Llena la sección **Leads WA Kommo** en `Metricas 2026 Auto`:

| Fila | Regla |
|------|--------|
| Leads | Leads **creados** esa semana en **Embudo de ventas** |
| Correo | Preferente: mail con asunto **cotización**. Si Kommo no lo expone → igual a **Llenado** (como en tu histórico) |
| No contestaron | Etapa actual = **Datos e Intereses del cliente** o **Cliente no contesta** |
| Llenado | Etapa = **Humano Trabaja** / **Seguimiento(s)** / **Intención de paga** |
| Porcentaje de llenado | Llenado ÷ Leads |

## Endpoints

```bash
curl https://TU-HOST/api/ventas/leads-wa-status
curl -X POST https://TU-HOST/api/ventas/sync-leads-wa
curl -X POST 'https://TU-HOST/api/ventas/sync-leads-wa?force=1'
```

Tick automático ~cada 6 h (solo semanas vacías).
