# Instagram + Facebook → Metricas (Seguidores)

Llena en **Metricas 2026 Auto**:

| Fila | Fuente |
|------|--------|
| Seguidores IG | Instagram Business `followers_count` |
| Fb Seguidores | Facebook Page `followers_count` |

Escribe la **semana actual** (no inventa histórico).

## Setup (una vez)

1. [Meta for Developers](https://developers.facebook.com/) → tu App → Graph API Explorer  
2. Permisos: `pages_show_list`, `pages_read_engagement`, `instagram_basic` (o `instagram_manage_insights`)  
3. Genera un **Page Access Token** de la página Bodasesor (largo plazo si puedes)  
4. Envíalo al server:

```bash
curl -X POST https://TU-HOST/api/ventas/meta-setup \
  -H 'Content-Type: application/json' \
  -d '{"access_token":"EAAB..."}'
```

Opcional: `"page_id":"..."`, `"ig_user_id":"..."` si tienes varios.

5. Sincronizar:

```bash
curl -X POST https://TU-HOST/api/ventas/sync-seguidores
# sobrescribir semana actual:
curl -X POST 'https://TU-HOST/api/ventas/sync-seguidores?force=1'
```

Estado: `GET /api/ventas/meta-status`

El token se guarda en `data/meta-token.json` (no va a git).
