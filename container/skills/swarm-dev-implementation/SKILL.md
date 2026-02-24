---
name: swarm-dev-implementation
description: Implementa cambios de forma incremental, validada visualmente, y con demos de calidad profesional.
---

<skill name="swarm-dev-implementation">
  <intent>Implementar código de forma robusta, validarlo visualmente y entregar demostraciones de calidad profesional que asombren al usuario.</intent>
  
  <implementation_rules>
    <rule>Implementa en micro-lotes. Evita refactors que no estén dentro del alcance de tu tarea.</rule>
    <rule>Asegura un manejo de errores explícito y tests mínimos por cada cambio crítico.</rule>
    <rule>Reporta cada archivo creado o modificado con una línea clara de contexto.</rule>
  </implementation_rules>

  <demo_quality_standard>
    <requirement>Diseño Premium: Usa colores armónicos, tipografía moderna, y un espaciado correcto. No entregues MVPs rotos.</requirement>
    <requirement>Cero Errores Visibles: Asegúrate de que no haya CSS roto, páginas en blanco, ni elementos superpuestos.</requirement>
    <requirement>Datos Realistas: Utiliza mocks de datos que parezcan de producción, no "Lorem Ipsum".</requirement>
    <requirement>Responsive: Debe funcionar y verse excelente como mínimo en formato desktop.</requirement>
  </demo_quality_standard>

  <validation_steps>
    <step>Ejecuta <action type="Bash">npm run build</action> y confirma que termina satisfactoriamente sin fallos.</step>
    <step>Abre la interfaz visualmente (browser) y verifica que carga íntegramente de forma visual.</step>
    <step>Resuelve cualquier error presente en la consola o capa (overlay) de errores ANTES de reportar que has terminado.</step>
  </validation_steps>

  <constraints>
    <forbidden>Declarar "build exitoso" u "ok" sin confirmar efectivamente que la interfaz visual carga adecuadamente.</forbidden>
    <forbidden>Entregar o mostrar demostraciones con diseño roto o nulo.</forbidden>
    <forbidden>Generar archivos huecos o sin justificar su uso.</forbidden>
    <forbidden>Silenciar errores de compilación o ejecución.</forbidden>
  </constraints>

  <output_format>
    <description>Tu actualización de progreso debe ser un JSON estructurado según el rol de DEV.</description>
    <template>
```json
{
  "etapa": "DEV",
  "item": "ID-TAREA",
  "archivos_modificados": ["..."],
  "siguiente_accion": "...",
  "swarm_log": { "validacion_visual": "ok", "checklist": "..." }
}
```
    </template>
  </output_format>
</skill>
