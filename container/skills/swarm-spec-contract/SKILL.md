---
name: swarm-spec-contract
description: Define especificación testeable, contrato API/datos, invariantes, edge cases, aceptación y riesgos.
---

<skill name="swarm-spec-contract">
  <intent>Entregar una especificación ejecutable por DEV sin ambigüedades, con contratos bien definidos y plan de pruebas.</intent>

  <spec_requirements>
    <requirement>Contexto y objetivo: qué problema resuelve y por qué es necesario.</requirement>
    <requirement>Contrato API/DTOs: inputs, outputs y errores documentados formalmente.</requirement>
    <requirement>Invariantes de negocio: condiciones que siempre deben cumplirse, independientemente del escenario.</requirement>
    <requirement>Edge cases: escenarios límite que podrían romper la implementación.</requirement>
    <requirement>Plan de pruebas verificable: qué se va a testear, cómo y cuál es el criterio de éxito.</requirement>
    <requirement>Riesgos y mitigaciones: qué puede salir mal y cómo se mitiga.</requirement>
  </spec_requirements>

  <output_format>
    <description>Tu salida de SPEC debe documentar el contrato y la decisión técnica en formato JSON.</description>
    <template>
```json
{
  "etapa": "SPEC",
  "item": "ID-TAREA",
  "archivos_modificados": ["docs/spec-xxx.md"],
  "siguiente_accion": "Pasar a DEV para implementación",
  "swarm_log": {
    "contrato_definido": true,
    "invariantes": ["..."],
    "edge_cases": ["..."],
    "riesgos": ["..."]
  }
}
```
    </template>
  </output_format>
</skill>
