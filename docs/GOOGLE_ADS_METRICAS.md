# Google Ads → Metricas

Llena la sección **Google Ads** en `Metricas 2026 Auto`:

| Fila | Fuente preferida (API) | Fallback GA4 |
|------|------------------------|--------------|
| Inversión | `metrics.cost_micros` | `advertiserAdCost` (google/cpc) |
| Conversión | `metrics.conversions` | **10% de los clics** (regla Bodasesor) |
| CPL | cost ÷ conversions | cost ÷ (10% clics) |
| CPC | cost ÷ clicks | cost ÷ clicks |
| Clics | `metrics.clicks` | `advertiserAdClicks` |

Solo semanas **vacías** (lookback 45 días). Tick automático ~cada 6 h.

## Opción A — Ya funciona (GA4)

Si Google Ads está vinculado a GA4 (como ahora), con el service account se llenan **Inversión / Clics / CPC**.

```bash
curl -X POST https://TU-HOST/api/ventas/sync-google-ads
```

## Opción B — Conversión y CPL reales (Google Ads API)

1. [Google Ads API Center](https://ads.google.com/aw/apicenter) → **Developer token**
2. OAuth (Client ID, Secret, Refresh token) de una app en Google Cloud con scope `https://www.googleapis.com/auth/adwords`
3. **Customer ID** de la cuenta (sin guiones o con)

En Hostinger (una sola variable JSON):

```
GOOGLE_ADS={"developer_token":"...","customer_id":"1234567890","client_id":"...","client_secret":"...","refresh_token":"..."}
```

O por endpoint:

```bash
curl -X POST https://TU-HOST/api/ventas/google-ads-setup \
  -H 'Content-Type: application/json' \
  -d '{
    "developer_token":"...",
    "customer_id":"1234567890",
    "client_id":"...",
    "client_secret":"...",
    "refresh_token":"..."
  }'
```

Estado: `GET /api/ventas/google-ads-status`
