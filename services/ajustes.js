/*
 * Descripción de cada sección de la configuración de negocio (Administración → Configuración):
 * etiqueta, ayuda y opciones de cada campo. La pantalla y la validación se generan a partir de acá,
 * así que agregar un ajuste nuevo es sumarlo en models/Config.js (valor por defecto) y describirlo aquí.
 */
const { invalido } = require("./errores");
const { MODELOS_COBRO } = require("./util");

const SECCIONES = {
  sitio: {
    titulo: "Sitio", descripcion: "Datos generales y modo mantenimiento.",
    campos: {
      nombre: { etiqueta: "Nombre del sitio" },
      lema: { etiqueta: "Lema", ayuda: "Se usa en el inicio y en la descripción para buscadores." },
      email: { etiqueta: "Email de contacto", tipo: "email" },
      whatsappSoporte: { etiqueta: "WhatsApp de soporte", ayuda: "Formato internacional sin +, por ejemplo 59899123456. Vacío = sin botón flotante." },
      instagram: { etiqueta: "Instagram (usuario)" },
      mantenimiento: { etiqueta: "Modo mantenimiento", ayuda: "Muestra una página de mantenimiento a todos menos a administración." },
      altaEspecialistas: { etiqueta: "Permitir altas de especialistas" },
    },
  },
  comision: {
    titulo: "Comisión", descripcion: "Tarifa de Alternativa por reserva. Las reglas por especialista o categoría están en Comisiones.",
    campos: {
      tasaGeneral: { etiqueta: "Comisión general (%)", min: 0, max: 50 },
      modo: { etiqueta: "Cómo se cobra", opciones: { sumada: "Sumada al precio (la paga el cliente)", incluida: "Incluida en el precio (la absorbe el especialista)" } },
      mostrarPrecio: { etiqueta: "Cómo se muestra el precio", opciones: { desglose: "Con desglose (servicio + tarifa)", total: "Solo el total" } },
      etiqueta: { etiqueta: "Nombre de la tarifa" },
    },
  },
  pagos: {
    titulo: "Pagos", descripcion: "Modelo de cobro y plazos.",
    campos: {
      modelo: { etiqueta: "Modelo de cobro", opciones: Object.fromEntries(Object.entries(MODELOS_COBRO).map(([k, v]) => [k, v.texto])) },
      minutosParaPagar: { etiqueta: "Minutos para pagar una reserva", min: 5, max: 120 },
      comisionProcesador: { etiqueta: "Costo estimado de la pasarela (%)", min: 0, max: 20, paso: 0.01 },
      procesadorPaga: { etiqueta: "Quién absorbe el costo de la pasarela", opciones: { especialista: "El especialista", cliente: "El cliente", plataforma: "Alternativa" } },
      exigirCuentaVinculada: { etiqueta: "Exigir Mercado Pago vinculado para reservas pagas", ayuda: "Si está apagado, Alternativa cobra por quien no vinculó y le liquida después." },
      frecuenciaLiquidacion: { etiqueta: "Frecuencia de liquidación (días)", min: 1, max: 60 },
      minimoLiquidacion: { etiqueta: "Monto mínimo a liquidar ($)", min: 0, max: 100000 },
    },
  },
  cancelacion: {
    titulo: "Cancelación", descripcion: "Política de reembolsos. Cada reserva guarda la política vigente al reservar.",
    campos: {
      horasReembolsoTotal: { etiqueta: "Reembolso total si cancela con más de (horas)", min: 0, max: 720 },
      horasReembolsoParcial: { etiqueta: "Reembolso parcial si cancela con más de (horas)", min: 0, max: 720 },
      porcentajeParcial: { etiqueta: "Porcentaje del reembolso parcial", min: 0, max: 100 },
      porcentajeTardio: { etiqueta: "Porcentaje si cancela tarde", min: 0, max: 100 },
      porcentajeAusenciaUsuario: { etiqueta: "Porcentaje si el cliente no se presenta", min: 0, max: 100 },
      porcentajeCancelaEspecialista: { etiqueta: "Porcentaje si cancela el especialista", min: 0, max: 100 },
      porcentajeAusenciaEspecialista: { etiqueta: "Porcentaje si el especialista no se presenta", min: 0, max: 100 },
      horasMinReprogramar: { etiqueta: "Reprogramar hasta (horas antes)", min: 0, max: 720 },
      maxReprogramaciones: { etiqueta: "Máximo de reprogramaciones por reserva", min: 0, max: 10 },
    },
  },
  resenas: {
    titulo: "Reseñas", descripcion: "Pedido de valoración y cálculo de reputación.",
    campos: {
      pedirDespuesHoras: { etiqueta: "Pedir la reseña (horas después de la sesión)", min: 0, max: 168 },
      diasEdicion: { etiqueta: "Días para editar una reseña", min: 0, max: 60 },
      diasParaValorar: { etiqueta: "Días para valorar", min: 1, max: 365 },
      pesoBayes: { etiqueta: "Peso del promedio base (ranking)", ayuda: "Cuántas reseñas \"virtuales\" con el promedio base se suman para ordenar. Evita que 1 reseña de 5★ gane a 80 de 4,8★.", min: 0, max: 100 },
      promedioBase: { etiqueta: "Promedio base", min: 1, max: 5, paso: 0.1 },
    },
  },
  descubrimiento: {
    titulo: "Descubrimiento", descripcion: "Cómo se intercalan perfiles nuevos y patrocinados en los resultados.",
    campos: {
      diasNuevo: { etiqueta: "Días que un perfil se considera nuevo", min: 0, max: 365 },
      maxResenasNuevo: { etiqueta: "Máximo de reseñas para considerarse nuevo", min: 0, max: 50 },
      nuevoCada: { etiqueta: "Intercalar un perfil nuevo cada (resultados)", min: 2, max: 50 },
      lugaresPatrocinados: { etiqueta: "Lugares patrocinados por página", min: 0, max: 6 },
    },
  },
  contacto: {
    titulo: "Contacto", descripcion: "Cuándo pueden hablar clientes y especialistas fuera de la reserva.",
    campos: {
      politicaChat: { etiqueta: "Datos de contacto en el chat", opciones: { siempre: "Se pueden compartir siempre", despues_reserva: "Solo después de una reserva pagada", nunca: "Nunca (se ocultan)" } },
      whatsappEspecialista: { etiqueta: "Botón de WhatsApp del especialista", opciones: { siempre: "Visible para todos", despues_reserva: "Solo con una reserva", nunca: "Nunca" } },
    },
  },
  moderacion: {
    titulo: "Moderación", descripcion: "Qué se revisa antes de publicarse.",
    campos: {
      especialistasNuevos: { etiqueta: "Revisar fichas nuevas antes de publicarlas" },
      cambiosSensibles: { etiqueta: "Revisar cambios de nombre y categorías" },
      serviciosNuevos: { etiqueta: "Revisar servicios nuevos" },
      multimedia: { etiqueta: "Revisar fotos y videos antes de publicarlos" },
      categoriasNuevas: { etiqueta: "Revisar categorías propuestas" },
    },
  },
  multimedia: {
    titulo: "Multimedia", descripcion: "Límites de archivos.",
    campos: {
      maxFotos: { etiqueta: "Fotos por especialista", min: 1, max: 100 },
      maxImagenMB: { etiqueta: "Tamaño máximo de imagen (MB)", min: 1, max: 50, ayuda: "El límite técnico del servidor se define en config/index.js." },
      maxVideoMB: { etiqueta: "Tamaño máximo de video (MB)", min: 1, max: 500 },
      maxDocumentoMB: { etiqueta: "Tamaño máximo de documento (MB)", min: 1, max: 50 },
    },
  },
  avisos: {
    titulo: "Avisos", descripcion: "Recordatorios automáticos.",
    campos: {
      recordatorioHoras: { etiqueta: "Primer recordatorio (horas antes)", min: 0, max: 168 },
      segundoRecordatorioHoras: { etiqueta: "Segundo recordatorio (horas antes)", min: 0, max: 48 },
      volverAReservarDias: { etiqueta: "Sugerir volver a reservar (días después)", min: 0, max: 365 },
      emailAlertas: { etiqueta: "Email para alertas de administración", tipo: "email" },
    },
  },
  automatizacion: {
    titulo: "Automatización", descripcion: "Tareas que corren solas.",
    campos: { cerrarDespuesHoras: { etiqueta: "Marcar sesiones como realizadas (horas después)", min: 1, max: 168 } },
  },
};

