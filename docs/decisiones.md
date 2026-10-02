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
| Un solo pago, precio final con tarifa incluida | `services/comision.js → desglose()` con `modo: 'sumada'`: el especialista carga $900, el cliente ve $945. |
| Mostrar "Total" o desglose | Configurable: Administración → Configuración → Comisión → *Cómo se muestra el precio*. |
| Split automático | `pagos.modelo: 'split'` (por defecto). Mercado Pago Checkout Pro con el *access token* del especialista (OAuth) y `marketplace_fee` = tarifa de Alternativa (`services/pagos/mercadopago.js`). |
| El especialista vincula su cuenta | Panel → Cobros → *Vincular con Mercado Pago* (OAuth; en modo demo, *Vincular cuenta de prueba*). Sin cuenta vinculada la ficha no recibe reservas pagas (configurable: `exigirCuentaVinculada`). |
| No guardar tarjetas | El pago ocurre en Mercado Pago. Alternativa solo guarda el ID del pago. |
| Costo del procesador | `comisionProcesador` estimado (6,09% por defecto = 4,99% + IVA a 21 días) y `procesadorPaga` = especialista / cliente / Alternativa. Cada pago guarda además la comisión **real** que informa Mercado Pago (`Pago.comisionPasarela`). |
| Reembolsos | Proporcionales entre especialista y Alternativa (`services/cancelacion.js → repartirReembolso`). Si la pasarela rechaza el reembolso (p. ej. el especialista no tiene saldo), se registra como fallido, se abre una incidencia con consulta de prioridad alta y se alerta a administración. Desde Administración → Reembolsos se puede reintentar o registrar la gestión manual. |
| Contracargos | Webhook `chargebacks` de Mercado Pago → pago marcado como contracargo/en disputa, incidencia abierta y alerta. |
| Conciliación | Tarea automática (`pagos.conciliar`) que consulta los pagos pendientes sin webhook; botones "Conciliar pendientes" y "Consultar pasarela" en Administración → Pagos. |
| Webhooks seguros | Firma `x-signature` validada con `MP_WEBHOOK_SECRET` (obligatoria en producción). Procesamiento idempotente. |

### Orden de descuentos en el split de Mercado Pago

Según la documentación de Mercado Pago, en el split primero se descuenta la comisión de Mercado Pago del monto del vendedor y luego la comisión del marketplace. Por eso el sistema calcula `comisionMarketplace` según quién absorbe el costo del procesador:

- **Especialista** (comportamiento estándar): cliente paga $945 → MP descuenta su comisión → Alternativa recibe $45 → el especialista recibe $900 − comisión MP.
- **Cliente**: el total se ajusta para que, después de la comisión de MP, el especialista reciba $900 y Alternativa $45.
- **Alternativa**: el cliente paga $945, el especialista recibe $900 y la comisión de MP sale de los $45 (puede dar margen negativo; el panel lo muestra).

### "Split inmediato" no es "dinero liberado inmediatamente"

La asignación del dinero es automática al pagar. Cuándo queda **disponible** para retirar lo define la cuenta de Mercado Pago del especialista (plazo de liberación). Con el plazo de 21 días, además de pagar menos comisión, el dinero de una reserva cancelada suele seguir en la cuenta del especialista cuando hay que reembolsar. Recomendación operativa: acordar con los especialistas el plazo de 21 días y mantener la política de cancelación (reembolso total hasta 24 h antes).

### Otros modelos (disponibles por configuración, no recomendados por defecto)

- **plataforma**: Alternativa cobra y liquida. Incluye liquidaciones periódicas (Administración → Liquidaciones). Requiere transferencias y conciliación bancaria.
- **offline** ("Cobra el especialista"): el especialista cobra por fuera; Alternativa registra la comisión adeudada y la factura.

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

- La reputación pertenece al **servicio** (`Servicio.rating`), no solo al especialista.
- El usuario ve "★ 4,9 · 127 reseñas verificadas". Internamente se ordena con un **promedio bayesiano** (`ranking.bayesiano`, parámetros en Administración → Configuración → Reseñas): 5,0 con 2 reseñas no supera a 4,9 con 127.
- Solo reseña quien tuvo una reserva **realizada** (una reseña por reserva). El especialista responde, reporta o pide revisión; no borra. Administración modera y queda auditado.
- "Nuevo en Alternativa": 1 de cada N posiciones orgánicas para perfiles nuevos que cumplen requisitos mínimos (configurable). Nunca se les inventa reputación.
- El dinero compra exposición (Destacados, marcados "Patrocinado"), nunca reputación.

## 3. Política de cancelación por defecto (configurable)

- Usuario cancela con ≥ 24 h: 100% · entre 6 y 24 h: 50% · < 6 h: 0%.
- Usuario no se presenta: 0% · Especialista cancela o no se presenta: 100%.
- Reprogramación sin costo hasta 12 h antes, máximo 2 veces.
- Cada reserva guarda la política vigente al reservar (`Reserva.foto.politica`).

## 4. Datos de contacto en mensajes

Principio: no impedir artificialmente el contacto, sino que usar Alternativa sea más cómodo. Por defecto los teléfonos/emails se ocultan en el chat **hasta la primera reserva** (configurable: siempre / después de reservar / nunca). El texto original se conserva para auditoría.

## 5. Perfiles cargados por administración

Se muestran públicamente (para poblar el marketplace), pero **no reciben reservas online** hasta que el especialista los reclama, verifica su identidad y vincula su cuenta de cobro. Así nadie paga una reserva que nadie va a gestionar.

## 6. Pendientes de decisión comercial (no bloquean el lanzamiento)

1. Proveedor de pagos definitivo y costos negociados (el sistema ya soporta el cambio).
2. Mostrar total o desglose (configurable).
3. Quién absorbe el costo del procesador (configurable).
4. Revisión legal de Términos, Privacidad y Política de cancelación (textos base incluidos y editables desde Administración → Contenido).
5. Obligaciones fiscales y de información al consumidor sobre la tarifa de servicio.

## 7. Estructura del código (octubre 2026)

Se reorganizó el proyecto con **la misma estructura que Relámpago**: `app.js` en la raíz, `config/`, `controllers/`, `middlewares/`, `models/`, `routes/`, `services/`, `views/` (EJS con `partials/`), `scripts/seed.js`, `data/` y `uploads/`. Los datos viven en `data/db.json` (como Relámpago) y se generan solos con datos de prueba completos; el paso a MongoDB quedó documentado en `config/db.js`. Ver `docs/arquitectura.md`.

## 8. Usuarios de prueba

Con `MODO_DEMO=true` la pantalla de ingreso muestra un botón "Entrar" por cada usuario de prueba (un administrador, tres especialistas en distintas etapas y dos usuarios). En producción real se apaga con `MODO_DEMO=false` y se cambia `CLAVE_DEMO`.
