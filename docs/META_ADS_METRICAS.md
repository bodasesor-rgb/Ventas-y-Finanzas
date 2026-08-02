# Meta Ads → Metricas (Facebook Ads)

Llena la sección **Facebook Ads** en `Metricas 2026 Auto`:

| Fila | Campo Meta Insights |
|------|---------------------|
| Inversión | `spend` |
| Conversión | leads (`lead` / leadgen / pixel lead…) |
| CPL | `cost_per_action_type` o spend ÷ conversiones |
| CPC | `cpc` |
| Clics | `clicks` |
| Alcance | `reach` |
| CPM | `cpm` |

Solo escribe **semanas vacías** del lookback (default 45 días). No toca Google Ads.

## Requisitos

1. Token en Hostinger: **`FB_META`** (mismo que seguidores) con permiso **`ads_read`** y acceso a la cuenta publicitaria.
2. Service account Google (Sheets) — igual que visitas/seguidores.
3. Opcional: `META_AD_ACCOUNT_ID=act_XXXX` si tienes varias cuentas.

## Endpoints

```bash
# ¿Ve la ad account?
curl https://TU-HOST/api/ventas/meta-ads-status

# Llenar semanas vacías
curl -X POST https://TU-HOST/api/ventas/sync-facebook-ads

# Sobrescribir
curl -X POST 'https://TU-HOST/api/ventas/sync-facebook-ads?force=1'
```

El tick automático (~cada 6 h) también sincroniza Facebook Ads si Meta está configurado.