/** Convierte el formulario en valores tipados según el valor por defecto de cada campo, y valida. */
function leerSeccion(seccion, body, base) {
  const def = SECCIONES[seccion];
  if (!def || !base) throw invalido("Sección no válida.");
  const valores = {};
  for (const [clave, actual] of Object.entries(base)) {
    const meta = def.campos[clave] || {};
    const crudo = body[clave];
    if (typeof actual === "boolean") valores[clave] = ["on", "1", "true"].includes(String(crudo));
    else if (typeof actual === "number") {
      if (crudo === undefined || crudo === "") continue;
      const n = Number(String(crudo).replace(",", "."));
      if (!Number.isFinite(n)) throw invalido(`Valor no válido en "${meta.etiqueta || clave}".`);
      if ((meta.min !== undefined && n < meta.min) || (meta.max !== undefined && n > meta.max)) throw invalido(`"${meta.etiqueta || clave}" tiene que estar entre ${meta.min} y ${meta.max}.`);
      valores[clave] = n;
    } else if (typeof actual === "string") {
      if (crudo === undefined) continue;
      const v = String(crudo).trim().slice(0, 500);
      if (meta.opciones && !meta.opciones[v]) throw invalido(`Opción no válida en "${meta.etiqueta || clave}".`);
      valores[clave] = v;
    }
  }
  const final = { ...base, ...valores };
  if (seccion === "cancelacion" && final.horasReembolsoParcial > final.horasReembolsoTotal) throw invalido("Las horas del reembolso parcial tienen que ser menores que las del reembolso total.");
  if (seccion === "sitio" && final.whatsappSoporte && !/^\d{8,15}$/.test(final.whatsappSoporte)) throw invalido("El WhatsApp de soporte va en formato internacional, solo números (ej. 59899123456).");
  return valores;
}

module.exports = { SECCIONES, leerSeccion };
