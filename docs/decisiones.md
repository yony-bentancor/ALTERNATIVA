# Decisiones de producto y de arquitectura

Registro de decisiones tomadas para construir Alternativa. Cada una dice qué se decidió, por qué, y dónde está implementada.

## 1. Modelo de pagos — decisión preliminar (octubre 2026)

> El usuario realiza un único pago dentro del proceso de reserva de Alternativa. El precio mostrado al usuario incluye la tarifa/comisión de Alternativa. La plataforma utiliza un proveedor de pagos compatible con marketplaces y división automática de pagos (split payments), evitando que Alternativa tenga que realizar manualmente transferencias individuales a los especialistas.
>
> Cada especialista debe vincular/configurar una cuenta apta para recibir pagos. El procesador distribuye automáticamente los importes correspondientes al especialista, Alternativa y los costos de procesamiento según la arquitectura finalmente contratada.
>
> Alternativa no almacena directamente los datos sensibles de las tarjetas.
>
> La arquitectura contempla pagos, cancelaciones, reembolsos, contracargos y conciliación desde el inicio.

### Cómo quedó implementado

| Requisito | Implementación |
|---|---|
| Un solo pago, precio final con tarifa incluida | `services/commission.js → priceBreakdown()` con `feeMode: 'added'`: el especialista carga $900, el cliente ve $945. |
| Mostrar "Total" o desglose | Configurable: Admin → Configuración → Comisión y precios → *Cómo se muestra el precio*. |
| Split automático | `collectionModel: 'split'` (por defecto). Mercado Pago Checkout Pro con el *access token* del especialista (OAuth) y `marketplace_fee` = tarifa de Alternativa (`services/payments/mercadopago.js`). |
| El especialista vincula su cuenta | Panel → Cobros → *Vincular Mercado Pago* (OAuth). Sin cuenta vinculada la ficha no se puede publicar ni recibir reservas pagas (configurable). |
| No guardar tarjetas | El pago ocurre en Mercado Pago. Alternativa solo guarda el ID del pago. |
| Costo del procesador | `processorFeePercent` estimado (6,09% por defecto = 4,99% + IVA a 21 días) y `processorFeePaidBy` = especialista / cliente / Alternativa. Cada pago guarda además la comisión **real** que informa Mercado Pago (`Payment.providerFee`). |
| Reembolsos | Proporcionales entre especialista y Alternativa (`services/cancellation.js → splitRefund`). Si la pasarela rechaza el reembolso (p. ej. el especialista no tiene saldo), se registra como fallido, se abre una incidencia con ticket de prioridad alta y se alerta a administración. Desde Admin → Reembolsos se puede reintentar o registrar la gestión manual. |
| Contracargos | Webhook `chargebacks` de Mercado Pago → pago marcado como contracargo/en disputa, incidencia abierta y alerta. |
| Conciliación | Job periódico (`payments.reconcile`) que consulta los pagos pendientes sin webhook; botón "Consultar a la pasarela" en cada pago del admin. |
| Webhooks seguros | Firma `x-signature` validada con `MP_WEBHOOK_SECRET` (obligatoria en producción). Procesamiento idempotente. |

### Orden de descuentos en el split de Mercado Pago

Según la documentación de Mercado Pago, en el split primero se descuenta la comisión de Mercado Pago del monto del vendedor y luego la comisión del marketplace. Por eso el sistema calcula `marketplaceFee` según quién absorbe el costo del procesador:

- **Especialista** (comportamiento estándar): cliente paga $945 → MP descuenta su comisión → Alternativa recibe $45 → el especialista recibe $900 − comisión MP.
- **Cliente**: el total se ajusta para que, después de la comisión de MP, el especialista reciba $900 y Alternativa $45.
- **Alternativa**: el cliente paga $945, el especialista recibe $900 y la comisión de MP sale de los $45 (puede dar margen negativo; el panel lo muestra).

### "Split inmediato" no es "dinero liberado inmediatamente"

