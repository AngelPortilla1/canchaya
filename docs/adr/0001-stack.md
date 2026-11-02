# 0001. Stack tecnológico y estructura de monorepo

- Estado: aceptada (revisable tras el piloto)
- Fecha: 2026-10-26

## Contexto

CanchaYa es un SaaS multi-recinto para reservar canchas deportivas (pádel y fútbol 5) principalmente por WhatsApp, con un panel web progresivo (PWA) para que el empleado y el dueño gestionen la operación diaria (calendario, validación de anticipos, cobro de saldos y configuración).

Las restricciones del proyecto son:

- Un solo desarrollador construyendo y operando el producto a medio tiempo.
- Presupuesto de infraestructura inferior a 100 USD al mes durante el piloto (RNF-10).
- Prevención estricta de dobles reservas a nivel de base de datos (RF-04).
- Aislamiento de datos entre recintos desde el primer día (RNF-03).
- Respuesta rápida del bot de WhatsApp (< 3 segundos en el 95 % de los casos, RNF-02) y alta mantenibilidad en reglas críticas de negocio (RNF-06).

## Opciones consideradas

1. **Monolito modular en Next.js (TypeScript) + Supabase (PostgreSQL, Auth, RLS, `pg_cron`) + Meta WhatsApp Cloud API + Vercel + GitHub Actions, con reglas puras en `packages/core`:**
   - _Pros:_ Un único lenguaje (TypeScript) de punta a punta; PostgreSQL real con restricciones de exclusión GiST (`tstzrange`) y Row Level Security (RLS); capa gratuita/económica generosa en Vercel y Supabase; separación limpia entre dominio puro (`packages/core`) e infraestructura (`apps/web`).
   - _Contras:_ Acoplamiento operativo inicial a Supabase Auth y funciones serverless de Vercel.
2. **Backend separado (NestJS / Express en Railway o Render) + Frontend SPA + PostgreSQL administrado:**
   - _Pros:_ Desacoplamiento total entre API, workers y frontend.
   - _Contras:_ Mayor sobrecarga operativa y de configuración (dos despliegues, CORS, autenticación manual, mayor costo base mensual) para un único desarrollador.
3. **BaaS NoSQL (Firebase / Firestore) + Cloud Functions:**
   - _Pros:_ Desarrollo inicial rápido y escalado automático.
   - _Contras:_ Ausencia de restricciones relacionales nativas de exclusión por rango de tiempo (`tstzrange` + GiST) para impedir dobles reservas concurrentes y menor expresividad para reportes financieros y cierres de caja.

## Decisión

Adoptar la **Opción 1**:

- **Estructura de repositorio:** Monorepo con npm workspaces dividido en:
  - `apps/web`: aplicación Next.js (App Router, TypeScript) que aloja tanto el panel PWA como los endpoints HTTP (incluyendo el webhook de WhatsApp).
  - `packages/core`: lógica de negocio pura en TypeScript sin dependencias de framework (disponibilidad, cálculo de anticipos en COP entero, máquina de estados, zonas horarias).
  - `supabase/migrations`: migraciones SQL versionadas.
- **Base de datos y autenticación:** Supabase sobre PostgreSQL estándar, aprovechando Row Level Security (RLS), restricciones `EXCLUDE USING gist` con `tstzrange` y `pg_cron` para expirar bloqueos temporales (`HOLD`).
- **Mensajería:** Integración directa con Meta WhatsApp Cloud API mediante webhook propio idempotente y validado por firma HMAC-SHA256.
- **Calidad y CI/CD:** Vitest para pruebas unitarias y de esquemas, ESLint + Prettier para estilo, GitHub Actions para integración y despliegue continuo hacia Vercel y Supabase (`staging` y `production`).

## Consecuencias

- **Positivas:**
  - Costo mensual cercano a cero durante el piloto y muy por debajo del límite de 100 USD/mes.
  - Las reglas de negocio en `packages/core` se prueban en milisegundos con Vitest sin levantar servidores ni bases de datos externas.
  - PostgreSQL garantiza por motor que jamás existan dos reservas activas superpuestas en la misma cancha.
- **Negativas / Riesgos a mitigar:**
  - Dependencia de la plataforma Supabase para autenticación y RLS (mitigado usando SQL estándar en `supabase/migrations/` y manteniendo la lógica de dominio en `packages/core`).
  - Límites de tiempo de ejecución en funciones serverless de Vercel (mitigado respondiendo rápido al webhook y delegando tareas periódicas a `pg_cron`).
  - El spike CY-004 puede ajustar detalles de coexistencia y plantillas de WhatsApp Business API.
