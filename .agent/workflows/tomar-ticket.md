---
description: Toma un ticket CY-### del backlog, planifica y lo implementa en una rama
---
1. Pregúntame el número del ticket si no lo di (ej. CY-031). Lee el issue de GitHub (`gh issue list --search "CY-031" --json number,title,body`) o la fila en `backlog/backlog.csv`.
2. Resume los criterios de aceptación y lista dudas. Espera mi respuesta si hay ambigüedad.
3. Propón un plan corto: archivos a crear o modificar, pruebas y riesgos. Espera mi aprobación.
4. Actualiza `develop` y crea la rama: `git checkout develop && git pull && git checkout -b feature/CY-###-descripcion`.
5. Implementa en pasos pequeños con commits `tipo(alcance): descripción (CY-###)`.
6. Ejecuta lint, tests y build. Corrige hasta que pasen.
7. Abre el PR hacia `develop` con `gh pr create` usando la plantilla, y enlaza el issue (`Closes #n`).
8. Dame un resumen: qué hiciste, cómo probarlo, qué queda pendiente.
