# Plan de trabajo: Sistema de reservas de canchas (CanchaYa)

*Nombre provisional. Versión 1.0, 26 de octubre de 2026. Autor: tú, en todos los roles.*

## 1. Contexto y hechos confirmados

- Recinto en Pamplona (Colombia): 2 canchas de pádel y 2 de fútbol 5. Reservas de 60 minutos a **$60.000 COP** la hora, precio fijo.
- Horario: desde temprano en la tarde hasta las 12 a.m. Se estiman unas 15 reservas diarias, concentradas en la noche.
- Hoy todo se hace por WhatsApp Business con un solo empleado. Se paga el 20% de anticipo por transferencia y el resto en el recinto (efectivo, transferencia o mixto). No hay reembolsos, solo reprogramaciones.
- **Problema principal:** mensajes sin respuesta, sobre todo fuera de horario. Lo comprobaste en carne propia al intentar reservar.
- Venta objetivo: mensualidad (SaaS), con diseño multi-recinto desde el día uno.
- Pendiente: hablar con el dueño (reservas perdidas, no-shows, número de WhatsApp, piloto).

**Propuesta de valor:** *"Nunca más pierdes una reserva por no contestar."*

**Supuestos a validar con el dueño:** que el número de WhatsApp sea exclusivo del recinto, que acepte un piloto gratis de 1 a 2 meses y que el empleado esté dispuesto a usar un panel.

## 2. Equipo simulado y forma de trabajo

Eres un solo desarrollador, pero cada ticket se atiende con un "sombrero" distinto para mantener disciplina y trazabilidad.

| Rol | Qué hace en el proyecto | Artefacto que produce |
| --- | --- | --- |
| Product Owner | Prioriza el backlog, define valor y criterios de aceptación | Backlog, roadmap |
| Analista de negocio | Entrevista al dueño y al empleado, redacta requisitos | Documento de requisitos |
| Diseñador UX/UI | Flujos de conversación del bot, pantallas del panel | Wireframes en Figma o papel |
| Arquitecto | Decisiones técnicas y registro de decisiones (ADR) | Carpeta `docs/adr` |
| Desarrollador backend | Base de datos, API, integraciones | Código y migraciones |
| Desarrollador frontend | Panel PWA | Código |
| QA | Casos de prueba, pruebas de concurrencia, pruebas con el bot | Plan de pruebas |
| DevOps | CI/CD, ambientes, monitoreo, respaldos | Workflows de GitHub Actions |
| Soporte / Customer Success | Capacitación, onboarding, métricas del piloto | Manual de usuario, reporte de piloto |

**Cadencia (sprints de 2 semanas, medio tiempo, unas 15 a 20 horas por semana):**

- Lunes: planificación del sprint (30 min). Escoges tickets del backlog según capacidad.
- Diario: nota breve en el tablero (qué hice, qué sigue, bloqueos).
- Viernes de cierre de sprint: demo grabada (aunque sea para ti), revisión y retrospectiva de 20 minutos con tres preguntas: qué salió bien, qué no, qué cambio.
- Capacidad sugerida: 20 a 25 puntos de historia por sprint. Ajusta con tu velocidad real después de los dos primeros sprints.

**Escala de estimación (puntos):** 1 = menos de 1 hora, 2 = medio día, 3 = un día, 5 = 2 a 3 días, 8 = una semana (si pasa de 8, divide el ticket).

## 3. Fases e hitos

| Fase | Objetivo | Duración estimada | Hito de salida |
| --- | --- | --- | --- |
| 0. Descubrimiento | Validar el problema y cerrar acuerdo de piloto | 2 semanas (en paralelo con la Fase 1) | Reunión con el dueño y acuerdo de piloto |
| 1. Fundaciones | Repositorio, CI, base de datos, auth multi-recinto | Sprint 1 | Esquema desplegado en staging |
| 2. Núcleo de reservas y panel | Calendario, reservas sin dobles, panel del empleado | Sprints 2 y 3 | El empleado gestiona reservas desde el panel |
| 3. Bot de WhatsApp (MVP) | Atención 24/7, bloqueo temporal, anticipo con comprobante | Sprints 4 a 6 | Piloto en producción |
| 4. Piloto | Operar con el recinto real y medir | 4 a 8 semanas | Informe con métricas y decisión de mensualidad |
| 5. Pagos y retención | Pasarela, recordatorios, reservas fijas, lista de espera | Sprints 7 a 9 | Anticipo confirmado automáticamente |
| 6. Operación completa | Caja, confitería, alquiler de equipos, reportes | Sprints 10 a 12 | Dueño cierra el día solo con el sistema |
| 7. Replicación | Onboarding de nuevos recintos, facturación, marketing | Continuo | Segundo recinto activo |

