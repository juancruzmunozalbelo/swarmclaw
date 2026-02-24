---
name: swarm-arq-decisions
description: Define decisiones de arquitectura con tradeoffs, límites técnicos, observabilidad y rollout/rollback.
---

<skill name="swarm-arq-decisions">
  <intent>Formalizar decisiones arquitectónicas defendibles y altamente operables, analizando pros, contras y mitigaciones.</intent>
  
  <architecture_checklist>
    <requirement>Analítica de alternativas: Especifica de forma obligatoria la opción elegida versus las alternativas explícitamente descartadas.</requirement>
    <requirement>Impacto técnico: Enumera claramente los efectos sobre la performance, el perfil de seguridad, los costos asociados y la mantenibilidad global.</requirement>
    <requirement>Limits & Boundaries: Formaliza las fronteras (boundaries) y dependencias entre los diversos módulos que interacúan.</requirement>
    <requirement>Observabilidad: Incluye un plan para monitoreo (métricas, alertas y telemetría estructurada, ej: JSON logging).</requirement>
    <requirement>Ciclo de vida (Release): Diseña el plan detallado para el Rollout (despliegue progresivo si aplica) y las instrucciones concretas de Rollback.</requirement>
  </architecture_checklist>

  <output_format>
    <description>Tus decisiones deben materializarse en la salida estándar de ARQ/SPEC (JSON), asegurando que se documenta la decisión.</description>
    <template>
```json
{
  "etapa": "SPEC",
  "item": "DOCUMENTO-ADR",
  "archivos_modificados": ["docs/architecture/adr-001.md"],
  "siguiente_accion": "Validación con el equipo técnico",
  "swarm_log": {
    "opcion_elegida": "PostgreSQL",
    "opcion_descartada": "MongoDB",
    "rollout_plan": "..."
  }
}
```
    </template>
  </output_format>
</skill>
