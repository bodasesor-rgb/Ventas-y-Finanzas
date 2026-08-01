# Google Analytics → Metricas (Visitas)

Llena en **Metricas 2026 Auto** las filas:

| Fila | Fuente GA4 |
|------|------------|
| Visitas al sitio | `sessions` totales |
| Visitas organicas | `sessions` canal **Organic Search** |
| Visitas blogs | organic + `pagePath` contiene `/blog` |
| Visitas colecciones org | organic + path colecciones |

Solo escribe **semanas vacías** (no pisa lo que ya capturaste a mano), salvo `?force=1`.

## Setup (una vez)

### 1) Service account en Google Cloud
1. Crea un proyecto (o usa uno) → **APIs & Services** → enable **Google Analytics Data API** y **Google Sheets API**
2. **Service Accounts** → Create → Download JSON key

### 2) Acceso GA4
1. Analytics → Admin → Property access management  
2. Add the service account email as **Viewer**

Copia el **Property ID** (Admin → Property settings), ej. `123456789`.

### 3) Acceso al Sheet
Comparte  
`https://docs.google.com/spreadsheets/d/1TWbOOjTnm68n2QioiwRsHvXSuARev2PLIhqr1pVctp8`  
con el email del service account como **Editor**.

### 4) Variables en Hostinger
```
GA4_PROPERTY_ID=123456789
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","client_email":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",...}
GOOGLE_SHEET_ID=1TWbOOjTnm68n2QioiwRsHvXSuARev2PLIhqr1pVctp8
METRICAS_SHEET_NAME=Metricas 2026 Auto
# Opcional:
# GA4_BLOG_PATH_CONTAINS=/blog
# GA4_COLECCIONES_PATH_CONTAINS=/coleccion,/collections,/catalogo,/tienda
```

Tip: el JSON también puede ir en **base64** en la misma variable.

### 5) Probar
```
GET  /api/ventas/ga4-status
POST /api/ventas/sync-visitas
POST /api/ventas/sync-visitas?force=1&days=90
```

## Apps Script (opcional)
Si el service account no puede escribir el Sheet, publica `Codigo.gs` **v31** (`upsertMetricasVisitas`) y el bot usa el `/exec` como fallback.
