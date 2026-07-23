# Publicar Apps Script con clasp (para que el agente lo haga solo)

## Una sola vez (tú)

### 1) Activa la API
Abre: https://script.google.com/home/usersettings  
Activa **Google Apps Script API**.

### 2) Copia el Script ID
En el proyecto del Sheet → **Configuración del proyecto** (engranaje) → **ID del secuencia de comandos**  
(es un string largo, no la URL `/exec`).

### 3) Login OAuth (desde este entorno)
El agente te dará un link de Google. Tú:
1. Lo abres en tu navegador y autorizas
2. Al final falla `localhost` — **copia toda la URL** de la barra de direcciones
3. Se la pegas al agente

Con eso queda `~/.clasprc.json` y el agente puede hacer `clasp push` + deploy.

## Después
El agente podrá subir `apps-script/Codigo.gs` y publicar nueva versión del `/exec` sin que pegues código a mano.
