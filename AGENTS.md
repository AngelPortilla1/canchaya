# CanchaYa - Contexto permanente para agentes (Antigravity, Claude Code, Codex, Cursor)

## Qué es

SaaS multi-recinto para reservar canchas (pádel y fútbol 5) principalmente por WhatsApp.
Cliente piloto: recinto en Pamplona, Colombia (2 canchas de pádel + 2 de fútbol 5).
Reservas de 60 min, $60.000 COP/hora, anticipo 20% por transferencia, saldo en el recinto
(efectivo, transferencia o mixto). Solo reprogramaciones, sin reembolsos.
Problema central: mensajes de WhatsApp sin responder, sobre todo de noche.
Propuesta de valor: "Nunca más pierdes una reserva por no contestar".

## Idioma

- Conversación, documentación, commits, issues y textos del bot: español (Colombia).
- Código (variables, funciones, tablas): inglés.

## Stack

- Next.js (App Router, TypeScript) para panel PWA y API routes
- Supabase (PostgreSQL, Auth, Row Level Security, pg_cron)
- Meta WhatsApp Cloud API (webhook propio)
- Reglas de negocio puras en `packages/core` (sin dependencias de framework)
- Pruebas: Vitest (unitarias), Playwright (e2e del panel, más adelante)
- CI/CD: GitHub Actions; despliegue en Vercel + Supabase

## Reglas innegociables

1. Multi-tenant: toda tabla de negocio lleva `tenant_id` y tiene RLS activada.
2. Nunca doble reserva: restricción de exclusión en PostgreSQL (tstzrange + GiST) por cancha.
3. Fechas en UTC en base de datos; se muestran en America/Bogota.
4. Sin secretos en el código. Usar variables de entorno; nunca imprimir tokens en logs.
5. Sin datos personales (teléfonos, nombres) en logs de aplicación.
6. Webhooks idempotentes (un mismo mensaje de Meta no se procesa dos veces) y con validación de firma.
7. Dinero en COP como entero (pesos), nunca decimales flotantes.
8. Todo cambio de esquema va en una migración versionada en `supabase/migrations`.

## Flujo de trabajo (ver docs/plan.md para el plan completo)

- Tickets: prefijo CY-###, viven como issues de GitHub. Backlog en `backlog/backlog.csv`.
- Ramas: `feature/CY-###-descripcion` o `fix/CY-###-descripcion` desde `develop`.
  `hotfix/CY-###-...` desde `main`. NUNCA push directo a `main` ni `develop`.
- Commits (Conventional Commits): `tipo(alcance): descripción (CY-###)`.
  Tipos: feat, fix, docs, refactor, test, chore, ci, perf.
- Un PR por ticket, pequeño, con la plantilla de `.github/pull_request_template.md`.
- Definition of Done: criterios de aceptación cumplidos, pruebas donde hay lógica de negocio,
  CI en verde, verificado en staging, docs/ADR actualizados.

## Cómo trabajar un ticket

1. Lee el issue completo y sus criterios de aceptación. Si algo es ambiguo, pregunta; no inventes requisitos.
2. Para cambios no triviales, propón un plan corto (archivos que tocarás, riesgos) ANTES de escribir código.
3. Crea la rama, implementa en pasos pequeños, escribe pruebas junto al código.
4. Ejecuta lint, tests y build localmente antes de abrir el PR.
5. Registra decisiones de arquitectura en `docs/adr/` usando la plantilla.
6. Nunca marques un ticket como terminado sin ejecutar las pruebas.

## Límites del agente

- No instales dependencias nuevas importantes sin justificarlo en el PR.
- No modifiques migraciones ya aplicadas; crea una nueva.
- No toques `.github/workflows` ni reglas de protección sin que el ticket lo pida.
- Si una tarea requiere acceso a cuentas externas (Meta, pasarela), detente y dame los pasos manuales.

## Documentación

`docs/plan.md` (plan), `docs/requisitos.md` (RF/RNF), `docs/adr/` (decisiones), `backlog/backlog.csv` (tickets).
