---
name: cloudflare-deploy
description: Deploy estable con Cloudflare Tunnel + DNS CNAME por tarea, usando credenciales desde variables de entorno.
---

# Cloudflare Deploy

## Objetivo
Publicar una URL estable por tarea (`https://<slug>.<zone>`) sin puertos abiertos, usando Cloudflare Tunnel + DNS.

## Credenciales (solo env)
Usar SIEMPRE variables de entorno ya configuradas:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ZONE_ID`
- `CLOUDFLARE_ZONE_NAME`
- `CLOUDFLARE_TUNNEL_TARGET`

No pedir token manual si estas variables existen.
No usar quick tunnel ni `*.trycloudflare.com` como salida final.
No pedir `TUNNEL_TOKEN` para este flujo (se usa DNS + tunnel target ya configurado).

## Flujo obligatorio
1. Derivar `slug` desde `TASK-ID` (ej: `ECOM-096` -> `ecom-096`).
2. Ejecutar:
```bash
bash /home/node/.claude/skills/cloudflare-deploy/scripts/deploy-cloudflare-url.sh "<task-id>" "<local-url>"
```
Opcional (si necesitas auto-start explicito):
```bash
bash /home/node/.claude/skills/cloudflare-deploy/scripts/deploy-cloudflare-url.sh "<task-id>" "<local-url>" "<start-cmd>" "<start-cwd>"
```
El script ahora:
- intenta auto-arrancar el servicio local si `<local-url>` no responde
- reintenta healthcheck publico por ventana (`DEPLOY_WAIT_SECONDS`, default 75s)
- deja estado `done/blocked` en `subdomains.md` con evidencia
3. Validar salida:
- `STATUS=deployed`
- `CHECK_LOCAL=ok`
- `CHECK_PUBLIC=ok`
- `CHECK_CONTENT=ok`
4. El script hace upsert automatico en `groups/main/swarmdev/subdomains.md` (o `SUBDOMAINS_FILE` si se define).

## Modo de falla
Si falla por credenciales/permiso/DNS:
- `ETAPA: BLOCKED`
- Explicar causa concreta en 1 línea
- Proponer 1 acción recomendada

## Salida obligatoria
Incluir:
- `ETAPA`
- `ITEM`
- `ARCHIVOS`
- `SIGUIENTE`
- `TDD_TIPO/TDD_RED/TDD_GREEN/TDD_REFACTOR`
- `JSONPROMPT`
- `SWARMLOG`
- línea DEVOPS:
`STATUS=... URL_PUBLIC=... PORT=... PROCESS=... DB=... CHECK_LOCAL=... CHECK_PUBLIC=... CHECK_CONTENT=... LAST_LOG=...`
