# BlackboardSolver

App local para:
- sincronizar tareas pendientes desde Blackboard Palermo (`https://palermo.blackboard.com`)
- guardar contexto en SQLite
- leer detalle de evaluaciones (instrucciones, adjuntos, metadatos)
- conversar con un asistente IA via OpenRouter usando ese contexto

## Stack

- Node.js + TypeScript
- Express
- Playwright
- SQLite (`better-sqlite3`)
- Frontend vanilla (`public/`)

## Plataforma

- Windows 10/11
- Google Chrome instalado localmente

La version actual del scraper esta orientada a Windows porque reutiliza rutas y perfiles locales de Chrome en ese entorno.

## Requisitos

- Node.js 20+
- Google Chrome instalado
- Blackboard con sesion valida (o credenciales en variables de entorno)

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

Si prefieres credenciales por archivo local en lugar de variables de entorno:

```powershell
New-Item -ItemType Directory -Force .data | Out-Null
Copy-Item credentials.example.json .data/credentials.json
```

## Variables de entorno

Revisar `.env.example`.

Clave para chat:
- `OPENROUTER_API_KEY` (obligatoria para `/api/chat`)
- `OPENROUTER_MODEL` (opcional, default `qwen/qwen3.6-plus-preview:free`)

Configuracion util para tests o fail-fast de login:
- `BLACKBOARD_LOGIN_WAIT_TIMEOUT_MS` (default `180000`)
- `BLACKBOARD_AUTO_SYNC_INTERVAL_MINUTES` (default `0`, desactivado)
- `BLACKBOARD_AUTO_SYNC_MAX_AGE_HOURS` (default `24`, solo para decidir si refrescar una vez al abrir)

Credenciales de Blackboard:
- via variables `BLACKBOARD_USERNAME` y `BLACKBOARD_PASSWORD`
- o via archivo local no versionado `.data/credentials.json`

## Ejecutar

```bash
npm run dev
```

Abrir: [http://127.0.0.1:3010](http://127.0.0.1:3010)

## Comandos utiles

```bash
npm run typecheck
npm run build
npm run test:e2e
```

## Flujo funcional actual

1. Sincronizas tareas pendientes desde Blackboard.
2. La app guarda snapshot en `.data/latest-tasks.json` y datos estructurados en `.data/blackboard.db`.
3. Puedes seleccionar una tarea o pegar URL directa de evaluacion para extraer detalle.
4. El chat responde usando contexto de tareas y detalle scrapeado.

Comportamiento de refresco:
- Manual por defecto desde la UI.
- Al abrir, la app puede hacer un solo refresh silencioso si la snapshot local tiene mas de 24 horas.
- No hay polling periodico a menos que configures `BLACKBOARD_AUTO_SYNC_INTERVAL_MINUTES`.
- 
## Licencia

Este proyecto se distribuye bajo licencia MIT. Ver [`LICENSE`](C:/Users/Tobia/OneDrive/Aplicaciones/BlackboardSolver/LICENSE).

## Estado del proyecto

MVP funcional en evolucion. El scraper depende del DOM de Blackboard Ultra y puede requerir ajustes si la UI cambia.
