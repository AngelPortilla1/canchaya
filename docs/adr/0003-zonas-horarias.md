# 0003. Manejo de zonas horarias: almacenamiento en UTC y presentación en `America/Bogota`

- Estado: aceptada
- Fecha: 2026-11-01

## Contexto

El recinto piloto en Pamplona (Colombia) opera principalmente en horario vespertino y nocturno hasta las 12:00 a. m. (hora local `America/Bogota`, UTC-5). En ese rango horario (a partir de las 7:00 p. m. hora de Colombia), el instante correspondiente en UTC ya pertenece al día calendario siguiente (00:00 UTC a 05:00 UTC).

Si no se establece una convención estricta y uniforme para el manejo del tiempo entre PostgreSQL, los servidores serverless (que se ejecutan en UTC en Vercel y GitHub Actions), el servicio de disponibilidad en `packages/core`, el bot de WhatsApp y el panel del empleado:

- Las consultas de disponibilidad para la noche de un día local pueden omitir o duplicar reservas que cruzan las 00:00 UTC.
- Los cálculos de expiración de bloqueos temporales (`HOLD` de 15 minutos) y ventanas mínimas de reprogramación pueden desfasarse por 5 horas.
- La futura expansión a recintos en otras zonas horarias requeriría migrar datos históricos.

Por ello, el requisito no funcional RNF-09 y las reglas de arquitectura exigen almacenar todas las marcas de tiempo en UTC y presentarlas en `America/Bogota`.

## Opciones consideradas

1. **Almacenar fechas en hora local sin zona (`TIMESTAMP WITHOUT TIME ZONE`):**
   - _Pros:_ Lectura directa en consultas SQL manuales para un único país.
   - _Contras:_ Ambigüedad entre el reloj del servidor serverless (UTC) y la base de datos; propenso a errores silenciosos al comparar con `now()`; impide soportar recintos en distintas zonas horarias.
2. **Almacenar todo instante en UTC con `TIMESTAMPTZ` y `tstzrange`, guardar la zona IANA en cada recinto (`tenants.timezone`) y convertir en los bordes de negocio/presentación:**
   - _Pros:_ Semántica temporal exacta e inequívoca en PostgreSQL; compatibilidad nativa con `tstzrange(starts_at, ends_at, '[)')` para la restricción GiST de no superposición (`CY-017`); comparaciones seguras con `timezone('utc', now())` para expirar `HOLD`; soporte multi-zona por recinto.
   - _Contras:_ El servicio de disponibilidad y las consultas por "día de operación" deben proyectar la fecha local del recinto (`America/Bogota`) al intervalo UTC exacto correspondiente (por ejemplo, `2026-11-01T05:00:00Z` a `2026-11-02T05:00:00Z`).
3. **Almacenar tiempos como enteros Unix epoch (`BIGINT`) en todas las tablas:**
   - _Pros:_ Independiente de formato de texto.
   - _Contras:_ Pierde los operadores nativos de rangos temporales (`tstzrange`, `&&`) y las funciones de fecha de PostgreSQL, dificultando la legibilidad y las restricciones de exclusión.

## Decisión

Adoptar la **Opción 2**:

1. **Almacenamiento en UTC en PostgreSQL (`TIMESTAMPTZ`):**
   - Todas las columnas que representan un instante en el tiempo (`bookings.starts_at`, `bookings.ends_at`, `bookings.hold_expires_at`, `customers.data_consent_at`, `payments.validated_at`, `created_at`, `updated_at`) usan el tipo `TIMESTAMPTZ` con valores por defecto `timezone('utc', now())`.
   - La restricción de exclusión por cancha (`bookings_no_overlap_per_court`, `CY-017`) evalúa `tstzrange(starts_at, ends_at, '[)')` en UTC con límite inferior inclusivo y superior exclusivo, permitiendo reservas consecutivas sin huecos (ej. `19:00-20:00` y `20:00-21:00`).
2. **Configuración de zona horaria por recinto y horas de pared:**
   - Cada recinto tiene la columna `tenants.timezone TEXT NOT NULL DEFAULT 'America/Bogota'` (identificador IANA).
   - Los horarios recurrentes del negocio (`tenants.operating_hours` y `pricing.start_time` / `pricing.end_time` de tipo `TIME`) representan "hora local de pared" en la zona horaria del recinto.
3. **Conversión en `packages/core`, panel PWA y bot de WhatsApp:**
   - Cuando un cliente o empleado solicita o visualiza una fecha (ej. `"2026-11-05"` en `America/Bogota`), `packages/core` proyecta los bloques horarios locales del recinto a sus instantes UTC equivalentes (`starts_at`, `ends_at`) antes de consultar o persistir en `public.bookings`.
   - Toda fecha o rango horario mostrado al usuario final (mensajes de WhatsApp, calendario diario del panel, reportes y cierres de caja) se formatea explícitamente en la zona horaria del recinto (`America/Bogota`).

## Consecuencias

- **Positivas:**
  - Consistencia absoluta entre entornos locales, contenedores de CI, funciones de Vercel y PostgreSQL en Supabase.
  - Expiración exacta de reservas en estado `HOLD` (`hold_expires_at <= timezone('utc', now())`) sin importar la hora local.
  - Soporte nativo para turnos nocturnos hasta la medianoche local (11:00 p. m. a 12:00 a. m. en Colombia = `04:00Z` a `05:00Z` del día UTC siguiente) sin colisiones ni huecos.
- **Negativas / Riesgos a mitigar:**
  - Está prohibido filtrar reservas de un día usando `DATE(starts_at)` directamente en UTC; siempre debe consultarse por el rango `[inicio_dia_local_en_utc, fin_dia_local_en_utc)` o convirtiendo con `AT TIME ZONE 'America/Bogota'`.
  - Las pruebas unitarias de disponibilidad (`CY-030`) deben incluir obligatoriamente casos borde entre las 7:00 p. m. y las 12:00 a. m. hora de Bogotá (cruce de medianoche UTC).
