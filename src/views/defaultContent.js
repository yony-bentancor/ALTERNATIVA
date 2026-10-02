'use strict';
// Contenido institucional por defecto. Se usa hasta que administración publique su propia versión
// desde Gestión de contenido (y el seed lo copia a la base para que sea editable).
// Los textos legales son un punto de partida y deben revisarse con asesoramiento profesional.

const pages = {
  'como-funciona': {
    title: 'Cómo funciona Alternativa',
    excerpt: 'Encontrá especialistas en terapias y bienestar, reservá en minutos y pagá en un solo paso.',
    body: `## Para quienes buscan un servicio

1. **Buscá como hablás.** Escribí "masaje hoy", "reiki online" o "yoga en Pocitos". Te mostramos especialistas que encajan con lo que necesitás: si buscás para hoy, priorizamos disponibilidad; si buscás algo específico, la reputación en ese servicio.
2. **Compará con información real.** Cada servicio tiene su precio final, su duración y su propia valoración. Las reseñas son verificadas: solo opina quien hizo la sesión a través de Alternativa.
3. **Reservá y pagá en un paso.** Elegís día y hora con disponibilidad en tiempo real y pagás con Mercado Pago. Alternativa no guarda datos de tu tarjeta.
4. **Disfrutá tu sesión.** Te recordamos la cita y podés escribirle al especialista desde la app.
5. **Valorá y volvé a reservar.** Tu reseña ayuda a otras personas. Desde tu historial repetís la misma sesión con dos o tres toques.

## Para especialistas

- Creá tu ficha con tus servicios, precios, fotos y video.
- Definí tu agenda: Alternativa calcula los horarios libres y evita reservas superpuestas.
- Cobrá sin intermediarios: el pago se divide automáticamente y recibís tu parte en tu cuenta de Mercado Pago.
- Seguí tus números: visitas, reservas, clientes recurrentes, ingresos y reseñas.

## Lo que el dinero no puede comprar

Un especialista puede pagar para tener más visibilidad, y en ese caso lo vas a ver marcado como **Patrocinado**. Pero nadie puede comprar estrellas, modificar reseñas ni hacer desaparecer opiniones legítimas.`,
  },
  'sobre-alternativa': {
    title: 'Sobre Alternativa',
    excerpt: 'Un lugar para encontrar especialistas en bienestar y disciplinas alternativas en Uruguay.',
    body: `Alternativa reúne en un mismo lugar a especialistas en masajes, acupuntura, yoga, tai chi, reiki, meditación, astrología y otras disciplinas.

No queremos ser un directorio de teléfonos. Queremos que todo el ciclo sea más simple: descubrir, comparar, reservar, pagar, ir a la sesión, valorar y volver.

## En qué creemos

- **Reputación por servicio.** Una persona puede ser excelente en masaje descontracturante y estar empezando en reflexología. Por eso cada servicio tiene su propia valoración.
- **Reseñas verificadas.** Solo valora quien hizo una sesión reservada en Alternativa. Los especialistas pueden responder, pero no borrar opiniones.
- **Verificado significa verificado.** Distinguimos lo que declara cada especialista de lo que comprobamos nosotros.
- **Lugar para quienes empiezan.** Reservamos una parte de la visibilidad para perfiles nuevos, sin inventarles reputación.
- **Conveniencia, no encierro.** Después de la primera sesión quizás intercambien WhatsApp. Está bien: nuestro trabajo es que seguir usando Alternativa sea más cómodo que coordinar por fuera.`,
  },
  terminos: {
    title: 'Términos y condiciones',
    excerpt: 'Condiciones de uso de Alternativa.',
    body: `Última actualización: octubre de 2026.

## 1. Qué es Alternativa
Alternativa es una plataforma que conecta a personas que buscan servicios de bienestar y disciplinas alternativas ("usuarios") con profesionales independientes que los ofrecen ("especialistas"). Alternativa no presta los servicios: cada especialista es responsable de la sesión que brinda.

## 2. Cuentas
Para reservar o publicar servicios necesitás una cuenta con datos verdaderos. Sos responsable de mantener tu contraseña segura.

## 3. Reservas y pagos
El precio que ves al reservar es el precio final e incluye la tarifa de servicio de Alternativa. El pago se procesa a través de un proveedor de pagos; Alternativa no almacena datos de tarjetas. La reserva queda confirmada cuando el pago se acredita.

## 4. Cancelaciones y reembolsos
Se aplica la [política de cancelaciones](/cancelaciones) vigente al momento de reservar.

## 5. Reseñas
Solo pueden valorar quienes realizaron una sesión reservada en Alternativa. Las reseñas deben ser honestas y respetuosas. Alternativa puede moderar contenido que incumpla estas condiciones.

## 6. Especialistas
Los especialistas declaran su formación y experiencia. Cuando Alternativa verifica identidad o certificaciones lo indica expresamente; lo no verificado se muestra como declarado. Los servicios ofrecidos no sustituyen la atención médica.

## 7. Conducta
No está permitido usar Alternativa para fines ilegales, acosar a otras personas, publicar información falsa ni intentar manipular reputaciones.

## 8. Contacto
Para cualquier consulta escribinos desde [Contacto](/contacto).`,
  },
  privacidad: {
    title: 'Política de privacidad',
    excerpt: 'Cómo tratamos tus datos personales.',
    body: `Última actualización: octubre de 2026. Alternativa trata los datos personales de acuerdo con la Ley N° 18.331 de Protección de Datos Personales de Uruguay.

## Qué datos usamos
- Datos de cuenta: nombre, email, teléfono.
- Datos de reservas: servicios, fechas, modalidad y, si corresponde, la dirección para atención a domicilio.
- Mensajes entre usuarios y especialistas.
- Datos de pago: los procesa el proveedor de pagos. Alternativa no recibe ni guarda números de tarjeta.
- Documentación de identidad y certificaciones de especialistas: se guarda de forma privada y solo la ve el equipo de verificación.

## Para qué
Para gestionar reservas, pagos, avisos, reseñas verificadas, seguridad y mejora del servicio.

## Qué se muestra públicamente
De los usuarios, solo el nombre y la inicial del apellido en las reseñas. De los especialistas, la información de su ficha. Las direcciones exactas se comparten solo con quien tiene una reserva confirmada.

## Tus derechos
Podés acceder, rectificar y eliminar tus datos desde Mi cuenta → Privacidad, o escribiéndonos desde [Contacto](/contacto). Algunos registros de reservas y pagos se conservan el tiempo que exige la normativa.`,
  },
  cancelaciones: {
    title: 'Política de cancelaciones',
    excerpt: 'Cuándo y cuánto se reembolsa si cancelás o reprogramás.',
    body: `Las reglas que se aplican a tu reserva son las que estaban vigentes cuando la hiciste. Las ves también en el detalle de cada reserva antes de cancelar.

Los reembolsos se hacen al mismo medio de pago. Según el banco o la tarjeta, pueden demorar algunos días hábiles en verse.

Si tuviste un problema con una sesión, avisanos desde el detalle de la reserva con "Reportar un problema": la revisamos antes de cerrarla.`,
  },
};

