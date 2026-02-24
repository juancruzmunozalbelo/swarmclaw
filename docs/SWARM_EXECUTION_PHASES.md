# SwarmClaw Execution Phases (Skills-First)

## Objetivo
Consolidar un flujo autonomo, medible y estable con skills obligatorias por dominio.

## Fase 1 - Estabilizacion Ecommerce
- Gate de deploy en `validateDeployClaim`:
  - `STATUS=deployed` solo valido con `URL_PUBLIC` en dominio requerido.
  - `DB=ok`, `CHECK_PUBLIC=ok`, `CHECK_CONTENT=ok`.
- Freeze opcional de backlog:
  - `BACKLOG_FREEZE_PREFIX`
  - `BACKLOG_FREEZE_ACTIVE_TASK`

## Fase 2 - Matriz de Skills
- Router por `taskKind` con skills obligatorias:
  - `devops`: `$swarm-devops-deploy`, `$cloudflare-deploy`
  - `planning`: `$swarm-pm-planning`, `$swarm-spec-contract`, `$swarm-arq-decisions`
  - `qa`: `$swarm-qa-validation`
  - `security`: `$swarm-qa-validation`, `$codex-risk-bridge`
- Prompt de subagente incluye matriz y skill obligatoria.

## Fase 3 - Router Estricto
- Nuevo modo de ejecucion:
  - `SWARM_EXEC_MODE=soft|strict|autonomous`
- Default:
  - `prod` => `strict`
  - `debug` => `soft`
- En `strict/autonomous`, el routing por `taskKind` se vuelve deterministico.

## Fase 4 - Quality Gates por Skill
- Validadores activos:
  - contrato de status
  - evidencia de DONE
  - TDD universal
  - deploy claim
- Nudges automaticos mas estrictos para deploy/status invalido.

## Fase 5 - Metricas por Skill
- `runtime-metrics.json` ahora incluye `skillMetrics`:
  - `dispatched`, `completed`, `failed`, `retries`, `timeouts`, `validationFails`
- Dashboard muestra top skills por fail-rate.

## Fase 6 - Auto-Recovery Anti-Loop
- Si una tarea repite `deploy_validation_failed` >= 3 veces en 15m:
  - se auto-bloquea en workflow/todo
  - deja de nudgear en loop.

## Fase 7 - Modo Autonomo Controlado
- `SWARM_EXEC_MODE=autonomous`:
  - auto-continue siempre activo
  - mismas reglas strict + continuidad automatica.

## Variables clave
- `SWARM_EXEC_MODE=strict`
- `DEPLOY_REQUIRED_PUBLIC_SUFFIX=<dominio>`
- `CLOUDFLARE_ZONE_NAME=<dominio>`
- `BACKLOG_FREEZE_PREFIX=<prefijo>`
- `BACKLOG_FREEZE_ACTIVE_TASK=<ID>`

## Activacion sugerida
1. `strict` para produccion diaria.
2. `autonomous` para sprints largos sin supervision.
3. `soft` para debugging y experimentacion de prompts.
