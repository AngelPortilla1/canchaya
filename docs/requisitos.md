# Requisitos

## Funcionales

- RF-01 Mostrar disponibilidad por deporte, cancha, fecha y hora (bloques de 60 min).
- RF-02 Crear reserva con HOLD de 15 min hasta recibir el anticipo.
- RF-03 Expirar HOLD y liberar la hora automáticamente.
- RF-04 Imposible superponer reservas confirmadas en la misma cancha.
- RF-05 Reprogramar hasta X horas antes (configurable); el anticipo se conserva.
- RF-06 Cancelar según política del recinto (crédito o pérdida del anticipo).
- RF-07 Precio por hora y % de anticipo configurables por recinto y deporte.
- RF-08 Comprobante del anticipo por WhatsApp, validado por el empleado en el panel.
- RF-09 Registro del saldo en el recinto (efectivo, transferencia, mixto).
- RF-10 Cierre de caja diario por método de pago.
- RF-11 Bot 24/7: deporte, fecha, hora, confirmación.
- RF-12 Transferencia a humano cuando el bot no entiende.
- RF-13 Recordatorios y confirmaciones por WhatsApp.
- RF-14 Calendario de las 4 canchas con estados.
- RF-15 Crear, mover y cancelar reservas manualmente en el panel.
- RF-16 Roles: dueño y empleado.
- RF-17 Reportes: ocupación, ingresos, no-shows, clientes frecuentes.
- RF-18 Reservas fijas semanales y lista de espera.
- RF-19 Confitería y alquiler de raquetas y balones con inventario básico.
- RF-20 Pasarela de pagos con confirmación automática.
- RF-21 Torneos relámpago.

## No funcionales

- RNF-01 Disponibilidad 99% mensual en horario de operación.
- RNF-02 Respuesta del bot < 3 s en el 95% de los casos.
- RNF-03 RLS por recinto; cumplimiento de la Ley 1581 de 2012.
- RNF-04 Cumplir políticas de Meta (plantillas, consentimiento, ventana de 24 h).
- RNF-05 Panel usable desde celular; capacitación < 30 min.
- RNF-06 Pruebas en reglas críticas; migraciones versionadas.
- RNF-07 Logs y alertas (webhook caído, errores).
- RNF-08 Respaldo diario y prueba de restauración.
- RNF-09 UTC en base de datos, America/Bogota en pantalla.
- RNF-10 Infraestructura < 100 USD/mes con un recinto.
