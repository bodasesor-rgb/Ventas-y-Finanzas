# Ventas y Finanzas

Cuando un deal se marca **Cerrado/Ganado** en Kommo, registra una fila en el Sheet de ventas vía Google Apps Script.

## Endpoints

- `POST /webhooks/kommo/deal-won` — webhook Kommo
- `GET /health` — estado + flags de env
- `GET /health/kommo` — prueba token Kommo

## Hostinger

1. Build: `npm install && npm run build`
2. Start: `npm start`
3. Env:
   - `KOMMO_BASE_URL`
   - `KOMMO_ACCESS_TOKEN`
   - `APPS_SCRIPT_VENTAS_URL` (URL `/exec` del Apps Script)

Sin `APPS_SCRIPT_VENTAS_URL` → Fase 1 (solo log).  
Con esa variable → Fase 2 (append/update idempotente por Kommo Deal ID).

## Apps Script

Código listo en `apps-script/Codigo.gs`.  
Sheet: `1TWbOOjTnm68n2QioiwRsHvXSuARev2PLIhqr1pVctp8`