Regla de oro: **no empieces la Fase 5 hasta tener datos reales del piloto.**

## 4. Requisitos

### 4.1 Requisitos funcionales (RF)

**Reservas**

- RF-01: El sistema muestra disponibilidad por deporte, cancha, fecha y hora (bloques de 60 min).
- RF-02: Un cliente puede crear una reserva con nombre y teléfono, y la hora queda bloqueada temporalmente (15 min) hasta recibir el anticipo.
- RF-03: Si el anticipo no llega en el plazo, la reserva expira y la hora se libera automáticamente.
- RF-04: Es imposible que dos reservas confirmadas se superpongan en la misma cancha.
- RF-05: Se permite reprogramar hasta X horas antes (configurable por recinto). No hay reembolsos; el anticipo se conserva para la nueva fecha.
- RF-06: Un cliente puede cancelar; el anticipo queda como crédito o se pierde según la política del recinto.

**Pagos**

- RF-07: El precio por hora y el porcentaje de anticipo (20%) son configurables por recinto y por deporte.
- RF-08: El cliente envía el comprobante del anticipo por WhatsApp; el empleado lo valida con un toque en el panel.
- RF-09: El saldo se registra en el recinto con método de pago: efectivo, transferencia o mixto.
- RF-10: Cierre de caja diario con totales por método de pago.

**Bot de WhatsApp**

- RF-11: El bot atiende 24/7: saluda, pregunta deporte, fecha y hora, muestra opciones y confirma.
- RF-12: Ante algo que el bot no entiende, ofrece hablar con una persona y marca la conversación para el empleado.
- RF-13: Envía recordatorios antes del partido y confirmaciones de reserva, reprogramación y cancelación.

**Panel del empleado y del dueño**

- RF-14: Calendario de las 4 canchas por día, con estado (bloqueada, pendiente de anticipo, confirmada, jugada, no-show).
- RF-15: El empleado puede crear, mover y cancelar reservas manualmente (clientes que llegan o llaman).
- RF-16: Roles: dueño (todo) y empleado (operación diaria, sin reportes financieros).
- RF-17: Reportes: ocupación por cancha y hora, ingresos, no-shows, clientes frecuentes.

**Fase posterior**

- RF-18: Reservas fijas semanales y lista de espera.
- RF-19: Venta de confitería y alquiler de raquetas y balones con inventario básico.
- RF-20: Pasarela de pagos con confirmación automática del anticipo.
- RF-21: Torneos relámpago (inscripción, cobro y llaves).

### 4.2 Requisitos no funcionales (RNF)

- RNF-01 Disponibilidad: 99% mensual en horario de operación; el bot nunca debe quedar mudo sin aviso.
- RNF-02 Rendimiento: respuesta del bot en menos de 3 segundos en el 95% de los casos.
- RNF-03 Seguridad y privacidad: aislamiento de datos por recinto (Row Level Security), cumplimiento de la Ley 1581 de 2012 de protección de datos (consentimiento y política de tratamiento) y manejo seguro de tokens.
- RNF-04 Mensajería: respetar las políticas de Meta (plantillas aprobadas, consentimiento, ventana de 24 horas).
- RNF-05 Usabilidad: el panel debe usarse desde un celular y con capacitación de menos de 30 minutos.
- RNF-06 Mantenibilidad: cobertura de pruebas en reglas críticas (disponibilidad, bloqueos, precios), migraciones versionadas.
- RNF-07 Observabilidad: logs de cada mensaje y reserva, alertas de errores y de caída del webhook.
- RNF-08 Respaldo: copia diaria de la base de datos y prueba de restauración.
- RNF-09 Zona horaria: todo se guarda en UTC y se muestra en America/Bogota.
- RNF-10 Costos: infraestructura inferior a 100 USD al mes con un solo recinto.

