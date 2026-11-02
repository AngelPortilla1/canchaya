# 0002. Arquitectura multi-tenant con aislamiento por `tenant_id` y RLS

- Estado: aceptada
- Fecha: 2026-11-01

## Contexto

Aunque el piloto inicia con un único recinto deportivo en Pamplona (Colombia), CanchaYa se diseña desde el día uno como un SaaS multi-recinto para escalar a más complejos deportivos de la región sin reescribir la base de datos ni la aplicación.

El sistema debe garantizar:

- Aislamiento estricto de datos entre recintos para cumplir con privacidad y protección de datos personales (RNF-03, Ley 1581 de 2012).
- Imposibilidad de referencias cruzadas accidentales entre recintos (por ejemplo, asignar una reserva del recinto A a una cancha o cliente del recinto B).
- Control de acceso por rol dentro de cada recinto: dueño (`owner`, acceso total a su recinto) y empleado (`staff`, operación diaria de reservas, clientes y pagos, RF-16).
- Costo de infraestructura inferior a 100 USD/mes y mantenimiento simple de migraciones (RNF-06, RNF-10).

## Opciones consideradas

1. **Base de datos por recinto (_Database-per-tenant_):**
   - _Pros:_ Aislamiento físico total y respaldos individuales por cliente.
   - _Contras:_ Costo fijo por instancia en Supabase incompatible con RNF-10 y alta complejidad para ejecutar migraciones y operar un único webhook de WhatsApp.
2. **Esquema de PostgreSQL por recinto (_Schema-per-tenant_):**
   - _Pros:_ Aislamiento lógico por namespace dentro de la misma instancia de PostgreSQL.
   - _Contras:_ Multiplicación de tablas e índices a medida que crecen los recintos, migraciones más frágiles y mayor fricción con el cliente estándar de Supabase/PostgREST.
3. **Tablas compartidas en el esquema `public` con columna `tenant_id`, claves foráneas compuestas y PostgreSQL Row Level Security (RLS):**
   - _Pros:_ Costo mínimo, migraciones únicas y lineales en `supabase/migrations/`, enrutamiento directo de webhooks entrantes por `whatsapp_phone_number_id` del recinto y aislamiento impuesto directamente por el motor de PostgreSQL.
   - _Contras:_ Requiere disciplina rigurosa en el diseño de políticas RLS y restricciones relacionales para evitar fugas entre recintos.

## Decisión

Adoptar la **Opción 3** (tablas compartidas con `tenant_id` + integridad relacional compuesta + `FORCE ROW LEVEL SECURITY`), implementada con tres capas de defensa en la base de datos:

1. **Columna discriminadora e integridad referencial compuesta (`CY-016`):**
   - La tabla raíz es `public.tenants`.
   - Toda tabla de negocio (`sports`, `courts`, `pricing`, `users`, `customers`, `bookings`, `payments`) incluye `tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE` y declara una restricción `UNIQUE (id, tenant_id)`.
   - Todas las relaciones entre tablas hijas usan claves foráneas compuestas `(recurso_id, tenant_id) REFERENCES tabla_destino(id, tenant_id)`, haciendo imposible a nivel de motor asociar registros de distintos recintos.
2. **Row Level Security forzada en todas las tablas (`CY-016`, `CY-018`):**
   - Todas las tablas tienen `ENABLE ROW LEVEL SECURITY` y `FORCE ROW LEVEL SECURITY`.
   - Se definen las funciones `public.current_user_tenant_id()` y `public.current_user_role()` con `SECURITY DEFINER` y `SET search_path = public`, restringidas al rol `authenticated`, que consultan `public.users` filtrando por `auth.uid()` y `is_active = true`. Esto evita recursión infinita al evaluar las políticas de `public.users`.
3. **Políticas segregadas por recinto y rol (`CY-018`):**
   - Ningún usuario autenticado puede leer ni modificar filas cuyo `tenant_id` no coincida con `public.current_user_tenant_id()`.
   - Las tablas de configuración (`tenants`, `sports`, `courts`, `pricing`, `users`) solo permiten escrituras cuando `public.current_user_role() = 'owner'`.
   - Las tablas operativas (`customers`, `bookings`, `payments`) permiten lectura, inserción y actualización tanto a `owner` como a `staff` activos del mismo recinto.

## Consecuencias

- **Positivas:**
  - Un error en una consulta del frontend o API con sesión de usuario nunca filtrará datos de otro recinto porque PostgreSQL bloquea el acceso mediante RLS.
  - Incluso operando con rol de servicio (por ejemplo, desde el webhook del bot), las claves foráneas compuestas `(id, tenant_id)` impiden mezclar entidades de recintos distintos.
  - Agregar un nuevo recinto (onboarding) consiste únicamente en insertar filas en `tenants`, `sports`, `courts` y `pricing`, sin aprovisionar infraestructura nueva.
- **Negativas / Riesgos a mitigar:**
  - Toda tabla nueva de negocio que se agregue en el futuro debe incluir obligatoriamente `tenant_id`, `UNIQUE (id, tenant_id)`, FKs compuestas y políticas RLS verificadas con pruebas automatizadas.
  - Los procesos de backend que usen `service_role` (como el webhook de WhatsApp) deben resolver primero el `tenant_id` a partir del `whatsapp_phone_number_id` y filtrar explícitamente por ese `tenant_id`.
