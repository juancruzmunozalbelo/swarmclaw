---
name: task-subdomain
description: Asigna y reporta un subdominio por tarea (ej. LAND-010.swarmdev.localhost), mantiene un registro en groups/main/swarmdev/subdomains.md y lo incluye en el cierre para facilitar previews y seguimiento.
---

<skill name="task-subdomain">
  <intent>Generar, registrar y comunicar un subdominio público asociado a una tarea o feature específica.</intent>
  <trigger>Ejecuta este skill cuando el usuario pida explícitamente "mostrar un subdominio", "dar link por tarea/feature", "URL estable por ticket" o "preview por subdominio".</trigger>
  
  <naming_rules>
    1. Toma el ID de la tarea actual (ej: `LAND-010`). Si no hay ID, crea uno previamente en `groups/main/todo.md`.
    2. Slug = lowercase + guiones (ej: `land-010`).
    3. Dominio base:
       - Si existen `CLOUDFLARE_ZONE_NAME`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID` y `CLOUDFLARE_TUNNEL_TARGET` en entorno, usar Cloudflare.
       - Si no, usar fallback local: `swarmdev.localhost`.
    4. Subdominio final:
       - Cloudflare: `https://<slug>.<CLOUDFLARE_ZONE_NAME>`
       - Local: `http://<slug>.swarmdev.localhost`
  </naming_rules>

  <execution_steps>
    <step>
      <description>SI tienes credenciales de Cloudflare, registra/actualiza el DNS ejecutando este comando Bash exacto.</description>
      <action type="Bash">bash /home/node/.claude/skills/task-subdomain/scripts/register-cloudflare-subdomain.sh "<slug>"</action>
    </step>
    <step>
      <description>Lee el archivo de registro `groups/main/swarmdev/subdomains.md` si existe.</description>
      <action type="Read">groups/main/swarmdev/subdomains.md</action>
    </step>
    <step>
      <description>Actualiza (o crea) la fila correspondiente al ID de la tarea en la tabla de subdominios, usando el formato requerido.</description>
      <format>
| ID | Subdominio | Entregable | Estado | UpdatedAt |
|---|---|---|---|---|
| LAND-010 | http://land-010.swarmdev.localhost | groups/main/landing-equipo.html | done | 2026-02-17T05:00:00Z |
      </format>
    </step>
  </execution_steps>

  <output_format>
    <requirement>En tu mensaje de cierre al usuario, incluye obligatoriamente el subdominio y el entregable, no envíes solo logs.</requirement>
    <template>
SUBDOMINIO: http://<slug>.swarmdev.localhost
ENTREGABLE: <ruta>
    </template>
  </output_format>
</skill>
