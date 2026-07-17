# Ventas y Finanzas

## Módulos

1. **Ventas (Kommo → Sheet Eventos)**  
   `POST /webhooks/kommo/deal-won` (ACK &lt;2s; escribe Sheet en background)  
   Si no llegó: `GET /api/ventas/recent` → `POST /api/ventas/sync/:dealId`  
   Estado: `GET /api/ventas/last`

2. **P&L Banco (PDF + reglas)**  
   UI: `https://TU-DOMINIO/pnl/`  
   - Sube estados de cuenta PDF  
   - Tabla de pagos frecuentes (ads, pass, etc.)  
   - Pagos a personas → categoría `transferencia_persona` / `revisar` (manual)

## Hostinger

- Build: `npm install && npm run build`
- Start: `npm start`
- Env: `KOMMO_BASE_URL`, `KOMMO_ACCESS_TOKEN`, `URL_BODASESOR_DIRECCION_SHEETS`

## Sheet (Apps Script) — OBLIGATORIO v6

Hoy Hostinger puede estar bien y el Sheet seguir en **v4** (pega clientes hasta abajo).
Hay que republicar el script:

1. Sheet → Extensiones → Apps Script
2. Borra todo y pega `apps-script/Codigo.gs` (debe decir `2026-07-17-v6`)
3. Guardar
4. **Implementar → Administrar implementaciones → lápiz de la implementación actual → Versión: Nueva versión → Implementar**
5. Verifica abriendo la URL `/exec` en el navegador: debe mostrar `"version":"2026-07-17-v6"`

Regla de filas v6:
- Deal ID ya en col T → **actualiza esa fila** (no duplica, no mueve)
- Deal nuevo → **última fila con Cliente + 1** (ej. 66 → 67)

### Cierres automáticos
- Webhook: `POST /webhooks/kommo/deal-won`
- **Poll cada 60s** (backup): si Kommo no manda el webhook, igual sincroniza deals con `closed_at` o status ganado (142)
- Manual: `GET /api/ventas/poll-now` o `GET /api/ventas/sync/:dealId`

## P&L PDF — alcance actual (MVP)

- Parse determinista (regex fecha+monto + keywords)
- Reglas editables en UI (persistidas en `data/recurring-rules.json`)
- **Aún no** escribe al Sheet P&L automáticamente (siguiente paso si el parse te sirve con tus PDFs reales)