## 5. Backlog de tickets

Prefijo de tickets: **CY-###**. Tipos: Épica, Historia, Tarea, Bug, Spike (investigación acotada por tiempo). Etiquetas de rol: `rol:backend`, `rol:frontend`, `rol:ux`, `rol:qa`, `rol:devops`, `rol:negocio`.

### Épica E0: Descubrimiento (Fase 0)

| ID | Tipo | Título y criterio de aceptación | Pts |
| --- | --- | --- | --- |
| CY-001 | Tarea | Preparar guion de entrevista con el dueño. Incluye las 5 preguntas pendientes y la propuesta de piloto. | 1 |
| CY-002 | Tarea | Reunión con el dueño. Se obtienen: reservas perdidas estimadas, no-shows, número de WhatsApp, acuerdo de piloto. | 2 |
| CY-003 | Tarea | Observar al empleado una noche de operación. Se documenta el flujo real y los puntos de dolor. | 2 |
| CY-004 | Spike | Verificar WhatsApp Business: coexistencia app y API, costos actuales por mensaje y requisitos de verificación de Meta. Conclusión escrita en un ADR. | 3 |
| CY-005 | Tarea | Definir política del piloto: duración, métricas, costo después, qué pasa si no funciona. Documento de una página. | 1 |

### Épica E1: Fundaciones (Sprint 1)

| ID | Tipo | Título y criterio de aceptación | Pts |
| --- | --- | --- | --- |
| CY-010 | Tarea | Crear repositorio, README, LICENSE, `.gitignore`, `CODEOWNERS` y plantillas de issue y PR. | 2 |
| CY-011 | Tarea | Configurar protección de ramas y tablero de GitHub Projects (sección 6). | 1 |
| CY-012 | Tarea | Inicializar Next.js (TypeScript), ESLint, Prettier y estructura de carpetas. | 2 |
| CY-013 | Tarea | Crear proyectos Supabase `staging` y `production` con variables de entorno gestionadas. | 2 |
| CY-014 | Tarea | Pipeline de CI: lint, tests y build en cada PR. Falla si algo falla. | 3 |
| CY-015 | Tarea | Despliegue automático: `develop` a staging, `main` a producción. | 3 |
| CY-016 | Historia | Esquema inicial: `tenants` (recintos), `courts`, `sports`, `pricing`, `customers`, `bookings`, `payments`, `users`. Migraciones versionadas. | 5 |
| CY-017 | Historia | Restricción de exclusión en PostgreSQL (`tstzrange` con GiST) para impedir superposición en una misma cancha. Test que intenta forzar una doble reserva y falla. | 3 |
| CY-018 | Historia | Row Level Security por `tenant_id`. Test: un usuario del recinto A no ve datos del recinto B. | 5 |
| CY-019 | Tarea | Autenticación y roles (dueño y empleado). | 3 |
| CY-020 | Tarea | ADR-001 (stack), ADR-002 (multi-tenant), ADR-003 (manejo de zonas horarias). | 2 |
| CY-021 | Tarea | Datos semilla: recinto de prueba con 4 canchas y precios de $60.000. | 1 |

### Épica E2: Núcleo de reservas y panel (Sprints 2 y 3)

| ID | Tipo | Título y criterio de aceptación | Pts |
| --- | --- | --- | --- |
| CY-030 | Historia | Servicio de disponibilidad: dado deporte y fecha, devuelve horas libres según horario del recinto y reservas existentes. Pruebas unitarias con casos borde (medianoche, bloqueos expirados). | 5 |
| CY-031 | Historia | Crear reserva con estado `HOLD` y vencimiento a 15 min. | 3 |
| CY-032 | Historia | Job que expira reservas `HOLD` vencidas y libera la hora (cron o pg\_cron). | 3 |
| CY-033 | Historia | Máquina de estados de reserva: HOLD, CONFIRMED, COMPLETED, NO\_SHOW, CANCELLED, RESCHEDULED. Transiciones inválidas rechazadas. | 3 |
| CY-034 | Historia | Reprogramación con regla configurable (horas mínimas de antelación) que conserva el anticipo. | 5 |
| CY-035 | UX | Wireframes del panel: calendario diario, detalle de reserva, listado de pendientes. Revisados con el empleado. | 3 |
| CY-036 | Historia | Pantalla de calendario de 4 canchas por día (vista celular y escritorio). | 8 |
| CY-037 | Historia | Crear, mover y cancelar reservas manualmente desde el panel. | 5 |
| CY-038 | Historia | Cola de "anticipos por validar" con comprobante y botón aprobar o rechazar. | 5 |
| CY-039 | Historia | Registro del saldo en el recinto (efectivo, transferencia, mixto) y marcado como jugada. | 5 |
| CY-040 | Historia | Configuración del recinto: horarios, canchas, precios, porcentaje de anticipo y política de reprogramación. | 5 |
| CY-041 | Tarea | Convertir el panel en PWA instalable. | 2 |
| CY-042 | QA | Prueba de concurrencia: 50 intentos simultáneos sobre la misma hora, solo uno gana. | 3 |

