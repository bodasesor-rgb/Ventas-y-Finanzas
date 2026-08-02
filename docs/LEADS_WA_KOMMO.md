# Leads WA Kommo → Metricas

Llena la sección **Leads WA Kommo** en `Metricas 2026 Auto`:

| Fila | Regla |
|------|--------|
| Leads | Leads **creados** esa semana en el pipeline WA |
| Correo | Correos salientes cuyo asunto contiene **cotización** (ignora publicidad/promo) |
| No contestaron | Etapa actual = **Datos de clientes** (o similar) |
| Llenado | Etapa = **Humano trabaja** / **Seguimientos** / **Intención de paga** |
| Porcentaje de llenado | Llenado ÷ Leads |

## Endpoints

```bash
curl https://TU-HOST/api/ventas/leads-wa-status
curl -X POST https://TU-HOST/api/ventas/sync-leads-wa
curl -X POST 'https://TU-HOST/api/ventas/sync-leads-wa?force=1'
```

Tick automático ~cada 6 h (solo semanas vacías).
