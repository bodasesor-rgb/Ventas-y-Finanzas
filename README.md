# Ventas y Finanzas

## Módulos

1. **Ventas (Kommo → Sheet Eventos)**  
   `POST /webhooks/kommo/deal-won`

2. **P&L Banco (PDF + reglas)**  
   UI: `https://TU-DOMINIO/pnl/`  
   - Sube estados de cuenta PDF  
   - Tabla de pagos frecuentes (ads, pass, etc.)  
   - Pagos a personas → categoría `transferencia_persona` / `revisar` (manual)

## Hostinger

- Build: `npm install && npm run build`
- Start: `npm start`
- Env: `KOMMO_BASE_URL`, `KOMMO_ACCESS_TOKEN`, `URL_BODASESOR_DIRECCION_SHEETS`

## Sheet (una sola vez)

1. Pegar `apps-script/Codigo.gs` (v4)
2. Ejecutar **`setupAll_`** en el editor → enlaza Eventos + Metricas + P&L (fórmulas)
3. Nueva versión App web

No hace falta volver a pegar el script salvo que cambiemos lógica.

## P&L PDF — alcance actual (MVP)

- Parse determinista (regex fecha+monto + keywords)
- Reglas editables en UI (persistidas en `data/recurring-rules.json`)
- **Aún no** escribe al Sheet P&L automáticamente (siguiente paso si el parse te sirve con tus PDFs reales)
