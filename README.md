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

## Sheet (Apps Script)

1. Pegar `apps-script/Codigo.gs` (**v5**: inserta en la 1ª fila vacía de Cliente, no al final)
2. Ejecutar **`setupAll_`** solo la primera vez
3. **Implementar → Administrar implementaciones → Editar (lápiz) → Nueva versión → Implementar**  
   (misma URL `/exec`; si creas otra implementación, hay que actualizar Hostinger)

### Cierres automáticos
- Webhook: `POST /webhooks/kommo/deal-won`
- **Poll cada 60s** (backup): si Kommo no manda el webhook, igual sincroniza deals con `closed_at` o status ganado (142)
- Manual: `GET /api/ventas/poll-now` o `GET /api/ventas/sync/:dealId`

## P&L PDF — alcance actual (MVP)

- Parse determinista (regex fecha+monto + keywords)
- Reglas editables en UI (persistidas en `data/recurring-rules.json`)
- **Aún no** escribe al Sheet P&L automáticamente (siguiente paso si el parse te sirve con tus PDFs reales)