La asignación del dinero es automática al pagar. Cuándo queda **disponible** para retirar lo define la cuenta de Mercado Pago del especialista (plazo de liberación). Con el plazo de 21 días, además de pagar menos comisión, el dinero de una reserva cancelada suele seguir en la cuenta del especialista cuando hay que reembolsar. Recomendación operativa: acordar con los especialistas el plazo de 21 días y mantener la política de cancelación (reembolso total hasta 24 h antes).

### Otros modelos (disponibles por configuración, no recomendados por defecto)

- **platform**: Alternativa cobra y liquida. Incluye liquidaciones periódicas (Admin → Liquidaciones). Requiere transferencias y conciliación bancaria.
- **offline**: el especialista cobra por fuera; Alternativa registra la comisión adeudada y la factura.

### Comparación de proveedores (pendiente de negociación comercial, no de desarrollo)

| | Mercado Pago (implementado) | dLocal For Platforms |
|---|---|---|
| Split | Sí, con OAuth del vendedor y `marketplace_fee` | Sí, objeto de splits entre cuentas de la plataforma |
| Alta de especialistas | El especialista ya tiene o crea su cuenta MP | Sub-cuentas gestionadas por la plataforma (KYC) |
| Costos publicados (UY, checkout online) | 5,99% + IVA (dinero inmediato) / 4,99% + IVA (21 días) | A negociar según volumen |
| Reembolsos | Proporcionales vendedor/marketplace; pueden fallar si el vendedor no tiene saldo | Usan la misma división del pago original |
| Integración | Lista en `services/payments/mercadopago.js` | Se agrega como otro proveedor con la misma interfaz (`createCheckout`, `fetchPayment`, `refund`, `verifyWebhook`, `searchByReference`) |

Fuentes: documentación de Mercado Pago Developers (integración de marketplace, split de pagos), página de checkout de Mercado Pago Uruguay y documentación de dLocal (split payments for platforms). Los costos cambian: revisarlos al contratar.

## 2. Reputación

- La reputación pertenece al **servicio** (`Service.rating`), no solo al especialista.
- El usuario ve "★ 4,9 · 127 reseñas verificadas". Internamente se ordena con un **promedio bayesiano** (`ranking.bayesian`, parámetros en Admin → Reseñas): 5,0 con 2 reseñas no supera a 4,9 con 127.
- Solo reseña quien tuvo una reserva **realizada** (índice único por reserva). El especialista responde, reporta o pide revisión; no borra. Administración modera y queda auditado.
- "Nuevo en Alternativa": 1 de cada N posiciones orgánicas para perfiles nuevos que cumplen requisitos mínimos (configurable). Nunca se les inventa reputación.
- El dinero compra exposición (Destacados, marcados "Patrocinado"), nunca reputación.

## 3. Política de cancelación por defecto (configurable)

- Usuario cancela con ≥ 24 h: 100% · entre 6 y 24 h: 50% · < 6 h: 0%.
- Usuario no se presenta: 0% · Especialista cancela o no se presenta: 100%.
- Reprogramación sin costo hasta 12 h antes, máximo 2 veces.
- Cada reserva guarda la política vigente al reservar (`Booking.snapshot.cancellationPolicy`).

## 4. Datos de contacto en mensajes

Principio: no impedir artificialmente el contacto, sino que usar Alternativa sea más cómodo. Por defecto los teléfonos/emails se ocultan en el chat **hasta la primera reserva** (configurable: siempre / después de reservar / nunca). El texto original se conserva para auditoría.

## 5. Perfiles cargados por administración

Se muestran públicamente (para poblar el marketplace), pero **no reciben reservas online** hasta que el especialista los reclama, verifica su identidad y vincula su cuenta de cobro. Así nadie paga una reserva que nadie va a gestionar.

## 6. Pendientes de decisión comercial (no bloquean el lanzamiento)

1. Proveedor de pagos definitivo y costos negociados (el sistema ya soporta el cambio).
2. Mostrar total o desglose (configurable).
3. Quién absorbe el costo del procesador (configurable).
4. Revisión legal de Términos, Privacidad y Política de cancelación (textos base incluidos y editables desde el admin).
5. Obligaciones fiscales y de información al consumidor sobre la tarifa de servicio.
