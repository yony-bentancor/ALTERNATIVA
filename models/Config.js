/*
 * Configuración de negocio editable desde Administración → Configuración (sin tocar código).
 * Es un único documento con secciones; lo que no se guardó toma el valor por defecto.
 */
const store = require("../config/store");

const PREDETERMINADA = Object.freeze({
  sitio: {
    nombre: "Alternativa",
    lema: "Terapias, bienestar y disciplinas alternativas, con especialistas reales y reseñas verificadas.",
    email: "hola@alternativa.uy",
    // Número de WhatsApp de soporte (formato internacional sin +: 59899123456). Vacío = sin botón.
    whatsappSoporte: "59899000000",
    instagram: "alternativa.uy",
    mantenimiento: false,
    altaEspecialistas: true,
  },
  comision: {
    tasaGeneral: 5,
    // sumada: el cliente paga precio del especialista + tarifa ($900 + 5% = $945) | incluida
    modo: "sumada",
    // desglose: "Servicio $900 + tarifa $45" | total: solo "Total $945"
    mostrarPrecio: "desglose",
    etiqueta: "Tarifa de servicio",
  },
  pagos: {
    // split: pago único y la pasarela divide (Mercado Pago marketplace) | plataforma | offline
    modelo: "split",
    minutosParaPagar: 20,
    // Costo estimado del procesador (% con IVA). La comisión real de cada pago se guarda al acreditarse.
    comisionProcesador: 6.09,
    // Quién absorbe el costo del procesador: especialista | cliente | plataforma
    procesadorPaga: "especialista",
    exigirCuentaVinculada: true,
    frecuenciaLiquidacion: 7,
    minimoLiquidacion: 0,
  },
  cancelacion: {
    horasReembolsoTotal: 24,
    horasReembolsoParcial: 6,
    porcentajeParcial: 50,
    porcentajeTardio: 0,
    porcentajeAusenciaUsuario: 0,
    porcentajeCancelaEspecialista: 100,
    porcentajeAusenciaEspecialista: 100,
    horasMinReprogramar: 12,
    maxReprogramaciones: 2,
  },
  resenas: { pedirDespuesHoras: 2, diasEdicion: 7, diasParaValorar: 60, pesoBayes: 10, promedioBase: 4.4 },
  descubrimiento: { diasNuevo: 90, maxResenasNuevo: 5, nuevoCada: 6, lugaresPatrocinados: 2 },
  contacto: {
    // Datos de contacto dentro del chat: siempre | despues_reserva | nunca
    politicaChat: "despues_reserva",
    // Botón de WhatsApp del especialista: siempre | despues_reserva | nunca
    whatsappEspecialista: "despues_reserva",
  },
  moderacion: {
    especialistasNuevos: true,
    cambiosSensibles: true,
    serviciosNuevos: false,
    multimedia: false,
    categoriasNuevas: true,
  },
  multimedia: { maxFotos: 24, maxImagenMB: 8, maxVideoMB: 60, maxDocumentoMB: 10 },
  avisos: { recordatorioHoras: 24, segundoRecordatorioHoras: 2, volverAReservarDias: 30, emailAlertas: "" },
  automatizacion: { cerrarDespuesHoras: 3 },
});

function fusionar(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && base && typeof base[k] === "object" && !Array.isArray(base[k])) out[k] = fusionar(base[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

class Config {
  static PREDETERMINADA = PREDETERMINADA;
  static fusionar = fusionar;

  /** Configuración completa (guardada + valores por defecto). */
  static async obtener() {
    const datos = store.cargar();
    return fusionar(PREDETERMINADA, datos.config || {});
  }

  /** Reemplaza una sección. Devuelve el valor anterior y el nuevo (para auditoría). */
  static async actualizarSeccion(seccion, valores) {
    if (!PREDETERMINADA[seccion]) throw new Error(`Sección de configuración desconocida: ${seccion}`);
    const datos = store.cargar();
    datos.config = datos.config || {};
    const antes = (await this.obtener())[seccion];
    const despues = fusionar(antes, valores);
    datos.config[seccion] = despues;
    store.guardar();
    return { antes, despues };
  }
}

module.exports = Config;
