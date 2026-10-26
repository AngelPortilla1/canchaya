# 0001. Stack inicial

- Estado: aceptada (revisable tras el piloto)
- Fecha: 2026-10-26

## Contexto
Un solo desarrollador, costos mínimos, multi-recinto desde el inicio, necesidad de evitar dobles reservas.

## Decisión
Next.js (TypeScript) + Supabase (PostgreSQL con RLS y restricciones de exclusión) + Meta WhatsApp Cloud API + GitHub Actions + Vercel.

## Consecuencias
- Bajo costo y rapidez inicial.
- Dependencia de Supabase y Vercel (mitigable: PostgreSQL estándar).
- El spike CY-004 puede ajustar la integración de WhatsApp.