### Épica E3: Bot de WhatsApp, MVP (Sprints 4 a 6)

| ID | Tipo | Título y criterio de aceptación | Pts |
| --- | --- | --- | --- |
| CY-050 | UX | Diseñar el flujo conversacional completo (reservar, consultar, reprogramar, cancelar, hablar con humano) con textos en español colombiano natural. | 5 |
| CY-051 | Tarea | Registrar app en Meta, configurar número de pruebas y webhook verificado. | 3 |
| CY-052 | Historia | Recibir mensajes por webhook con validación de firma, idempotencia (no procesar dos veces) y registro en tabla `messages`. | 5 |
| CY-053 | Historia | Enviar mensajes de texto, botones y listas interactivas. | 3 |
| CY-054 | Historia | Motor de conversación con estado por cliente (sesión) y manejo de timeouts. | 8 |
| CY-055 | Historia | Flujo "reservar": deporte, fecha, hora, resumen, creación del `HOLD` y datos de pago del anticipo. | 8 |
| CY-056 | Historia | Recepción del comprobante (imagen) y aviso al empleado en el panel. | 5 |
| CY-057 | Historia | Notificar al cliente la confirmación o el rechazo del anticipo. | 3 |
| CY-058 | Historia | Flujos de consulta, reprogramación y cancelación. | 5 |
| CY-059 | Historia | Transferencia a humano: marca la conversación y alerta al empleado; el bot se silencia en ese chat. | 5 |
| CY-060 | Historia | Aviso de consentimiento y política de tratamiento de datos en el primer mensaje. | 2 |
| CY-061 | Historia | Plantillas de Meta aprobadas (confirmación, recordatorio) para mensajes fuera de la ventana de 24 h. | 3 |
| CY-062 | Tarea | Alertas: webhook caído, tasa alta de errores, token por vencer. | 3 |
| CY-063 | QA | Pruebas de conversación con 10 guiones (camino feliz, cambios de idea, mensajes raros, audios, spam). | 5 |
| CY-064 | Tarea | Manual del empleado de una página y capacitación de 30 minutos. | 2 |
| CY-065 | Tarea | Corte a producción: migración del número, plan de contingencia (volver al modo manual en 5 minutos). | 3 |

### Épica E4: Piloto (4 a 8 semanas)

| ID | Tipo | Título y criterio de aceptación | Pts |
| --- | --- | --- | --- |
| CY-070 | Tarea | Definir y medir indicadores: mensajes fuera de horario atendidos, reservas creadas por el bot, tasa de conversión, no-shows, tiempo ahorrado. | 3 |
| CY-071 | Tarea | Revisión semanal con el dueño y el empleado, con lista de ajustes. | 1 por semana |
| CY-072 | Bug | Reserva de bugs del piloto con SLA: críticos en 24 horas. | variable |
| CY-073 | Tarea | Informe final del piloto y propuesta de mensualidad con cifras reales. | 3 |

### Épica E5: Pagos y retención (Sprints 7 a 9)