const faqs = [
  { category: 'Reservas', title: '¿Cómo reservo una sesión?', body: 'Elegí el servicio, el día y el horario que te quedan bien y pagá en el mismo paso. Recibís la confirmación por email y la ves en Mis reservas.' },
  { category: 'Reservas', title: '¿Puedo reprogramar?', body: 'Sí, desde el detalle de la reserva, hasta el plazo que indica la política de cancelaciones. Elegís el nuevo horario y no pagás de nuevo.' },
  { category: 'Reservas', title: '¿Qué pasa si el especialista cancela?', body: 'Te devolvemos el 100% automáticamente y te avisamos para que puedas reservar otro horario.' },
  { category: 'Pagos', title: '¿Cómo se paga?', body: 'Con Mercado Pago: tarjetas de crédito y débito, dinero en cuenta y otros medios disponibles. Pagás una sola vez el precio final, que ya incluye la tarifa de servicio.' },
  { category: 'Pagos', title: '¿Alternativa guarda los datos de mi tarjeta?', body: 'No. Los datos de pago los procesa Mercado Pago. Alternativa nunca recibe ni almacena números de tarjeta.' },
  { category: 'Reseñas', title: '¿Por qué dice "reseñas verificadas"?', body: 'Porque solo puede valorar un servicio quien lo reservó y lo realizó a través de Alternativa.' },
  { category: 'Reseñas', title: '¿Un especialista puede borrar una reseña negativa?', body: 'No. Puede responderla o pedir una revisión si cree que incumple las reglas. Solo el equipo de Alternativa modera, y queda registrado.' },
  { category: 'Especialistas', title: '¿Qué significa "Identidad verificada"?', body: 'Que Alternativa revisó un documento de identidad del especialista. Lo que no verificamos se muestra como declarado por el especialista.' },
  { category: 'Especialistas', title: '¿Qué significa "Nuevo en Alternativa"?', body: 'Que el especialista se sumó hace poco. No le asignamos estrellas que no tiene: le damos una parte de la visibilidad para que pueda empezar a recibir reservas.' },
  { category: 'Especialistas', title: '¿Cómo cobro mis sesiones?', body: 'Vinculás tu cuenta de Mercado Pago desde tu panel. Cada pago se divide en el momento: tu parte va a tu cuenta y la tarifa de Alternativa a la nuestra. No hay transferencias manuales.' },
  { category: 'Especialistas', title: '¿Cuánto cobra Alternativa?', body: 'Una tarifa de servicio por reserva realizada, que se suma a tu precio. Vos definís cuánto querés cobrar por tu servicio. El procesador de pagos cobra su propia comisión.' },
];

module.exports = { pages, faqs };
