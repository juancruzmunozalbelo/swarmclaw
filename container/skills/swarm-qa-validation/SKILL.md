---
name: swarm-qa-validation
description: Valida comportamiento con pruebas reproducibles, severidad de hallazgos y criterio claro de pase/falla.
---

<skill name="swarm-qa-validation">
  <intent>Emitir validación objetiva con evidencia reproducible sobre el comportamiento del sistema.</intent>

  <validation_checklist>
    <requirement>Happy path: verifica que la funcionalidad principal funciona como se espera.</requirement>
    <requirement>Edge cases críticos: testea los límites y escenarios no-felices más probables.</requirement>
    <requirement>Comandos ejecutados: documenta exactamente qué se corrió y con qué input.</requirement>
    <requirement>Resultado esperado vs obtenido: contrasta explícitamente ambos valores.</requirement>
    <requirement>Severidad y causa probable: si hay fallo, clasifícalo (ALTA/MEDIA/BAJA) y propone la causa raíz.</requirement>
    <requirement>Recomendación concreta de fix: no solo reportes el bug, sugiere una solución accionable.</requirement>
  </validation_checklist>

  <output_format>
    <description>Tu salida de QA debe incluir la evidencia y el veredicto en formato JSON.</description>
    <template>
```json
{
  "etapa": "QA",
  "item": "ID-TAREA",
  "archivos_modificados": [],
  "siguiente_accion": "Certificar y continuar / Revertir a DEV",
  "swarm_log": {
    "happy_path": "PASS",
    "edge_cases": "PASS|FAIL",
    "severidad": "Ninguna|Alta|Media|Baja",
    "causa_probable": "...",
    "recomendacion_fix": "..."
  }
}
```
    </template>
  </output_format>
</skill>
