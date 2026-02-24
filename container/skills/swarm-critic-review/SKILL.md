---
name: swarm-critic-review
description: Revisión crítica de salida por etapa para detectar gaps de evidencia, calidad y riesgos antes de marcar done.
---

<skill name="swarm-critic-review">
  <intent>Validar que la salida de cualquier etapa sea defendible y verificable antes de cerrar una card o avanzar de fase.</intent>

  <review_checklist>
    <requirement>Contrato completo: la salida incluye `etapa`, `item`, `archivos_modificados`, `siguiente_accion` y `swarm_log` como JSON válido.</requirement>
    <requirement>Evidencia concreta: los archivos listados en `archivos_modificados` existen realmente y fueron alterados.</requirement>
    <requirement>Evidencia de validación/test: cuando corresponde, hay un comando ejecutado y su resultado.</requirement>
    <requirement>Riesgos remanentes: se documentan explícitamente los riesgos técnicos que quedan abiertos.</requirement>
    <requirement>Próximos pasos técnicos: la `siguiente_accion` es concreta y ejecutable, no vaga.</requirement>
  </review_checklist>

  <verdict>
    <option name="PASS">La salida es suficiente para avanzar de etapa. La card puede cerrarse.</option>
    <option name="FAIL">Se bloquea el avance. Se listan los gaps accionables que deben resolverse antes de continuar.</option>
  </verdict>

  <output_format>
    <description>Tu resultado de revisión crítica debe emitirse como JSON estructurado.</description>
    <template>
```json
{
  "etapa": "CRITIC",
  "item": "ID-TAREA-REVISADA",
  "archivos_modificados": [],
  "siguiente_accion": "Aprobar y avanzar / Devolver a etapa X",
  "swarm_log": {
    "veredicto": "PASS|FAIL",
    "gaps_detectados": ["..."],
    "riesgos_remanentes": ["..."]
  }
}
```
    </template>
  </output_format>
</skill>
