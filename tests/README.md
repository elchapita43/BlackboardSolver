# Tests E2E - BlackboardSolver

Este directorio contiene los tests end-to-end del proyecto usando Playwright.

## Estructura

```text
tests/
`-- e2e/
    |-- helpers.ts
    |-- api.spec.ts
    |-- ui.spec.ts
    |-- sync.spec.ts
    `-- chat.spec.ts
```

## Requisitos

- Node.js 20+
- Dependencias instaladas con `npm install`
- Navegadores de Playwright instalados con `npx playwright install chromium`

## Comandos

```bash
npm run test:e2e
npm run test:e2e:ui
npm run test:e2e:debug
npx playwright test tests/e2e/api.spec.ts
```

## Variables de entorno

Para tests de chat:

```bash
export OPENROUTER_API_KEY=sk-or-v1-tu-api-key
export OPENROUTER_MODEL=qwen/qwen3.6-plus-preview:free
```

Opcionales:

```bash
export BASE_URL=http://127.0.0.1:3010
export CI=false
```

## Notas

- Los tests de sincronizacion real dependen de Chrome y del estado de la sesion de Blackboard.
- Si `OPENROUTER_API_KEY` no esta definida, los tests de chat que dependen del proveedor se saltean.
- Los artefactos de debugging se guardan en `.data/debug/` y no deben subirse al repo.