| ID | Tipo | Título y criterio de aceptación | Pts |
| --- | --- | --- | --- |
| CY-080 | Spike | Comparar pasarelas (Wompi, Bold, Mercado Pago, ePayco) y Bre-B: comisiones actuales, liquidación, API y link de pago. ADR de decisión. | 3 |
| CY-081 | Historia | Link de pago del anticipo generado por reserva, con webhook que confirma automáticamente. | 8 |
| CY-082 | Historia | Conciliación: pagos recibidos contra reservas, alertas de pagos huérfanos. | 5 |
| CY-083 | Historia | Recordatorios automáticos 24 h y 2 h antes, con opción de confirmar o reprogramar. | 5 |
| CY-084 | Historia | Reservas fijas semanales para equipos recurrentes. | 8 |
| CY-085 | Historia | Lista de espera: al liberarse una hora se avisa al primero de la fila. | 5 |
| CY-086 | Historia | Marca de no-show y estadística por cliente. | 3 |

### Épica E6: Operación completa (Sprints 10 a 12)

| ID | Tipo | Título y criterio de aceptación | Pts |
| --- | --- | --- | --- |
| CY-090 | Historia | Cierre de caja diario por método de pago, con diferencia contra lo esperado. | 5 |
| CY-091 | Historia | Catálogo de confitería e inventario básico con alerta de bajo stock. | 8 |
| CY-092 | Historia | Alquiler de raquetas y balones asociado a la reserva. | 5 |
| CY-093 | Historia | Reportes del dueño: ocupación por cancha y hora, ingresos, clientes frecuentes. | 8 |
| CY-094 | Historia | Exportación a Excel o CSV. | 2 |
| CY-095 | Historia | Torneos relámpago: inscripción, cobro y llaves (solo si el dueño lo pide). | 13, dividir |

### Épica E7: Replicación y negocio

| ID | Tipo | Título y criterio de aceptación | Pts |
| --- | --- | --- | --- |
| CY-100 | Historia | Onboarding de un nuevo recinto desde un asistente: canchas, precios, horarios, número de WhatsApp. | 8 |
| CY-101 | Historia | Facturación de la mensualidad (cobro recurrente) y control de suspensión por impago. | 8 |
| CY-102 | Tarea | Términos y condiciones, política de privacidad y contrato de servicio (revisión con abogado). | 3 |
| CY-103 | Tarea | Página de aterrizaje, demo y caso de éxito del piloto. | 5 |
| CY-104 | Tarea | Lista de 20 recintos objetivo en Pamplona, Cúcuta, Bucaramanga y alrededores, con plan de contacto. | 3 |

## 6. Configuración de GitHub

### 6.1 Repositorio y estructura

Un solo repositorio (monorepo) para empezar:

```
canchaya/
├── apps/
│   └── web/                # Next.js: panel y API
├── packages/
│   └── core/               # reglas de negocio (disponibilidad, precios, estados)
├── supabase/
│   ├── migrations/         # SQL versionado
│   └── seed.sql
├── docs/
│   ├── adr/                # decisiones de arquitectura
│   ├── requisitos.md
│   └── runbook.md          # qué hacer si algo se cae
├── .github/
│   ├── workflows/          # CI/CD
│   ├── ISSUE_TEMPLATE/
│   ├── pull_request_template.md
│   └── CODEOWNERS
└── README.md
```

Separa las reglas de negocio en `packages/core` sin dependencias de framework: son lo más importante y lo que más pruebas necesita.

### 6.2 Estrategia de ramas (GitFlow simplificado)

| Rama | Propósito | Se crea desde | Se integra a | Ambiente |
| --- | --- | --- | --- | --- |
| `main` | Código en producción, siempre estable | n/a | n/a | Producción |
| `develop` | Integración de lo que viene | `main` | `main` por release | Staging |
| `feature/CY-###-descripcion` | Una historia o tarea | `develop` | `develop` | Preview |
| `fix/CY-###-descripcion` | Corrección de bug no urgente | `develop` | `develop` | Preview |
| `hotfix/CY-###-descripcion` | Error crítico en producción | `main` | `main` y `develop` | Producción |
| `release/vX.Y.Z` | Congelar versión y probar (opcional) | `develop` | `main` | Staging |

Ejemplo: `feature/CY-055-flujo-reservar-bot`.

**Reglas:**

1. Nadie hace push directo a `main` ni a `develop`; todo entra por Pull Request, aunque seas tú solo.
2. Un PR por ticket, pequeño (idealmente menos de 400 líneas).
3. `feature` y `fix` se integran a `develop` con **squash merge** para mantener historial limpio.
4. `develop` a `main` con **merge commit** al cerrar cada sprint o release, y se crea un tag (`v0.1.0`, `v0.2.0`...).
5. Un `hotfix` se fusiona a `main`, se etiqueta y se vuelve a fusionar a `develop`.
6. Se borra la rama automáticamente tras fusionar.

