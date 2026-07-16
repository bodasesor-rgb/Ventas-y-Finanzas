# Ventas y Finanzas

Módulo Node.js/TypeScript: cuando un deal se marca **Cerrado/Ganado** en Kommo, registra una fila en el Sheet de ventas.

## Fase actual: 1 (solo log)

- Endpoint: `POST /webhooks/kommo/deal-won`
- Health: `GET /health`
- Aún **no** escribe al Google Sheet.

## Hostinger (Node.js)

1. Importa este repositorio (rama `modulo-ventas`).
2. Build command: `npm install && npm run build`
3. Start command: `npm start`
4. Variables de entorno: ver `.env.example` (`KOMMO_BASE_URL`, `KOMMO_ACCESS_TOKEN`).
5. En Kommo, apunta el webhook de deal ganado a:
   `https://TU-DOMINIO/webhooks/kommo/deal-won`

## Scripts

```bash
npm install
npm run build
npm start
```
