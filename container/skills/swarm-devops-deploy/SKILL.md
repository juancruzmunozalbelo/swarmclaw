---
name: swarm-devops-deploy
description: Ejecuta deploy/infra de forma segura y verificable, sin mezclar features de producto.
---

<skill name="swarm-devops-deploy">
  <intent>Resolver configuraciones de runtime e infraestructura, garantizando el despliegue verificable hacia una URL pública y validando el estado de la Base de Datos.</intent>
  
  <execution_rules>
    <constraint>No implementes o introduzcas features de producto o modelo de negocio desde esta skill. Tu foco es estrictamente de infraestructura.</constraint>
    <constraint>Asegúrate de verificar activamente que la URL pública despliega un contenido real y válido (no un HTTP 502/404 vacío).</constraint>
    <constraint>Detecta si la base de datos está degradada o si se están inyectando variables de localhost inválidas para el entorno remoto.</constraint>
  </execution_rules>

  <cloudflare_deployment>
    <condition>Si la solicitud de despliegue requiere Cloudflare, subdominios o túneles públicos.</condition>
    <action>Utiliza las credenciales directamente extraídas del entorno (`CLOUDFLARE_ZONE_NAME`, `CLOUDFLARE_API_TOKEN`, etc.).</action>
    <forbidden>NO le solicites el token de API u otras variables de forma interactiva al usuario si ya están presentes en tu entorno (variables de sistema o secrets inyectados).</forbidden>
  </cloudflare_deployment>

  <output_format>
    <description>Reporta de forma estricta el estado del despliegue en formato JSON.</description>
    <template>
```json
{
  "etapa": "DEVOPS",
  "item": "ID-TAREA",
  "archivos_modificados": ["..."],
  "siguiente_accion": "Monitorizar / Completar deploy",
  "swarm_log": { "url_publica": "https://...", "estado_db": "OK" }
}
```
    </template>
  </output_format>
</skill>