### 6.3 Protección de ramas (Settings, Branches)

Para `main` y `develop`:

- Requerir Pull Request antes de fusionar.
- Requerir que pasen los checks de CI (lint, test, build).
- Requerir que la rama esté actualizada.
- Requerir resolución de conversaciones.
- Bloquear force push y borrado.
- Para `main`: incluir a los administradores en la regla. Con un solo desarrollador, quizá no puedas exigir otra aprobación, así que haz una **autorrevisión con lista de verificación** en la plantilla del PR.

### 6.4 Convención de commits (Conventional Commits)

Formato: `tipo(alcance): descripción (CY-###)`

Tipos: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`.

Ejemplos:

- `feat(bookings): bloquear hora con HOLD de 15 min (CY-031)`
- `fix(bot): evitar respuesta duplicada por webhook repetido (CY-052)`

Esto permite generar el changelog y las versiones de forma automática (por ejemplo con release-please).

### 6.5 Plantilla de Pull Request

```
## Qué cambia
(resumen en 2-3 líneas)

## Ticket
Closes #<número> / CY-###

## Cómo probarlo
(pasos)

## Lista de verificación
- [ ] Cumple los criterios de aceptación
- [ ] Pruebas agregadas o actualizadas
- [ ] Migración probada hacia adelante (y plan de reversa)
- [ ] Sin secretos en el código
- [ ] Documentación o ADR actualizados si aplica
- [ ] Probado en staging
```

### 6.6 Plantillas de issues

- **Historia de usuario:** "Como \[rol\], quiero \[acción\] para \[beneficio\]", criterios de aceptación en formato Dado/Cuando/Entonces, estimación y dependencias.
- **Bug:** pasos para reproducir, resultado esperado y real, severidad, capturas, ambiente.
- **Spike:** pregunta a responder, límite de tiempo, entregable (ADR).
- **Tarea técnica:** objetivo, alcance, definición de terminado.

### 6.6.1 Etiquetas (labels)

- Tipo: `type:story`, `type:bug`, `type:task`, `type:spike`
- Rol: `rol:backend`, `rol:frontend`, `rol:ux`, `rol:qa`, `rol:devops`, `rol:negocio`
- Prioridad: `P0` (crítico), `P1`, `P2`, `P3`
- Fase: `fase:1`, `fase:2`... y `epic:E1`...
- Estado especial: `blocked`, `needs-info`

### 6.7 Tablero de GitHub Projects

Columnas: **Backlog, Listo (Ready), En progreso, En revisión, En pruebas (staging), Hecho**. Campos personalizados: Sprint, Puntos, Épica, Prioridad. Límite sugerido de trabajo en progreso: 2 tickets a la vez.

Usa *milestones* para las fases (por ejemplo "Fase 3: MVP bot") y automatiza el movimiento de tarjetas al abrir y cerrar PRs.

### 6.8 CI/CD con GitHub Actions

| Workflow | Se dispara | Qué hace |
| --- | --- | --- |
| `ci.yml` | PR a `develop` o `main` | Instala, lint, typecheck, tests unitarios, build |
| `db-check.yml` | PR con cambios en `supabase/` | Aplica migraciones en una base efímera y corre tests de RLS y de exclusión |
| `deploy-staging.yml` | Push a `develop` | Aplica migraciones y despliega a staging |
| `deploy-prod.yml` | Push a `main` o tag | Aplica migraciones y despliega a producción, con aprobación manual del ambiente |
| `release.yml` | Merge a `main` | Genera tag, changelog y release notes |
| `security.yml` | Semanal y en PR | Dependabot, escaneo de secretos y dependencias |

Los secretos (tokens de Meta, claves de Supabase y de la pasarela) van en **GitHub Environments** (`staging`, `production`), nunca en el código.

### 6.9 Versionado y releases

Versionado semántico: `0.x` mientras sea piloto, `1.0.0` cuando pase a mensualidad. Cada fin de sprint se hace release desde `develop` a `main`, con notas escritas en lenguaje de negocio para el dueño.

## 7. Definiciones de calidad

**Definition of Ready (un ticket puede entrar al sprint si):**

- Tiene historia de usuario y criterios de aceptación claros.
- Está estimado (8 puntos o menos).
- Sus dependencias están resueltas o identificadas.
- Tiene diseño o flujo si toca interfaz o conversación.

**Definition of Done (un ticket está terminado si):**

- Cumple todos los criterios de aceptación.
- Tiene pruebas automatizadas donde hay lógica de negocio.
- Pasó CI y fue fusionado por PR.
- Está desplegado y verificado en staging.
- La documentación necesaria está actualizada.
- No introduce secretos ni datos personales en logs.

## 8. Riesgos y mitigación

| Riesgo | Prob. | Impacto | Mitigación |
| --- | --- | --- | --- |
| El dueño no acepta el piloto | Media | Alto | Ofrecer piloto gratis, demostración con datos reales y compromiso de reversa en minutos |
| Meta bloquea o limita el número | Baja | Muy alto | Seguir políticas, plantillas aprobadas, plan de contingencia manual (CY-065) |
| Costos de mensajería superiores a lo previsto | Media | Medio | Priorizar mensajes iniciados por el cliente; medir costo por reserva en el piloto |
| Comprobantes falsos o mal validados | Media | Medio | Validación manual en MVP, pasarela y conciliación en Fase 5 |
| Dobles reservas | Baja | Alto | Restricción en base de datos y prueba de concurrencia (CY-017, CY-042) |
| Empleado no adopta el panel | Media | Alto | Capacitación corta, diseño con su participación, modo "manual" siempre disponible |
| Competencia (Playtomic y otras) | Media | Medio | Diferenciarse por trabajar dentro de WhatsApp y por soporte local |
| Mercado pequeño en Pamplona | Alta | Medio | Diseño multi-recinto y plan de expansión regional (CY-104) |
| Datos personales mal manejados | Baja | Alto | Consentimiento, política de tratamiento, acceso por roles, registro mínimo |
| Agotamiento por ser un solo desarrollador | Media | Medio | Alcance pequeño por sprint, horas fijas, retrospectivas honestas |

## 9. Cronograma orientativo

| Sprint | Semanas | Enfoque | Resultado visible |
| --- | --- | --- | --- |
| 0 | 1 y 2 | Descubrimiento (E0) y arranque de E1 | Reunión con el dueño |
| 1 | 1 a 2 | Fundaciones (E1) | Esquema y CI funcionando |
| 2 | 3 a 4 | Reservas núcleo (E2) | API de disponibilidad y holds |
| 3 | 5 a 6 | Panel (E2) | Empleado ve y gestiona el calendario |
| 4 | 7 a 8 | Bot: webhook y mensajes (E3) | El bot responde en un número de prueba |
| 5 | 9 a 10 | Bot: flujo de reserva y comprobantes (E3) | Reserva completa por WhatsApp |
| 6 | 11 a 12 | Bot: humano, alertas, pruebas y corte (E3) | Salida a producción del piloto |
| Piloto | 13 a 20 | Operación real y ajustes (E4) | Informe con métricas |
| 7 a 9 | 21 a 26 | Pagos y retención (E5) | Anticipo automático |
| 10 a 12 | 27 a 32 | Operación completa (E6) | Cierre de caja y reportes |

Es un cronograma de unos **8 meses** con medio tiempo. Si tu disponibilidad es mayor, se acorta; si el dueño pide ajustes en el piloto, se alarga. Lo importante es llegar al piloto cuanto antes.

## 10. Próximos pasos (esta semana)

1. Ejecutar CY-001: preparar el guion y buscar al dueño (aprovecha que eres cliente del recinto; pregúntale al empleado cómo contactarlo).
2. Ejecutar CY-010, CY-011 y CY-012: crear el repositorio, las ramas, la protección y el tablero con estos tickets cargados.
3. Hacer el spike CY-004 sobre WhatsApp Business y coexistencia, porque define la arquitectura del bot.
4. Redactar los tres primeros ADR.
5. Cargar este backlog como issues de GitHub. Puedo prepararte un archivo CSV o un script con la CLI de GitHub (`gh`) que cree etiquetas, milestones e issues de una sola vez.
