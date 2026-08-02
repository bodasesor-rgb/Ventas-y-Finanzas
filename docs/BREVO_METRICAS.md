# Brevo → Metricas

Llena la sección **Brevo Bodasesor** en `Metricas 2026 Auto`:

| Fila | Fuente Brevo |
|------|----------------|
| Contactos | Total de contactos (`GET /contacts` → `count`) |
| Correos mandados | Suma `sent` de campañas enviadas esa semana |
| Aperturas | Suma `uniqueViews` / `viewed` |
| Clicks | Suma `uniqueClicks` / `clickers` |
| CTR | Clicks ÷ Correos mandados |

## Setup (una vez)

1. Brevo → **SMTP & API** → **API keys** → crea una key  
2. Envíala al server:

```bash
curl -X POST https://TU-HOST/api/ventas/brevo-setup \
  -H 'Content-Type: application/json' \
  -d '{"api_key":"xkeysib-..."}'
```

O en Hostinger: variable de entorno **`BREVO_API_KEY`** (o `BREVO`).

3. Sincronizar:

```bash
curl -X POST https://TU-HOST/api/ventas/sync-brevo
curl -X POST 'https://TU-HOST/api/ventas/sync-brevo?force=1'
```

Estado: `GET /api/ventas/brevo-status`

El tick automático (~cada 6 h) también sincroniza Brevo si hay API key.
