---
name: swarm-pm-planning
description: Crea backlog atómico en todo.md con tareas verificables, dependencias explícitas y orden ejecutable.
---

<skill name="swarm-pm-planning">
  <intent>Construir y ajustar el backlog en formato ejecutable, sin tareas vagas ni ambiguas.</intent>

  <planning_checklist>
    <requirement>Scope funcional claro: qué SÍ entra y qué NO entra en el alcance de la tarea.</requirement>
    <requirement>Criterios de done binarios: cada criterio debe ser evaluable como PASS o FAIL, sin ambigüedad.</requirement>
    <requirement>Dependencias explícitas: si una tarea depende de otra, debe estar declarada formalmente.</requirement>
    <requirement>Priorización por impacto y riesgo: las tareas de mayor impacto y mayor riesgo van primero.</requirement>
    <requirement>Descripción suficientemente concreta para implementación directa por un DEV sin preguntas adicionales.</requirement>
  </planning_checklist>

  <output_format>
    <description>Tu salida de PM debe materializarse en el backlog y en el JSON de cierre.</description>
    <template>
```json
{
  "etapa": "PM",
  "item": "ID-TAREA",
  "archivos_modificados": ["todo.md"],
  "siguiente_accion": "Pasar a SPEC o DEV",
  "swarm_log": {
    "tareas_creadas": 3,
    "dependencias": ["TASK-001 -> TASK-002"],
    "riesgo_detectado": "..."
  }
}
```
    </template>
  </output_format>
</skill>
