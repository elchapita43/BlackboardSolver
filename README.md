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

## Variables de entorno

Revisar `.env.example`.

Clave para chat:
- `OPENROUTER_API_KEY` (obligatoria para `/api/chat`)
- `OPENROUTER_MODEL` (opcional, default `qwen/qwen3.6-plus-preview:free`)

Configuracion util para tests o fail-fast de login:
- `BLACKBOARD_LOGIN_WAIT_TIMEOUT_MS` (default `180000`)

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

## Publicar en GitHub

Antes de subir el repo:

1. Verifica que `.env` no exista o quede fuera del commit.
2. No subas `.data/`, perfiles de Chrome, logs ni reportes de Playwright.
3. Si alguna vez pegaste una API key real en un chat o archivo local, rotala.
4. Revisa el diff antes del primer push desde GitHub Desktop.

## Flujo funcional actual

1. Sincronizas tareas pendientes desde Blackboard.
2. La app guarda snapshot en `.data/latest-tasks.json` y datos estructurados en `.data/blackboard.db`.
3. Puedes seleccionar una tarea o pegar URL directa de evaluacion para extraer detalle.
4. El chat responde usando contexto de tareas y detalle scrapeado.

## Seguridad y privacidad

- No subas `.env`, `.data/`, logs ni reportes de test.
- No subas `credentials.json` ni API keys.
- Si compartiste una key por chat, rotala.
- Este repo esta preparado para publicarse sin incluir sesiones, bases locales ni credenciales.

## Estado del proyecto

MVP funcional en evolucion. El scraper depende del DOM de Blackboard Ultra y puede requerir ajustes si la UI cambia.
