---
description: Autorrevisión crítica de la rama actual antes de abrir o fusionar un PR
---

1. Ejecuta `git diff develop...HEAD` y revisa el cambio completo.
2. Verifica contra el issue: ¿cada criterio de aceptación está cubierto y probado?
3. Revisa seguridad: secretos, RLS con `tenant_id`, datos personales en logs, validación de firma en webhooks.
4. Revisa lógica de dinero (enteros COP) y fechas (UTC en base de datos, America/Bogota al mostrar).
5. Revisa concurrencia: ¿podría producir doble reserva o doble procesamiento de un mensaje?
6. Ejecuta lint, tests y build.
7. Entrega una lista: problemas críticos, mejoras sugeridas, y qué falta probar. No hagas cambios sin mi confirmación.
