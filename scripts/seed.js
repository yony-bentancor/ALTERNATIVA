/*
 * Datos de prueba de Alternativa.
 *
 *   npm run seed        -> borra los datos actuales y genera todo de nuevo
 *
 * Se generan relativos a la fecha de hoy: reservas pasadas y futuras, pagos, reseñas, mensajes,
 * estadísticas de los últimos 60 días, etc. Todos los nombres, teléfonos y direcciones son inventados.
 * Las imágenes de public/img/demo son ilustraciones propias (sin derechos de terceros).
 *
 * Usuarios de prueba (contraseña: CLAVE_DEMO, por defecto "alternativa2026"):
 *   admin@alternativa.uy               Administración
 *   especialista@alternativa.uy        Especialista con agenda, cobros, reseñas y estadísticas
 *   reiki@alternativa.uy               Especialista con verificación de identidad pendiente
 *   nuevo.especialista@alternativa.uy  Especialista recién registrado (ficha en borrador)
 *   usuario@alternativa.uy             Usuario con reservas, reseñas, favoritos y mensajes
 *   nuevo.usuario@alternativa.uy       Usuario recién registrado
 */
const fs = require("fs");
const path = require("path");
const config = require("../config");
const F = require("../services/fechas");
const { hashClave, hashToken } = require("../services/claves");
const { desglose, repartirReembolso } = (() => ({ desglose: require("../services/comision").desglose, repartirReembolso: require("../services/cancelacion").repartirReembolso }))();
const { bayesiano } = require("../services/ranking");
const { slug } = require("../services/util");
const { paginas, preguntas } = require("./contenido-paginas");
const { PREDETERMINADA } = require("../models/Config");

// Generador pseudoaleatorio con semilla: los datos salen iguales cada vez.
function crearAzar(semilla) {
  let a = semilla >>> 0;
  const r = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.entre = (min, max) => min + Math.floor(r() * (max - min + 1));
  r.uno = (arr) => arr[Math.floor(r() * arr.length)];
  r.muestra = (arr, n) => { const c = arr.slice(); for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c.slice(0, n); };
  r.prob = (p) => r() < p;
  return r;
}

// ── Datos de referencia ──────────────────────────────────
const CATEGORIAS = [
  ["masajes", "Masajes", "hands", "#3B82F6", "Descontracturantes, relajantes, deportivos y con piedras calientes.", true],
  ["yoga", "Yoga", "lotus", "#8B5CF6", "Clases individuales y grupales: hatha, vinyasa, yin y yoga terapéutico.", true],
  ["reiki", "Reiki", "sparkle", "#7C3AED", "Sesiones presenciales y a distancia para armonizar y relajar.", true],
  ["acupuntura", "Acupuntura", "needle", "#2563EB", "Medicina tradicional china: acupuntura, moxibustión y ventosas.", true],
  ["meditacion", "Meditación", "breath", "#6D597A", "Meditación guiada, mindfulness y respiración consciente.", true],
  ["reflexologia", "Reflexología", "leaf", "#059669", "Reflexología podal y de manos para el bienestar general.", true],
  ["aromaterapia", "Aromaterapia", "leaf", "#B5657A", "Aceites esenciales, masajes aromáticos y asesoramiento.", false],
  ["flores-de-bach", "Flores de Bach", "sun", "#D97706", "Consultas y preparados personalizados de esencias florales.", false],
  ["sonoterapia", "Sonoterapia", "globe", "#264653", "Cuencos tibetanos, gong y baños de sonido.", false],
  ["astrologia-y-tarot", "Astrología y tarot", "moon", "#3D405B", "Cartas natales, revolución solar y lecturas de tarot.", false],
  ["nutricion-holistica", "Nutrición holística", "heart", "#81B29A", "Alimentación consciente y planes personalizados.", false],
  ["tai-chi", "Tai chi y chi kung", "yinyang", "#1E3A6E", "Movimiento, energía y equilibrio para todas las edades.", false],
];

const LUGARES = {
  pocitos: { departamento: "Montevideo", ciudad: "Montevideo", barrio: "Pocitos", lat: -34.9093, lng: -56.1505, calle: "Benito Blanco" },
  puntaCarretas: { departamento: "Montevideo", ciudad: "Montevideo", barrio: "Punta Carretas", lat: -34.9226, lng: -56.1591, calle: "Ellauri" },
  cordon: { departamento: "Montevideo", ciudad: "Montevideo", barrio: "Cordón", lat: -34.9017, lng: -56.1801, calle: "Gaboto" },
  malvin: { departamento: "Montevideo", ciudad: "Montevideo", barrio: "Malvín", lat: -34.8902, lng: -56.1093, calle: "Michigan" },
  carrasco: { departamento: "Montevideo", ciudad: "Montevideo", barrio: "Carrasco", lat: -34.8849, lng: -56.0553, calle: "Arocena" },
  centro: { departamento: "Montevideo", ciudad: "Montevideo", barrio: "Centro", lat: -34.9058, lng: -56.1913, calle: "Paraguay" },
  parqueRodo: { departamento: "Montevideo", ciudad: "Montevideo", barrio: "Parque Rodó", lat: -34.9124, lng: -56.1682, calle: "Jackson" },
  buceo: { departamento: "Montevideo", ciudad: "Montevideo", barrio: "Buceo", lat: -34.8983, lng: -56.1352, calle: "Comercio" },
  prado: { departamento: "Montevideo", ciudad: "Montevideo", barrio: "Prado", lat: -34.8604, lng: -56.2049, calle: "Lucas Obes" },
  ciudadVieja: { departamento: "Montevideo", ciudad: "Montevideo", barrio: "Ciudad Vieja", lat: -34.9068, lng: -56.2071, calle: "Sarandí" },
  puntaDelEste: { departamento: "Maldonado", ciudad: "Punta del Este", barrio: "Península", lat: -34.9623, lng: -54.9458, calle: "Gorlero" },
  maldonado: { departamento: "Maldonado", ciudad: "Maldonado", barrio: "Centro", lat: -34.9087, lng: -54.9581, calle: "Sarandí" },
  ciudadCosta: { departamento: "Canelones", ciudad: "Ciudad de la Costa", barrio: "Solymar", lat: -34.8181, lng: -55.9902, calle: "Av. Giannattasio" },
  atlantida: { departamento: "Canelones", ciudad: "Atlántida", barrio: "Centro", lat: -34.7718, lng: -55.7588, calle: "Calle 11" },
  colonia: { departamento: "Colonia", ciudad: "Colonia del Sacramento", barrio: "Barrio Histórico", lat: -34.4713, lng: -57.8442, calle: "Gral. Flores" },
  salto: { departamento: "Salto", ciudad: "Salto", barrio: "Centro", lat: -31.3882, lng: -57.9634, calle: "Uruguay" },
  piriapolis: { departamento: "Maldonado", ciudad: "Piriápolis", barrio: "Centro", lat: -34.8662, lng: -55.2745, calle: "Rambla de los Argentinos" },
};

const NOMBRES = ["Sofía", "Valentina", "Martina", "Camila", "Lucía", "Florencia", "Agustina", "Micaela", "Paula", "Carolina", "Natalia", "Fernanda", "Gabriela", "Andrea", "Mariana", "Victoria", "Julieta", "Rocío", "Josefina", "Inés",
  "Mateo", "Santiago", "Nicolás", "Juan", "Matías", "Federico", "Diego", "Gonzalo", "Pablo", "Sebastián", "Rodrigo", "Andrés", "Facundo", "Martín", "Bruno", "Ignacio", "Joaquín", "Tomás", "Emiliano", "Gastón"];
const APELLIDOS = ["Rodríguez", "González", "Fernández", "López", "Martínez", "Pérez", "García", "Sánchez", "Romero", "Sosa", "Álvarez", "Torres", "Ruiz", "Ramírez", "Flores", "Benítez", "Acosta", "Medina", "Herrera", "Suárez",
  "Silva", "Pereira", "Castro", "Rivero", "Núñez", "Cabrera", "Olivera", "Méndez", "Correa", "Viera", "Píriz", "Techera", "Bentancor", "Morales", "Vázquez", "Da Silva", "Cardozo", "Ferreira", "Borges", "Luzardo"];

// Especialistas: [nombre, demo, categorías, lugar, años, titular, servicios[[título, duración, precio, modalidades, resumen]], popularidad (cantidad de sesiones pasadas), extras]
const ESPECIALISTAS = [
  ["Lucía Fernández", "especialista", ["masajes", "reflexologia"], "pocitos", 12, "Masoterapeuta · masajes descontracturantes y reflexología",
    [["Masaje descontracturante", 60, 1500, ["presencial", "domicilio"], "Para cuello, espalda y hombros cargados por el estrés o el trabajo de oficina."],
      ["Masaje relajante con piedras calientes", 75, 1900, ["presencial"], "Piedras volcánicas a temperatura controlada y aceites tibios."],
      ["Reflexología podal", 50, 1200, ["presencial", "domicilio"], "Presión en zonas reflejas del pie para aliviar tensiones."],
      ["Masaje deportivo", 60, 1700, ["presencial"], "Antes o después de competir: recuperación muscular y prevención."]], 46,
    { verificado: true, mp: true, plan: "profesional", video: "masajes", whatsapp: "099 123 456", mostrarWhatsapp: true, publicadoDias: 420, avatar: 1 }],
  ["Martín Sosa", "reiki", ["reiki", "meditacion"], "cordon", 7, "Maestro de reiki Usui y facilitador de meditación",
    [["Sesión de reiki", 60, 1300, ["presencial", "online"], "Canalización de energía para relajar, armonizar y bajar la ansiedad."],
      ["Reiki a distancia", 45, 1000, ["online"], "La misma sesión, desde tu casa, por videollamada."],
      ["Meditación guiada individual", 45, 900, ["presencial", "online"], "Técnicas simples para empezar a meditar y sostener la práctica."]], 18,
    { verificado: false, verificacionPendiente: true, mp: true, whatsapp: "098 765 432", mostrarWhatsapp: true, publicadoDias: 150, avatar: 4 }],
  ["Diego Pereira", "nuevo.especialista", ["tai-chi"], "prado", 3, "Instructor de tai chi estilo Yang",
    [], 0, { borrador: true, mp: false, avatar: 0 }],
  ["Valentina Romero", null, ["yoga", "meditacion"], "parqueRodo", 9, "Profesora de yoga · hatha, yin y yoga terapéutico",
    [["Clase de yoga individual", 60, 1400, ["presencial", "online", "domicilio"], "Una práctica adaptada a tu cuerpo, tu nivel y tus objetivos."],
      ["Yoga terapéutico para la espalda", 60, 1500, ["presencial", "online"], "Secuencias suaves para dolores lumbares y cervicales."],
      ["Yin yoga y respiración", 75, 1300, ["presencial"], "Posturas pasivas sostenidas y pranayama para soltar."]], 38,
    { verificado: true, mp: true, plan: "profesional", video: "yoga", publicadoDias: 380, avatar: 2 }],
  ["Akira Kobayashi", null, ["acupuntura"], "centro", 20, "Acupunturista · medicina tradicional china",
    [["Sesión de acupuntura", 50, 1800, ["presencial"], "Diagnóstico por pulso y lengua y tratamiento con agujas descartables."],
      ["Acupuntura y ventosas", 60, 2100, ["presencial"], "Combinación para contracturas y dolor muscular."],
      ["Auriculoterapia", 30, 900, ["presencial"], "Semillas y puntos en la oreja para ansiedad, sueño y hábitos."]], 41,
    { verificado: true, mp: true, publicadoDias: 600, avatar: 6 }],
  ["Carolina Méndez", null, ["meditacion", "sonoterapia"], "carrasco", 6, "Meditación y baños de sonido con cuencos",
    [["Baño de sonido con cuencos tibetanos", 60, 1600, ["presencial", "domicilio"], "Vibraciones que relajan el sistema nervioso; traé ropa cómoda."],
      ["Mindfulness para el estrés", 50, 1100, ["online", "presencial"], "Programa práctico de atención plena en sesiones individuales."]], 22,
    { verificado: true, mp: true, video: "meditacion", publicadoDias: 260, avatar: 9 }],
  ["Gonzalo Viera", null, ["masajes"], "puntaDelEste", 10, "Masajes deportivos y descontracturantes en Punta del Este",
    [["Masaje descontracturante profundo", 60, 1800, ["presencial", "domicilio"], "Trabajo de tejido profundo para contracturas persistentes."],
      ["Masaje relajante en tu casa o hotel", 60, 2200, ["domicilio"], "Llevo camilla, aceites y música: vos solo relajate."]], 25,
    { verificado: true, mp: true, publicadoDias: 300, avatar: 12, radioKm: 15 }],
  ["Inés Cabrera", null, ["flores-de-bach", "aromaterapia"], "malvin", 8, "Terapeuta floral y aromaterapeuta",
    [["Consulta de flores de Bach", 60, 1200, ["presencial", "online"], "Entrevista y preparado personalizado para tus emociones."],
      ["Masaje aromático", 60, 1500, ["presencial"], "Masaje suave con una sinergia de aceites esenciales elegida para vos."],
      ["Asesoramiento en aromaterapia", 40, 800, ["online"], "Aprendé a usar aceites esenciales en casa de forma segura."]], 20,
    { verificado: false, mp: true, publicadoDias: 200, avatar: 5 }],
  ["Rocío Benítez", null, ["astrologia-y-tarot"], "ciudadVieja", 11, "Astróloga · cartas natales y revolución solar",
    [["Carta natal", 90, 2200, ["online", "presencial"], "Lectura completa de tu carta natal con grabación incluida."],
      ["Revolución solar", 60, 1700, ["online"], "Qué trae tu nuevo año astrológico, en una sesión clara y práctica."],
      ["Lectura de tarot", 45, 1100, ["online", "presencial"], "Tarot evolutivo para mirar una situación desde otro lugar."]], 30,
    { verificado: true, mp: true, publicadoDias: 340, avatar: 7 }],
  ["Federico Suárez", null, ["nutricion-holistica"], "buceo", 5, "Nutricionista con enfoque integrativo",
    [["Primera consulta de nutrición holística", 60, 1900, ["presencial", "online"], "Hábitos, digestión, descanso y plan de alimentación personalizado."],
      ["Control y seguimiento", 30, 1100, ["presencial", "online"], "Ajustes del plan y acompañamiento mensual."]], 16,
    { verificado: true, mp: true, publicadoDias: 120, avatar: 10 }],
  ["Mariana Olivera", null, ["yoga"], "ciudadCosta", 4, "Yoga para embarazadas y posparto",
    [["Yoga prenatal individual", 60, 1300, ["presencial", "domicilio", "online"], "Movilidad, respiración y preparación para el parto."],
      ["Yoga posparto", 60, 1300, ["presencial", "online"], "Recuperación del suelo pélvico y del abdomen, a tu ritmo."]], 3,
    { verificado: false, mp: true, publicadoDias: 25, avatar: 13 }],
  ["Tomás Correa", null, ["tai-chi"], "parqueRodo", 15, "Tai chi y chi kung para la salud",
    [["Clase de tai chi individual", 60, 1100, ["presencial"], "Forma Yang de 24 movimientos, desde cero."],
      ["Chi kung para adultos mayores", 45, 900, ["presencial", "domicilio"], "Ejercicios suaves para equilibrio, movilidad y respiración."]], 14,
    { verificado: true, mp: true, publicadoDias: 230, avatar: 14 }],
  ["Gabriela Luzardo", null, ["reflexologia", "masajes"], "atlantida", 9, "Reflexología y masaje californiano en la Costa de Oro",
    [["Reflexología integral", 60, 1200, ["presencial", "domicilio"], "Pies, manos y orejas: una sesión completa y muy relajante."],
      ["Masaje californiano", 60, 1400, ["presencial"], "Movimientos largos y envolventes para una relajación profunda."]], 12,
    { verificado: true, mp: true, publicadoDias: 190, avatar: 17 }],
  ["Sebastián Núñez", null, ["sonoterapia"], "colonia", 6, "Gong y cuencos en Colonia del Sacramento",
    [["Baño de gong", 60, 1300, ["presencial"], "Inmersión sonora con gong planetario. Cupos individuales."],
      ["Sonoterapia a domicilio", 75, 2000, ["domicilio"], "Sesión con cuencos, gong y campanas en tu espacio."]], 2,
    { verificado: false, mp: true, publicadoDias: 15, avatar: 18 }],
  ["Paula Techera", null, ["reiki", "flores-de-bach"], "salto", 6, "Reiki y terapia floral en Salto",
    [["Sesión de reiki presencial", 60, 1000, ["presencial"], "Reiki con imposición de manos en un espacio cálido y tranquilo."],
      ["Flores de Bach a distancia", 45, 900, ["online"], "Consulta por videollamada y envío del preparado."]], 9,
    { verificado: false, mp: true, publicadoDias: 75, avatar: 21 }],
  ["Joaquín Píriz", null, ["acupuntura", "masajes"], "maldonado", 8, "Acupuntura y masaje tuina",
    [["Acupuntura para dolor", 50, 1700, ["presencial"], "Lumbalgia, cervicalgia, tendinitis y dolores crónicos."],
      ["Masaje tuina", 50, 1500, ["presencial"], "Masaje terapéutico chino con presiones y estiramientos."]], 19,
    { verificado: true, mp: true, publicadoDias: 280, avatar: 22 }],
  ["Florencia Rivero", null, ["meditacion"], "pocitos", 3, "Meditación para niños y adolescentes",
    [["Meditación para niños (6 a 12 años)", 40, 900, ["presencial", "online"], "Juegos de atención y respiración, con un adulto presente."]], 1,
    { verificado: false, mp: true, publicadoDias: 10, avatar: 25 }],
  ["Andrés Morales", null, ["astrologia-y-tarot"], "piriapolis", 14, "Tarot terapéutico y numerología",
    [["Tarot terapéutico", 60, 1200, ["online", "presencial"], "Una lectura para reflexionar, no para predecir."],
      ["Numerología personal", 60, 1300, ["online"], "Tus números y ciclos personales explicados con claridad."]], 8,
    { verificado: false, mp: true, publicadoDias: 110, avatar: 26 }],
  ["Natalia Ferreira", null, ["aromaterapia", "masajes"], "puntaCarretas", 6, "Masajes con aromaterapia",
    [["Masaje relajante con aceites esenciales", 60, 1600, ["presencial", "domicilio"], "Una pausa profunda con aceites elegidos según tu momento."]], 11,
    { verificado: true, mp: true, publicadoDias: 160, avatar: 29, enRevisionCambios: true }],
  // Perfil cargado por administración y todavía no reclamado: se ve, pero no recibe reservas online.
  ["Centro Shanti", null, ["yoga", "meditacion"], "malvin", 18, "Escuela de yoga y meditación en Malvín",
    [["Clase de prueba de hatha yoga", 75, 900, ["presencial"], "Vení a conocer el centro en una clase grupal."]], 0,
    { sinReclamar: true, tokenReclamo: "demo-reclamar-shanti", publicadoDias: 30, avatar: null }],
  // Especialista que pidió alta y espera aprobación de administración.
  ["Camila Herrera", null, ["reflexologia"], "colonia", 2, "Reflexología podal en Colonia",
    [["Reflexología relajante", 50, 1000, ["presencial"], "Una sesión para soltar el cansancio de las piernas y los pies."]], 0,
    { enRevision: true, mp: true, avatar: 30 }],
];

const COMENTARIOS = {
  5: ["Excelente, salí como nueva. Muy profesional y atenta.", "Una experiencia increíble, ya reservé la próxima.", "Súper recomendable. Puntual, cálida y el espacio es muy lindo.", "Me ayudó muchísimo con lo que venía arrastrando hace meses.", "Todo impecable, desde la reserva hasta la sesión.", "Hacía años que no me sentía tan bien. Gracias.", "Muy clara para explicar y con mucha paciencia.", "Lo mejor que me pasó esta semana. Volveré seguro."],
  4: ["Muy buena sesión, el lugar un poco difícil de encontrar.", "Me gustó mucho, quizás un poco corta para mi gusto.", "Muy bien, aunque empezamos unos minutos tarde.", "Buena experiencia, la voy a repetir."],
  3: ["Correcto, esperaba un poco más.", "Bien en general, aunque no terminé de conectar."],
  2: ["No era lo que esperaba, aunque fue amable."],
};

// ── Generación ───────────────────────────────────────────
function generar({ ahora = new Date(), conImagenes = true } = {}) {
  const r = crearAzar(2026);
  let seq = 1000;
  const id = (p) => `${p}${++seq}`;
  const iso = (d) => new Date(d).toISOString();
  const hace = (dias, horas = 0) => new Date(ahora.getTime() - dias * 86400000 - horas * 3600000).toISOString();
  const hoy = F.hoy(F.ZONA, ahora);
  const clave = hashClave(config.claveDemo);
  const d = {
    meta: { secuencia: 1000, generado: iso(ahora), contadores: {} },
    config: {}, usuarios: [], especialistas: [], servicios: [], categorias: [], agendas: [], reservas: [], pagos: [], reembolsos: [], liquidaciones: [],
    reglasComision: [], promociones: [], destacados: [], multimedia: [], certificaciones: [], verificaciones: [], resenas: [], favoritos: [],
    conversaciones: [], mensajes: [], notificaciones: [], consultas: [], denuncias: [], auditoria: [], estadisticas: [], contenidos: [],
  };
  const num = (k) => (d.meta.contadores[k] = (d.meta.contadores[k] || 0) + 1);
  const cfg = PREDETERMINADA;

  // Categorías
  const cat = {};
  CATEGORIAS.forEach(([s, nombre, icono, color, descripcion, destacada], i) => {
    cat[s] = {
      id: id("c"), creado: hace(500), nombre, slug: s, descripcion, icono, color, imagen: `/img/demo/categorias/${s}.jpg`, estado: "activa", orden: i, destacada,
      descripcionLarga: `${descripcion}\n\nEn Alternativa encontrás especialistas de ${nombre.toLowerCase()} en todo Uruguay, con precios finales, disponibilidad en tiempo real y reseñas verificadas de personas que hicieron la sesión.`,
      seo: { titulo: `${nombre} en Uruguay`, descripcion: `Reservá ${nombre.toLowerCase()} con especialistas verificados y reseñas reales.` },
    };
    d.categorias.push(cat[s]);
  });
  d.categorias.push({ id: id("c"), creado: hace(3), nombre: "Biodescodificación", slug: "biodescodificacion", descripcion: "Propuesta por un especialista, pendiente de aprobación.", icono: "leaf", color: "#6B7280", imagen: "", estado: "pendiente", orden: 99, destacada: false, descripcionLarga: "", seo: {} });

  // Usuarios
  const usuario = (nombre, email, rol, extra = {}) => {
    const u = {
      id: id("u"), creado: extra.creado || hace(r.entre(30, 400)), nombre, email, clave, rol, telefono: extra.telefono || `09${r.entre(1, 9)} ${r.entre(100, 999)} ${r.entre(100, 999)}`,
      avatar: extra.avatar || "", estado: "activo", emailVerificado: true, especialistaId: null,
      ubicacion: extra.ubicacion || { departamento: "Montevideo", ciudad: "Montevideo", barrio: r.uno(["Pocitos", "Cordón", "Malvín", "Buceo", "Centro", "Parque Rodó"]) },
      preferencias: { avisos: { email: true, push: true, whatsapp: !!extra.whatsapp, marketing: false } },
      privacidad: { soloNombre: true, compartirContacto: true }, metodosPago: extra.metodosPago || [], aceptoTerminos: hace(200), ultimoIngreso: hace(r.entre(0, 20)),
      prueba: extra.prueba || null,
    };
    d.usuarios.push(u);
    return u;
  };
  const admin = usuario("Valeria Acosta", "admin@alternativa.uy", "admin", { prueba: "Administración (panel completo)", avatar: "/img/demo/avatares/a20.jpg", creado: hace(600) });
  const sofia = usuario("Sofía Rodríguez", "usuario@alternativa.uy", "usuario", {
    prueba: "Usuario con reservas, reseñas, favoritos y mensajes", avatar: "/img/demo/avatares/a03.jpg", telefono: "099 555 010", whatsapp: true, creado: hace(220),
    ubicacion: { departamento: "Montevideo", ciudad: "Montevideo", barrio: "Pocitos" },
    metodosPago: [{ id: "mp1", etiqueta: "Visa terminada en 4242", marca: "Visa", ultimos4: "4242", predeterminado: true }],
  });
  const juan = usuario("Juan Martínez", "nuevo.usuario@alternativa.uy", "usuario", { prueba: "Usuario recién registrado (sin reservas)", creado: hace(1), telefono: "098 444 222" });
  juan.emailVerificado = false;
  const clientes = [sofia];
  for (let i = 0; i < 34; i++) {
    const n = NOMBRES[i % NOMBRES.length]; const a = APELLIDOS[(i * 7) % APELLIDOS.length];
    clientes.push(usuario(`${n} ${a}`, `${slug(n)}.${slug(a)}${i}@ejemplo.uy`, "usuario", { avatar: i % 3 === 0 ? `/img/demo/avatares/a${String((i % 32) + 1).padStart(2, "0")}.jpg` : "" }));
  }

  // Especialistas, servicios, agenda, multimedia
  const esp = [];
  const servicios = [];
  ESPECIALISTAS.forEach(([nombre, demo, cats, lugar, anios, titular, svcs, popularidad, x], i) => {
    const L = LUGARES[lugar];
    let u = null;
    if (!x.sinReclamar) {
      const email = demo ? `${demo}@alternativa.uy` : `${slug(nombre).replace(/-/g, ".")}@ejemplo.uy`;
      const etiqueta = { especialista: "Especialista con agenda, cobros, reseñas y estadísticas", reiki: "Especialista con verificación de identidad pendiente", "nuevo.especialista": "Especialista recién registrado (ficha en borrador)" }[demo];
      u = usuario(nombre, email, "especialista", { prueba: etiqueta || null, avatar: x.avatar ? `/img/demo/avatares/a${String(x.avatar).padStart(2, "0")}.jpg` : "", telefono: x.whatsapp || undefined, ubicacion: { departamento: L.departamento, ciudad: L.ciudad, barrio: L.barrio }, creado: hace((x.publicadoDias || 5) + 10) });
    }
    const estado = x.borrador ? "borrador" : x.enRevision ? "en_revision" : "activo";
    const publicado = estado === "activo" ? hace(x.publicadoDias || 60) : null;
    const galeriaCats = cats.flatMap((c) => [1, 2, 3, 4].map((k) => `/img/demo/galeria/${c}-${k}.jpg`));
    const fotos = x.borrador ? [] : r.muestra(galeriaCats, Math.min(galeriaCats.length, r.entre(4, 6)));
    const e = {
      id: id("e"), creado: hace((x.publicadoDias || 5) + 5), usuarioId: u ? u.id : null, slug: slug(nombre), nombre, titular,
      bio: x.borrador ? "Instructor de tai chi." : `Hola, soy ${nombre.split(" ")[0]}. Hace ${anios} años que acompaño a personas que buscan sentirse mejor a través de ${cats.map((c) => cat[c].nombre.toLowerCase()).join(" y ")}. Trabajo con respeto, escucha y un enfoque práctico: cada sesión se adapta a lo que necesitás ese día. Atiendo en ${L.barrio}, ${L.ciudad}${svcs.some((s) => s[3].includes("online")) ? " y también online" : ""}.`,
      experiencia: x.borrador ? "" : `${anios} años de práctica profesional. Atención individual y talleres grupales.`,
      anios, formacion: x.borrador ? "" : `Formación en ${cat[cats[0]].nombre.toLowerCase()} con certificación internacional. Cursos de actualización permanentes.`,
      idiomas: r.prob(0.3) ? ["Español", "Inglés"] : ["Español"],
      telefono: x.whatsapp || `09${r.entre(1, 9)} ${r.entre(100, 999)} ${r.entre(100, 999)}`, whatsapp: x.whatsapp || `09${r.entre(1, 9)} ${r.entre(100, 999)} ${r.entre(100, 999)}`,
      mostrarWhatsapp: x.mostrarWhatsapp ?? r.prob(0.7),
      categorias: cats.map((c) => cat[c].id), modalidades: [...new Set(svcs.flatMap((s) => s[3]))].length ? [...new Set(svcs.flatMap((s) => s[3]))] : ["presencial"],
      ubicacion: { ...L, direccion: `${L.calle} ${r.entre(100, 3500)}${r.prob(0.5) ? `, apto ${r.entre(1, 12)}0${r.entre(1, 4)}` : ""}`, referencia: `${L.barrio}, cerca de ${L.calle}`, radioKm: x.radioKm || 8, calle: undefined },
      avatar: x.avatar ? `/img/demo/avatares/a${String(x.avatar).padStart(2, "0")}.jpg` : x.sinReclamar ? `/img/demo/categorias/${cats[0]}.jpg` : "",
      portada: x.borrador ? "" : `/img/demo/categorias/${cats[0]}.jpg`,
      video: x.video ? `/img/demo/videos/${x.video}.mp4` : "", poster: x.video ? `/img/demo/videos/${x.video}.jpg` : "",
      redes: { instagram: x.borrador ? "" : slug(nombre).replace(/-/g, "."), web: "" },
      diseno: { variante: ["clasica", "serena", "luminosa"][i % 3], orden: ["servicios", "sobre", "galeria", "video", "resenas", "ubicacion"], videoPrimero: false },
      estado, motivoEstado: "", publicado,
      verificacion: x.verificado ? { estado: "verificada", fecha: hace((x.publicadoDias || 30) - 3), nota: "Cédula verificada" } : x.verificacionPendiente ? { estado: "pendiente" } : { estado: "ninguna" },
      reclamo: x.sinReclamar ? { estado: "invitado", tokenHash: hashToken(x.tokenReclamo), email: "contacto@centroshanti.example", invitado: hace(5), vence: new Date(ahora.getTime() + 25 * 86400000).toISOString() } : { estado: "propio" },
      cambiosPendientes: x.enRevisionCambios ? [{ campo: "nombre", valor: "Natalia Ferreira · Aromaterapia", fecha: hace(1) }] : [],
      ajustes: { autoConfirmar: demo !== "reiki", permitirReprogramar: true }, comision: null,
      facturacion: { razonSocial: nombre, rut: "", tipo: "monotributo", metodo: "mercadopago", email: u?.email || "" },
      mercadopago: x.mp && !x.sinReclamar ? { usuarioMp: String(100000000 + i), conectado: hace((x.publicadoDias || 30) - 1), simulado: true, publicKey: "TEST-DEMO" } : {},
      stats: {}, plan: x.plan || "gratis", planVence: x.plan ? new Date(ahora.getTime() + 40 * 86400000).toISOString() : null, creadoPor: x.sinReclamar ? admin.id : null,
    };
    if (u) u.especialistaId = e.id;
    d.especialistas.push(e);
    esp.push({ e, u, x, popularidad, cats });

    // Agenda
    const semanal = demo === "reiki"
      ? [2, 3, 4, 5, 6].map((dia) => ({ dia, rangos: [{ inicio: "10:00", fin: "13:00" }, { inicio: "15:00", fin: "20:00" }] }))
      : demo === "especialista"
        ? [1, 2, 3, 4, 5].map((dia) => ({ dia, rangos: [{ inicio: "09:00", fin: "13:00" }, { inicio: "14:00", fin: "20:00" }] })).concat([{ dia: 6, rangos: [{ inicio: "09:00", fin: "13:00" }] }])
        : [1, 2, 3, 4, 5].map((dia) => ({ dia, rangos: [{ inicio: "09:00", fin: "13:00" }, { inicio: "14:00", fin: "19:00" }] }));
    const agenda = { id: id("a"), creado: e.creado, especialistaId: e.id, zona: "America/Montevideo", semanal, descansos: [], excepciones: [], vacaciones: [], bloqueos: [], paso: 15, buffer: demo === "especialista" ? 10 : 0, avisoMin: 120, anticipacionMax: 60, limiteDiario: 0 };
    if (demo === "especialista") {
      agenda.excepciones.push({ fecha: F.sumarDias(hoy, 18), tipo: "cerrado", rangos: [], nota: "Curso de actualización" });
      agenda.excepciones.push({ fecha: F.sumarDias(hoy, 11), tipo: "especial", rangos: [{ inicio: "15:00", fin: "21:00" }], nota: "Solo de tarde" });
      agenda.vacaciones.push({ desde: F.sumarDias(hoy, 40), hasta: F.sumarDias(hoy, 47), motivo: "Vacaciones" });
      const b = F.sumarDias(hoy, 2);
      agenda.bloqueos.push({ id: "b1", inicio: F.aUtc(b, "13:00").toISOString(), fin: F.aUtc(b, "15:00").toISOString(), motivo: "Trámite personal" });
    }
    d.agendas.push(agenda);

    // Multimedia
    const media = (tipo, url, extra2 = {}) => d.multimedia.push({ id: id("m"), creado: e.creado, especialistaId: e.id, usuarioId: u?.id || null, tipo, url, mime: url.endsWith(".mp4") ? "video/mp4" : "image/jpeg", bytes: 120000, epigrafe: extra2.epigrafe || "", visibilidad: "publica", estado: extra2.estado || "aprobado", denuncias: extra2.denuncias || 0, orden: extra2.orden || 0, servicioId: extra2.servicioId || null });
    if (e.avatar) media("avatar", e.avatar);
    if (e.portada) media("portada", e.portada);
    if (e.video) media("video", e.video, { epigrafe: "Presentación" });
    fotos.forEach((f, k) => media(k === 0 ? "espacio" : "foto", f, { orden: k, epigrafe: k === 0 ? `Mi espacio en ${L.barrio}` : "" }));

    // Servicios
    svcs.forEach(([titulo, duracion, precio, modalidades, resumen], k) => {
      const c = cats[k < svcs.length / 2 || cats.length === 1 ? 0 : 1] || cats[0];
      const s = {
        id: id("s"), creado: e.creado, especialistaId: e.id, categoriaId: cat[c].id, slug: slug(titulo), titulo, resumen,
        descripcion: `${resumen}\n\nLa sesión empieza con una breve charla para conocer cómo llegás y qué necesitás. Después trabajamos ${duracion} minutos a tu ritmo y al final te comparto recomendaciones simples para sostener los resultados en casa.`,
        incluye: ["Entrevista inicial", "Sesión completa", "Recomendaciones para casa"].concat(modalidades.includes("domicilio") ? ["Materiales a domicilio"] : []),
        preparacion: modalidades.includes("online") ? "Para la modalidad online: buena conexión, un lugar tranquilo y auriculares." : "Vení con ropa cómoda y llegá 5 minutos antes.",
        precio, moneda: "UYU", duracion, modalidades, recargoDomicilio: modalidades.includes("domicilio") ? 300 : 0, anticipacionMax: null,
        fotos: fotos.length ? [fotos[(k + 1) % fotos.length]] : [`/img/demo/categorias/${c}.jpg`],
        estado: x.enRevision ? "en_revision" : "activo", orden: k,
        rating: { prom: 0, cant: 0, suma: 0, ponderado: cfg.resenas.promedioBase, distribucion: [0, 0, 0, 0, 0] }, stats: { vistas: 0, reservas: 0, realizadas: 0 },
      };
      d.servicios.push(s);
      servicios.push({ s, e, x });
    });
    if (demo === "especialista") e.diseno.servicioDestacado = servicios.find((v) => v.e === e)?.s.id;

    // Certificaciones
    if (!x.borrador && !x.sinReclamar) {
      d.certificaciones.push({ id: id("ce"), creado: e.creado, especialistaId: e.id, titulo: `Formación profesional en ${cat[cats[0]].nombre}`, institucion: r.uno(["Instituto Uruguayo de Terapias", "Escuela de Bienestar del Sur", "Asociación Internacional de Terapeutas"]), anio: 2026 - anios, categoriaId: cat[cats[0]].id, estado: x.verificado ? "verificada" : "declarada", revision: x.verificado ? { fecha: hace(100), nota: "Certificado revisado" } : {} });
      if (r.prob(0.5)) d.certificaciones.push({ id: id("ce"), creado: e.creado, especialistaId: e.id, titulo: "Curso de primeros auxilios", institucion: "Cruz Roja Uruguaya", anio: 2024, estado: "declarada", revision: {} });
    }
  });

  const lucia = esp[0]; const martin = esp[1];

  // Documento de identidad de ejemplo (privado) para la verificación pendiente de Martín
  const docArchivo = "documento-ejemplo-demo.png";
  if (conImagenes) {
    try { fs.mkdirSync(config.carpetaPrivada, { recursive: true }); fs.copyFileSync(path.join(__dirname, "demo", "documento-ejemplo.png"), path.join(config.carpetaPrivada, docArchivo)); } catch { /* sin documento de ejemplo */ }
  }
  const doc = { id: id("m"), creado: hace(2), especialistaId: martin.e.id, usuarioId: martin.u.id, tipo: "documento", url: `/archivos/${docArchivo}`, mime: "image/png", bytes: 28000, epigrafe: "Cédula (frente)", visibilidad: "privada", estado: "aprobado", denuncias: 0, orden: 0 };
  d.multimedia.push(doc);
  d.verificaciones.push({ id: id("v"), creado: hace(2), especialistaId: martin.e.id, usuarioId: martin.u.id, tipo: "identidad", documentos: [doc.id], documentoUltimos4: "4567", notas: "Adjunto mi cédula. Cualquier cosa me avisan.", estado: "pendiente", revision: {} });
  d.verificaciones.push({ id: id("v"), creado: hace(90), especialistaId: lucia.e.id, usuarioId: lucia.u.id, tipo: "identidad", documentos: [], documentoUltimos4: "1234", notas: "", estado: "aprobada", revision: { fecha: hace(88), nota: "Identidad verificada", por: admin.id } });
  // Certificación con documento, esperando verificación (Martín)
  const docCert = { ...doc, id: id("m"), creado: hace(1), epigrafe: "Certificado Reiki Usui nivel II" };
  d.multimedia.push(docCert);
  d.certificaciones.push({ id: id("ce"), creado: hace(1), especialistaId: martin.e.id, titulo: "Reiki Usui — Nivel II", institucion: "Centro Reiki Montevideo", anio: 2021, categoriaId: martin.e.categorias[0], documentoId: docCert.id, estado: "pendiente", revision: {} });
  // Una foto reportada y otra pendiente de moderación
  const fotoReportada = d.multimedia.find((m) => m.especialistaId === esp[7].e.id && m.tipo === "foto");
  if (fotoReportada) { fotoReportada.estado = "reportado"; fotoReportada.denuncias = 2; }
  d.multimedia.push({ id: id("m"), creado: hace(1), especialistaId: esp[13].e.id, usuarioId: esp[13].u.id, tipo: "foto", url: "/img/demo/galeria/sonoterapia-3.jpg", mime: "image/jpeg", bytes: 110000, epigrafe: "Nueva foto del espacio", visibilidad: "publica", estado: "pendiente", denuncias: 0, orden: 9 });

  // Reglas de comisión y promociones
  d.reglasComision.push({ id: id("rc"), creado: hace(300), nombre: "Acupuntura (insumos descartables)", alcance: "categoria", tasa: 8, categoriaId: cat.acupuntura.id, activa: true, creadaPor: admin.id });
  d.reglasComision.push({ id: id("rc"), creado: hace(10), nombre: "Lanzamiento en Maldonado", alcance: "promocion", tasa: 3, especialistas: esp.filter((v) => v.e.ubicacion.departamento === "Maldonado").map((v) => v.e.id), categorias: [], desde: hace(10), hasta: new Date(ahora.getTime() + 50 * 86400000).toISOString(), activa: true, creadaPor: admin.id });
  const promoLucia = { id: id("pr"), creado: hace(20), especialistaId: lucia.e.id, servicios: [], titulo: "10% en tu primera sesión", descripcion: "Para quienes me visitan por primera vez.", descuento: 10, financia: "especialista", publico: "nuevos", codigo: "", desde: hace(20), hasta: new Date(ahora.getTime() + 40 * 86400000).toISOString(), maxUsos: 0, usos: 7, estado: "activa" };
  d.promociones.push(promoLucia);
  d.promociones.push({ id: id("pr"), creado: hace(15), especialistaId: null, servicios: [], titulo: "Bienvenida a Alternativa", descripcion: "Código de bienvenida para tu primera reserva.", descuento: 15, financia: "plataforma", publico: "todos", codigo: "BIENVENIDA", desde: hace(15), hasta: new Date(ahora.getTime() + 60 * 86400000).toISOString(), maxUsos: 500, usos: 38, estado: "activa" });
  d.promociones.push({ id: id("pr"), creado: hace(40), especialistaId: martin.e.id, servicios: [], titulo: "Octubre zen", descripcion: "Reiki a distancia con descuento.", descuento: 20, financia: "especialista", publico: "todos", codigo: "", desde: hace(40), hasta: new Date(ahora.getTime() + 20 * 86400000).toISOString(), maxUsos: 0, usos: 3, estado: "pausada" });

  // Destacados (exposición paga)
  d.destacados.push({ id: id("d"), creado: hace(5), especialistaId: lucia.e.id, servicioId: null, tipo: "inicio", desde: hace(5), hasta: new Date(ahora.getTime() + 25 * 86400000).toISOString(), precio: 1500, estadoPago: "pagado", estado: "activo", impresiones: 812, clics: 64, notas: "Campaña mensual" });
  d.destacados.push({ id: id("d"), creado: hace(8), especialistaId: esp[3].e.id, servicioId: null, tipo: "categoria", categoriaId: cat.yoga.id, desde: hace(8), hasta: new Date(ahora.getTime() + 22 * 86400000).toISOString(), precio: 900, estadoPago: "pagado", estado: "activo", impresiones: 430, clics: 31 });
  // Solicitud de destacado hecha por Martín desde su panel (espera presupuesto de administración)
  d.destacados.push({ id: id("d"), creado: hace(0, 20), especialistaId: martin.e.id, servicioId: null, tipo: "categoria", categoriaId: martin.e.categorias[0], desde: hace(0, 20), hasta: new Date(ahora.getTime() + 14 * 86400000).toISOString(), precio: 0, estadoPago: "pendiente", estado: "pausado", impresiones: 0, clics: 0, notas: "Solicitud del especialista: 2 semana(s). Quiero aparecer primero en Reiki." });
  d.destacados.push({ id: id("d"), creado: hace(1), especialistaId: esp[6].e.id, servicioId: null, tipo: "zona", departamento: "Maldonado", desde: new Date(ahora.getTime() + 3 * 86400000).toISOString(), hasta: new Date(ahora.getTime() + 33 * 86400000).toISOString(), precio: 1200, estadoPago: "pendiente", estado: "programado", impresiones: 0, clics: 0 });

  // ── Reservas, pagos y reseñas ──────────────────────────
  const ocupado = new Set();
  // Turnos ocupados por especialista y día (una sesión de más de 60 min ocupa también la hora siguiente).
  const siguiente = (h) => `${String(Number(h.slice(0, 2)) + 1).padStart(2, "0")}:00`;
  const horaLibre = (e, fecha, horas, dur = 60) => {
    for (const h of r.muestra(horas, horas.length)) {
      const k = `${e.id}:${fecha}:${h}`;
      const k2 = `${e.id}:${fecha}:${siguiente(h)}`;
      if (ocupado.has(k) || (dur > 60 && ocupado.has(k2))) continue;
      ocupado.add(k);
      if (dur > 60) ocupado.add(k2);
      return h;
    }
    return null;
  };
  const HORAS = ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00", "18:00"];

  function crearReserva({ s, e, cliente, inicio, estado, modalidad, extra = {} }) {
    const tasa = s.categoriaId === cat.acupuntura.id ? 8 : 5;
    const recargo = modalidad === "domicilio" ? s.recargoDomicilio : 0;
    const desc = extra.promo ? extra.promo.descuento : 0;
    const dg = desglose({ precio: s.precio, recargo, descuentoPct: desc, financia: extra.promo?.financia || "especialista", tasa, modo: "sumada", procesadorPct: cfg.pagos.comisionProcesador, procesadorPaga: "especialista" });
    const fin = new Date(new Date(inicio).getTime() + s.duracion * 60000);
    const creado = extra.creado || new Date(new Date(inicio).getTime() - r.entre(2, 12) * 86400000).toISOString();
    const modelo = extra.modelo || "split";
    const u = e.ubicacion;
    const res = {
      id: id("r"), creado, codigo: `ALT-${String(seq).padStart(6, "0").replace(/0/g, "Q").slice(-6)}`, usuarioId: cliente.id, especialistaId: e.id, servicioId: s.id,
      foto: {
        servicio: s.titulo, servicioSlug: s.slug, categoria: d.categorias.find((c) => c.id === s.categoriaId).nombre, especialista: e.nombre, especialistaSlug: e.slug, usuario: cliente.nombre,
        precio: s.precio, recargo, subtotal: dg.subtotal, descuento: dg.descuento, promocionId: extra.promo?.id || null, promocion: extra.promo?.titulo || "", total: dg.total, moneda: "UYU",
        modoTarifa: "sumada", tasa, regla: tasa === 8 ? "Acupuntura (insumos descartables)" : "Comisión general", comision: dg.comision, netoEspecialista: dg.netoEspecialista,
        procesadorPct: cfg.pagos.comisionProcesador, procesadorPaga: "especialista", procesadorEstimado: dg.procesador, recibeEspecialista: dg.recibeEspecialista, netoPlataforma: dg.netoPlataforma,
        comisionMarketplace: dg.comisionMarketplace, duracion: s.duracion, modeloCobro: modelo, politica: cfg.cancelacion,
      },
      inicio: iso(inicio), fin: fin.toISOString(), modalidad,
      lugar: modalidad === "presencial" ? { direccion: u.direccion, referencia: u.referencia, lat: u.lat, lng: u.lng } : modalidad === "domicilio" ? { direccion: `${r.uno(["Av. Brasil", "Bulevar Artigas", "Rambla", "Av. Italia", "Rivera"])} ${r.entre(1000, 4000)}` } : { enlaceOnline: "https://meet.jit.si/alternativa-demo" },
      notasUsuario: extra.notas || "", notasEspecialista: extra.notasEsp || "", estado, vencePago: estado === "pendiente" ? new Date(ahora.getTime() + 15 * 60000).toISOString() : null,
      primeraVez: !d.reservas.some((x) => x.usuarioId === cliente.id && x.especialistaId === e.id), reprogramaciones: 0, resenada: false, incidencia: { abierta: false },
      recordatorios: {}, origen: "web", historial: [{ estado: "pendiente", fecha: creado, por: cliente.id, rol: "usuario", nota: "Reserva iniciada" }],
    };
    if (estado !== "pendiente") {
      res.historial.push({ estado: "pagada", fecha: creado, rol: "sistema", nota: "Pago acreditado" });
      if (estado !== "pagada") res.historial.push({ estado: "confirmada", fecha: creado, rol: "sistema", nota: "Confirmación automática" });
      const pago = {
        id: id("p"), creado, reservaId: res.id, usuarioId: cliente.id, especialistaId: e.id, proveedor: "simulado", modeloCobro: modelo, preferenciaId: `SIM-PREF-${res.id}`,
        idPasarela: `SIM:approved:${res.id}`, monto: dg.total, moneda: "UYU", comision: dg.comision, montoEspecialista: dg.netoEspecialista, comisionPasarela: Math.round(dg.total * 0.0609),
        comisionPasarelaEstimada: dg.procesador, comisionMarketplace: dg.comisionMarketplace, cobradorId: e.mercadopago?.usuarioMp || null, reembolsado: 0, estado: "aprobado",
        medio: r.uno(["credit_card", "debit_card", "account_money"]), pagadoEn: creado, liquidacion: { estado: modelo === "split" ? "no_aplica" : "pendiente" },
        eventos: [{ fecha: creado, tipo: "creado" }, { fecha: creado, tipo: "estado_pasarela", datos: { estado: "approved", detalle: "accredited" } }],
      };
      d.pagos.push(pago);
      res.pagoId = pago.id;
    }
    if (estado === "realizada") { res.realizadaEn = fin.toISOString(); res.historial.push({ estado: "realizada", fecha: fin.toISOString(), rol: "sistema", nota: "Cierre automático" }); }
    d.reservas.push(res);
    return res;
  }

  function cancelarReserva(res, { rol, porcentaje, motivo, fecha, falla = false }) {
    const pago = d.pagos.find((p) => p.id === res.pagoId);
    const rep = repartirReembolso({ total: res.foto.total, comision: res.foto.comision, porcentaje });
    res.estado = rol === "especialista" ? "cancelada_especialista" : "cancelada_usuario";
    res.cancelacion = { por: null, rol, motivo, fecha, porcentaje, monto: rep.monto, regla: rol === "especialista" ? "cancela_especialista" : porcentaje === 100 ? "anticipada" : "parcial" };
    res.historial.push({ estado: res.estado, fecha, rol, nota: `Reembolso ${porcentaje}%` });
    if (pago && rep.monto > 0) {
      const rb = { id: id("rb"), creado: fecha, reservaId: res.id, pagoId: pago.id, usuarioId: res.usuarioId, especialistaId: res.especialistaId, monto: rep.monto, porcentaje, comisionRevertida: rep.comisionRevertida, especialistaRevertido: rep.especialistaRevertido, motivo, regla: res.cancelacion.regla, rolIniciador: rol, estado: falla ? "fallido" : "procesado", idPasarela: falla ? "" : `SIM-REF-${res.id}`, procesadoEn: falla ? null : fecha, error: falla ? "Mercado Pago 400: el vendedor no tiene saldo suficiente para el reembolso" : "" };
      d.reembolsos.push(rb);
      if (!falla) { pago.reembolsado = rep.monto; pago.estado = rep.monto >= pago.monto ? "reembolsado" : "reembolso_parcial"; pago.eventos.push({ fecha, tipo: "reembolso", datos: { monto: rep.monto } }); }
      else res.incidencia = { abierta: true, nota: `Reembolso fallido: ${rb.error}`, fecha };
      return rb;
    }
    return null;
  }

  function resenar(res, s, cliente, puntaje, comentario, fecha) {
    const rv = { id: id("re"), creado: fecha, reservaId: res.id, servicioId: s.id, especialistaId: res.especialistaId, usuarioId: cliente.id, autor: `${cliente.nombre.split(" ")[0]} ${cliente.nombre.split(" ").slice(-1)[0][0]}.`, puntaje, comentario, fechaServicio: res.inicio, estado: "publicada", util: r.entre(0, 6) };
    d.resenas.push(rv);
    res.resenada = true;
    return rv;
  }

  const puntajeAleatorio = () => { const x = r(); return x < 0.68 ? 5 : x < 0.9 ? 4 : x < 0.97 ? 3 : 2; };

  // Historial y agenda futura de cada especialista activo
  for (const { e, x, popularidad } of esp) {
    if (e.estado !== "activo" || !e.usuarioId) continue;
    const mis = servicios.filter((v) => v.e === e).map((v) => v.s);
    if (!mis.length) continue;
    for (let k = 0; k < popularidad; k++) {
      const s = r.uno(mis);
      const dias = r.entre(2, Math.min(180, (x.publicadoDias || 60) - 1));
      const fecha = F.sumarDias(hoy, -dias);
      if (![1, 2, 3, 4, 5, 6].includes(F.diaSemana(fecha))) continue;
      const h = horaLibre(e, fecha, HORAS, s.duracion);
      if (!h) continue;
      const cliente = r.uno(clientes.slice(1));
      const modo = r.uno(s.modalidades);
      const estadoPasado = r() < 0.9 ? "realizada" : r() < 0.5 ? "ausencia_usuario" : "realizada";
      const res = crearReserva({ s, e, cliente, inicio: F.aUtc(fecha, h), estado: estadoPasado, modalidad: modo, extra: { modelo: dias > 90 && ["Akira Kobayashi", "Rocío Benítez"].includes(e.nombre) ? "plataforma" : "split" } });
      if (estadoPasado === "realizada" && r.prob(0.78)) {
        const p = puntajeAleatorio();
        const rv = resenar(res, s, cliente, p, r.prob(0.85) ? r.uno(COMENTARIOS[p]) : "", new Date(new Date(res.fin).getTime() + r.entre(3, 72) * 3600000).toISOString());
        if (r.prob(0.45)) rv.respuesta = { texto: p >= 4 ? r.uno(["¡Gracias por tu confianza! Te espero pronto.", "Qué lindo leerte, gracias por venir.", "Gracias a vos, fue un gusto acompañarte."]) : "Gracias por el comentario, lo tomo para mejorar.", fecha: new Date(new Date(rv.creado).getTime() + 86400000).toISOString() };
      }
    }
    // Algunas canceladas
    for (let k = 0; k < Math.ceil(popularidad / 12); k++) {
      const s = r.uno(mis);
      const fecha = F.sumarDias(hoy, -r.entre(5, 60));
      const h = horaLibre(e, fecha, HORAS, s.duracion);
      if (!h) continue;
      const res = crearReserva({ s, e, cliente: r.uno(clientes.slice(1)), inicio: F.aUtc(fecha, h), estado: "confirmada", modalidad: s.modalidades[0] });
      cancelarReserva(res, { rol: r.prob(0.8) ? "usuario" : "especialista", porcentaje: r.prob(0.7) ? 100 : 50, motivo: r.uno(["Me surgió un imprevisto de trabajo", "Estoy enfermo", "Viaje", "Cambio de planes"]), fecha: new Date(new Date(res.inicio).getTime() - r.entre(3, 48) * 3600000).toISOString() });
    }
    // Próximas reservas
    const proximas = Math.min(10, Math.max(1, Math.round(popularidad / 6)));
    for (let k = 0; k < proximas; k++) {
      const s = r.uno(mis);
      const fecha = F.sumarDias(hoy, r.entre(1, 14));
      if (!e.ubicacion || ![1, 2, 3, 4, 5].includes(F.diaSemana(fecha))) continue;
      const h = horaLibre(e, fecha, HORAS.slice(0, 8), s.duracion);
      if (!h) continue;
      crearReserva({ s, e, cliente: r.uno(clientes.slice(1)), inicio: F.aUtc(fecha, h), estado: "confirmada", modalidad: r.uno(s.modalidades), extra: { creado: hace(r.entre(0, 6)) } });
    }
  }

  // ── Escenario del usuario de prueba (Sofía) ────────────
  const sv = (e, i) => servicios.filter((v) => v.e === e.e).map((v) => v.s)[i];
  const proximoHabil = (desde, dias) => { let f = F.sumarDias(hoy, desde); for (let k = 0; k < 10; k++) { if ([1, 2, 3, 4, 5].includes(F.diaSemana(f))) return f; f = F.sumarDias(f, 1); } return f; };
  // Usa la hora pedida o, si ya está ocupada, la siguiente libre del día.
  const usarHora = (e, fecha, h) => {
    const libres = [h, ...HORAS.filter((x) => x > h), ...HORAS.filter((x) => x < h)];
    const elegida = libres.find((x) => !ocupado.has(`${e.id}:${fecha}:${x}`) && !ocupado.has(`${e.id}:${fecha}:${siguiente(x)}`)) || h;
    ocupado.add(`${e.id}:${fecha}:${elegida}`); ocupado.add(`${e.id}:${fecha}:${siguiente(elegida)}`);
    return F.aUtc(fecha, elegida);
  };
  // 1) Próxima, presencial con Lucía (mapa, dirección y WhatsApp visibles)
  const f1 = proximoHabil(3); while (ocupado.has(`${lucia.e.id}:${f1}:11:00`)) break;
  const rProx = crearReserva({ s: sv(lucia, 0), e: lucia.e, cliente: sofia, inicio: usarHora(lucia.e, f1, "11:00"), estado: "confirmada", modalidad: "presencial", extra: { creado: hace(1), notas: "Tengo una contractura en el hombro derecho." } });
  // 2) Próxima online con Martín (reiki a distancia), pagada y esperando confirmación (Martín confirma a mano)
  const f2 = proximoHabil(5);
  const rOnline = crearReserva({ s: sv(martin, 1), e: martin.e, cliente: sofia, inicio: usarHora(martin.e, f2, "18:00"), estado: "pagada", modalidad: "online", extra: { creado: hace(0, 3) } });
  // 3) Realizada y reseñada con Lucía (con respuesta)
  const f3 = F.sumarDias(hoy, -20);
  const rPasada = crearReserva({ s: sv(lucia, 1), e: lucia.e, cliente: sofia, inicio: usarHora(lucia.e, f3, "10:00"), estado: "realizada", modalidad: "presencial", extra: { promo: promoLucia } });
  const rvSofia = resenar(rPasada, sv(lucia, 1), sofia, 5, "Lucía es un amor y sus manos son mágicas. Salí totalmente relajada y sin dolor de espalda. El espacio es precioso y súper tranquilo.", new Date(new Date(rPasada.fin).getTime() + 5 * 3600000).toISOString());
  rvSofia.respuesta = { texto: "¡Gracias, Sofía! Fue un placer. Te espero para la próxima.", fecha: new Date(new Date(rvSofia.creado).getTime() + 20 * 3600000).toISOString() };
  // 4) Realizada hace 3 días con Valentina (yoga) sin reseñar → "Valorar"
  const f4 = F.sumarDias(hoy, -3);
  const rSinValorar = crearReserva({ s: sv(esp[3], 0), e: esp[3].e, cliente: sofia, inicio: usarHora(esp[3].e, f4, "09:00"), estado: "realizada", modalidad: "online" });
  rSinValorar.pedidoResena = hace(2);
  // 5) Cancelada por Sofía con reembolso total
  const rCancel = crearReserva({ s: sv(esp[4], 0), e: esp[4].e, cliente: sofia, inicio: usarHora(esp[4].e, F.sumarDias(hoy, -40), "16:00"), estado: "confirmada", modalidad: "presencial" });
  cancelarReserva(rCancel, { rol: "usuario", porcentaje: 100, motivo: "Me surgió un viaje de trabajo", fecha: hace(42) });
  // 6) Reprogramada (la original queda como "reprogramada" y la nueva es la próxima en Carrasco)
  const rOrig = crearReserva({ s: sv(esp[5], 0), e: esp[5].e, cliente: sofia, inicio: usarHora(esp[5].e, proximoHabil(2), "10:00"), estado: "confirmada", modalidad: "presencial", extra: { creado: hace(6) } });
  const rNueva = crearReserva({ s: sv(esp[5], 0), e: esp[5].e, cliente: sofia, inicio: usarHora(esp[5].e, proximoHabil(9), "15:00"), estado: "confirmada", modalidad: "presencial", extra: { creado: hace(1) } });
  rOrig.estado = "reprogramada"; rOrig.reprogramadaA = rNueva.id;
  rOrig.historial.push({ estado: "reprogramada", fecha: hace(1), por: sofia.id, rol: "usuario", nota: `Nuevo horario: ${F.fFechaHora(rNueva.inicio)} (${rNueva.codigo})` });
  rNueva.reprogramadaDesde = rOrig.id; rNueva.reprogramaciones = 1; rNueva.pagoId = rOrig.pagoId;
  d.pagos = d.pagos.filter((p) => p.reservaId !== rNueva.id);
  d.pagos.find((p) => p.id === rOrig.pagoId).reservaId = rNueva.id;
  // 7) Pendiente de pago (para probar el pago simulado)
  crearReserva({ s: sv(esp[8], 2), e: esp[8].e, cliente: sofia, inicio: usarHora(esp[8].e, proximoHabil(7), "15:00"), estado: "pendiente", modalidad: "online", extra: { creado: hace(0, 0.1) } });

  // Reservas de hoy y mañana para el panel de Lucía
  for (const [dia, h] of [[0, "18:00"], [0, "19:00"], [1, "09:00"], [1, "16:00"]]) {
    const f = F.sumarDias(hoy, dia);
    if ([0].includes(F.diaSemana(f))) continue;
    if (new Date(F.aUtc(f, h)) <= ahora) continue;
    if (ocupado.has(`${lucia.e.id}:${f}:${h}`)) continue;
    crearReserva({ s: sv(lucia, dia === 0 ? 0 : 2), e: lucia.e, cliente: r.uno(clientes.slice(1)), inicio: usarHora(lucia.e, f, h), estado: dia === 1 && h === "16:00" ? "pagada" : "confirmada", modalidad: "presencial", extra: { creado: hace(r.entre(0, 3)) } });
  }
  // Sesiones de Lucía recién terminadas: para probar "Marcar como realizada" y "El cliente no vino"
  // (la tarea automática las cierra solas pasadas unas horas).
  for (const minutos of [100, 200]) {
    const s0 = sv(lucia, 0);
    const ini = new Date(Math.floor((ahora.getTime() - minutos * 60000) / 900000) * 900000);
    const finX = ini.getTime() + s0.duracion * 60000;
    const choca = d.reservas.some((x) => x.especialistaId === lucia.e.id && !["cancelada_usuario", "cancelada_especialista", "reembolsada", "reprogramada", "expirada"].includes(x.estado) && new Date(x.inicio).getTime() < finX && new Date(x.fin).getTime() > ini.getTime());
    if (!choca && finX < ahora.getTime()) crearReserva({ s: s0, e: lucia.e, cliente: r.uno(clientes.slice(1)), inicio: ini.toISOString(), estado: "confirmada", modalidad: "presencial", extra: { creado: hace(4) } });
  }
  // Incidencia abierta y reembolso fallido (para administración)
  const rFalla = crearReserva({ s: sv(esp[6], 0), e: esp[6].e, cliente: clientes[5], inicio: usarHora(esp[6].e, proximoHabil(-6 > 0 ? 1 : 4), "12:00"), estado: "confirmada", modalidad: "domicilio" });
  cancelarReserva(rFalla, { rol: "especialista", porcentaje: 100, motivo: "Problema de salud", fecha: hace(0, 5), falla: true });
  const rIncidencia = d.reservas.find((x) => x.estado === "realizada" && x.especialistaId === esp[4].e.id && !x.resenada);
  if (rIncidencia) { rIncidencia.estado = "confirmada"; rIncidencia.realizadaEn = null; rIncidencia.historial = rIncidencia.historial.filter((h) => h.estado !== "realizada"); rIncidencia.incidencia = { abierta: true, nota: "El especialista llegó 30 minutos tarde y la sesión fue más corta.", fecha: hace(1) }; }
  // Pago en disputa (contracargo)
  const pDisputa = d.pagos.find((p) => p.especialistaId === esp[8].e.id && p.estado === "aprobado");
  if (pDisputa) { pDisputa.estado = "en_disputa"; pDisputa.contracargo = { estado: "en_disputa", monto: pDisputa.monto, fecha: hace(2) }; const rr = d.reservas.find((x) => x.id === pDisputa.reservaId); rr.incidencia = { abierta: true, nota: "Pago en disputa", fecha: hace(2) }; }
  // Pedido de revisión de una reseña (Lucía pide revisar una de 2 o 3 estrellas)
  const rvBaja = d.resenas.find((x) => x.especialistaId === lucia.e.id && x.puntaje <= 3) || d.resenas.find((x) => x.especialistaId === lucia.e.id && x.puntaje === 4);
  if (rvBaja) {
    rvBaja.estado = "en_revision"; rvBaja.pedidoRevision = { motivo: "falso", detalle: "Esta persona nunca vino a la sesión; marqué ausencia.", fecha: hace(1) };
    d.denuncias.push({ id: id("dn"), creado: hace(1), denuncianteId: lucia.u.id, rolDenunciante: "especialista", tipo: "resena", objetivoId: rvBaja.id, motivo: "falso", detalle: rvBaja.pedidoRevision.detalle, estado: "abierta" });
  }
  if (fotoReportada) d.denuncias.push({ id: id("dn"), creado: hace(2), denuncianteId: clientes[3].id, rolDenunciante: "usuario", tipo: "multimedia", objetivoId: fotoReportada.id, motivo: "spam", detalle: "Parece una imagen de publicidad.", estado: "abierta" });
  // Denuncia abierta de un servicio (descripción con promesas de curación), para probar la pantalla de denuncias
  const svDenunciado = servicios.find((v) => v.e === esp[11].e)?.s;
  if (svDenunciado) d.denuncias.push({ id: id("dn"), creado: hace(0, 6), denuncianteId: clientes[6].id, rolDenunciante: "usuario", tipo: "servicio", objetivoId: svDenunciado.id, motivo: "falso", detalle: "La descripción promete curar enfermedades.", estado: "abierta" });
  d.denuncias.push({ id: id("dn"), creado: hace(30), denuncianteId: clientes[8].id, rolDenunciante: "usuario", tipo: "especialista", objetivoId: esp[17].e.id, motivo: "otro", detalle: "El teléfono no coincide.", estado: "resuelta", resolucion: { fecha: hace(28), accion: "sin_accion", nota: "Se verificó con el especialista.", por: admin.id } });

  // Liquidaciones (modelo "plataforma" de reservas antiguas)
  for (const e of [esp[4].e, esp[8].e]) {
    const ps = d.pagos.filter((p) => p.especialistaId === e.id && p.modeloCobro === "plataforma" && ["aprobado", "reembolsado", "reembolso_parcial"].includes(p.estado));
    const viejos = ps.filter((p) => new Date(p.creado) < new Date(ahora.getTime() - 120 * 86400000));
    if (viejos.length) {
      const l = { id: id("l"), creado: hace(115), numero: num("liquidacion"), especialistaId: e.id, direccion: "al_especialista", hasta: hace(120), pagos: viejos.map((p) => p.id), reservas: viejos.length, bruto: viejos.reduce((a, p) => a + p.monto, 0), comision: viejos.reduce((a, p) => a + p.comision, 0), reembolsos: 0, neto: viejos.reduce((a, p) => a + p.montoEspecialista, 0), estado: "pagada", referencia: `TRF-${r.entre(100000, 999999)}`, pagadaEn: hace(112), pagadaPor: admin.id, creadaPor: admin.id };
      d.liquidaciones.push(l);
      viejos.forEach((p) => { p.liquidacion = { estado: "liquidada", liquidacionId: l.id, fecha: hace(112) }; });
    }
  }

  // Reputación de servicios y especialistas
  for (const { s } of servicios) {
    const rs = d.resenas.filter((x) => x.servicioId === s.id && x.estado !== "oculta");
    const suma = rs.reduce((a, x) => a + x.puntaje, 0);
    const dist = [0, 0, 0, 0, 0]; rs.forEach((x) => dist[x.puntaje - 1]++);
    s.rating = { prom: rs.length ? Math.round((suma / rs.length) * 10) / 10 : 0, cant: rs.length, suma, ponderado: bayesiano(rs.length ? suma / rs.length : 0, rs.length, cfg.resenas.promedioBase, cfg.resenas.pesoBayes), distribucion: dist };
    const efectivas = d.reservas.filter((x) => x.servicioId === s.id && ["pagada", "confirmada", "realizada"].includes(x.estado));
    s.stats = { vistas: r.entre(efectivas.length * 6, efectivas.length * 14 + 20), reservas: efectivas.length, realizadas: efectivas.filter((x) => x.estado === "realizada").length };
  }
  for (const { e } of esp) {
    const rs = d.resenas.filter((x) => x.especialistaId === e.id && x.estado !== "oculta");
    const realizadas = d.reservas.filter((x) => x.especialistaId === e.id && x.estado === "realizada");
    const por = {}; realizadas.forEach((x) => (por[x.usuarioId] = (por[x.usuarioId] || 0) + 1));
    e.stats = { resenas: rs.length, rating: rs.length ? Math.round((rs.reduce((a, x) => a + x.puntaje, 0) / rs.length) * 10) / 10 : 0, realizadas: realizadas.length, recurrentes: Object.values(por).filter((n) => n > 1).length, respuestaMin: r.entre(8, 90) };
  }

  // Estadísticas diarias (últimos 60 días)
  for (const { e, popularidad } of esp) {
    if (e.estado !== "activo") continue;
    const mis = servicios.filter((v) => v.e === e).map((v) => v.s);
    for (let k = 0; k < 60; k++) {
      const fecha = F.sumarDias(hoy, -k);
      if (e.publicado && fecha < F.partes(e.publicado).fecha) continue;
      const base = 2 + popularidad / 4;
      d.estadisticas.push({ id: id("es"), creado: F.aUtc(fecha).toISOString(), especialistaId: e.id, servicioId: null, fecha, visitasPerfil: r.entre(0, Math.round(base * 1.6)), impresiones: r.entre(Math.round(base * 3), Math.round(base * 9)), favoritos: r.prob(0.2) ? 1 : 0, mensajes: r.prob(0.15) ? 1 : 0, impresionesPatrocinadas: e.id === lucia.e.id && k < 5 ? r.entre(20, 60) : 0 });
      for (const s of mis) d.estadisticas.push({ id: id("es"), creado: F.aUtc(fecha).toISOString(), especialistaId: e.id, servicioId: s.id, fecha, visitasServicio: r.entre(0, Math.round(base)), consultasAgenda: r.entre(0, Math.round(base / 2)) });
    }
  }

  // Favoritos de Sofía
  for (const s of [sv(lucia, 0), sv(esp[3], 1), sv(esp[8], 0)]) d.favoritos.push({ id: id("f"), creado: hace(10), usuarioId: sofia.id, tipo: "servicio", servicioId: s.id, especialistaId: s.especialistaId });
  d.favoritos.push({ id: id("f"), creado: hace(9), usuarioId: sofia.id, tipo: "especialista", especialistaId: esp[5].e.id });

  // Conversaciones
  const conversar = (cliente, e, mensajes, sinLeerUsuario = 0, sinLeerEsp = 0) => {
    const c = { id: id("cv"), creado: mensajes[0][2], usuarioId: cliente.id, especialistaId: e.e.id, usuarioEspecialistaId: e.u.id, ultimoMensaje: mensajes.at(-1)[2], vistaPrevia: mensajes.at(-1)[1].slice(0, 120), sinLeerUsuario, sinLeerEspecialista: sinLeerEsp, estado: "abierta" };
    d.conversaciones.push(c);
    for (const [quien, texto, fecha] of mensajes) {
      const autor = quien === "u" ? cliente : e.u;
      d.mensajes.push({ id: id("ms"), creado: fecha, conversacionId: c.id, autorId: autor.id, rolAutor: quien === "u" ? "usuario" : "especialista", texto, tieneContacto: /\d{3}\s?\d{3}/.test(texto), leido: fecha });
    }
    return c;
  };
  conversar(sofia, lucia, [
    ["u", "¡Hola Lucía! Quería saber si el masaje descontracturante sirve para dolor de cuello por estar mucho en la compu.", hace(25)],
    ["e", "¡Hola Sofía! Sí, es justo para eso. Trabajo cuello, trapecios y espalda alta. Si querés te dejo también unos ejercicios para hacer en la oficina.", hace(25, -1)],
    ["u", "Genial, reservo para el jueves entonces.", hace(24)],
    ["e", "Perfecto. Cualquier cosa escribime al WhatsApp 099 123 456. ¡Nos vemos!", hace(1)],
    ["u", "Gracias, allá estaré 🙂", hace(0, 20)],
  ], 0, 1);
  conversar(sofia, martin, [
    ["u", "Hola Martín, nunca hice reiki. ¿Cómo es una sesión a distancia?", hace(4)],
    ["e", "¡Hola! Nos conectamos por videollamada, charlamos unos minutos y después te recostás con los ojos cerrados. Es muy tranquilo. Si querés coordinamos por acá o pasame tu número 099 555 010 y te llamo.", hace(3)],
  ], 1, 0);
  for (const { e, u } of esp.slice(3, 9)) if (u) conversar(r.uno(clientes.slice(1)), { e, u }, [["u", "Hola, ¿tenés lugar esta semana?", hace(r.entre(2, 9))], ["e", "¡Hola! Sí, fijate los horarios en mi ficha y reservá directo.", hace(r.entre(0, 1))]]);
  conversar(clientes[2], lucia, [["u", "Hola Lucía, ¿hacés masajes a domicilio en Carrasco?", hace(0, 2)]], 0, 1);

  // Notificaciones
  const aviso = (u, tipo, titulo, texto, enlace, horas, leida = false) => d.notificaciones.push({ id: id("n"), creado: hace(0, horas), usuarioId: u.id, tipo, titulo, texto, enlace, canales: { email: "enviado" }, leida: leida ? hace(0, horas - 1) : null });
  aviso(sofia, "reserva_confirmada", "Reserva confirmada", `${rProx.foto.servicio} con Lucía Fernández, ${F.fFechaHora(rProx.inicio)}.`, `/mi/reservas/${rProx.id}`, 24);
  aviso(sofia, "pago", "Pago recibido", "Recibimos tu pago. Martín Sosa confirmará la reserva a la brevedad.", `/mi/reservas/${rOnline.id}`, 3);
  aviso(sofia, "pedir_resena", "¿Cómo te fue en tu sesión?", `Contanos qué te pareció ${rSinValorar.foto.servicio}.`, `/mi/reservas/${rSinValorar.id}/valorar`, 48);
  aviso(sofia, "respuesta_resena", "Respondieron tu reseña", "Lucía Fernández respondió a tu reseña.", `/especialistas/${lucia.e.slug}#resenas`, 400, true);
  aviso(sofia, "reembolso", "Reembolso procesado", `Te devolvimos ${rCancel.foto.total} UYU por la reserva ${rCancel.codigo}.`, `/mi/reservas/${rCancel.id}`, 1000, true);
  aviso(sofia, "mensaje", "Nuevo mensaje de Martín Sosa", "¡Hola! Nos conectamos por videollamada…", "/mi/mensajes", 70);
  aviso(lucia.u, "reserva_nueva", "Nueva reserva", `Sofía Rodríguez · ${rProx.foto.servicio} · ${F.fFechaHora(rProx.inicio)}.`, `/panel/reservas/${rProx.id}`, 24);
  aviso(lucia.u, "resena_nueva", "Nueva reseña: ★★★★★", "Sofía R. valoró Masaje relajante con piedras calientes.", "/panel/resenas", 450, true);
  aviso(lucia.u, "mensaje", "Nuevo mensaje de Sofía", "Gracias, allá estaré 🙂", "/panel/mensajes", 20);
  aviso(martin.u, "reserva_nueva", "Nueva reserva para confirmar", `Sofía Rodríguez · ${rOnline.foto.servicio} · ${F.fFechaHora(rOnline.inicio)}.`, `/panel/reservas/${rOnline.id}`, 3);
  aviso(martin.u, "verificacion", "Recibimos tu documentación", "Estamos revisando tu identidad. Te avisamos en menos de 48 h.", "/panel/verificacion", 48);
  aviso(admin, "alerta", "Reembolso fallido", `Reserva ${rFalla.codigo}: el vendedor no tiene saldo suficiente.`, "/admin/reembolsos", 5);
  aviso(admin, "alerta", "Pedido de revisión de reseña", "Motivo: contenido falso", "/admin/resenas?estado=en_revision", 24);
  aviso(admin, "admin", "Nuevo especialista para revisar", "Camila Herrera pidió publicar su ficha.", "/admin/pendientes", 30);

  // Consultas de soporte
  const consulta = (u, tema, asunto, msgs, estado, prioridad = "normal", reservaId = null) => d.consultas.push({ id: id("t"), creado: msgs[0][2], numero: num("consulta"), usuarioId: u?.id || null, nombre: u ? "" : "Persona sin cuenta", email: u ? "" : "consulta@ejemplo.uy", reservaId, tema, asunto, estado, prioridad, mensajes: msgs.map(([rol, texto, fecha]) => ({ autorId: rol === "usuario" ? u?.id : rol === "admin" ? admin.id : null, rol, texto, fecha })) });
  consulta(sofia, "pago", "No me llegó el comprobante del pago", [["usuario", "Hola, pagué la reserva con Martín pero no me llegó el email del comprobante.", hace(0, 2)]], "abierta");
  consulta(clientes[4], "reserva", "Quiero cambiar de especialista", [["usuario", "¿Puedo pasar mi reserva a otro especialista?", hace(4)], ["admin", "Hola, podés cancelarla sin costo hasta 24 h antes y reservar con quien prefieras.", hace(3)]], "esperando_usuario");
  consulta(null, "otro", "¿Tienen especialistas en Rivera?", [["usuario", "Quería saber si hay terapeutas en Rivera.", hace(10)], ["admin", "Todavía no, pero estamos sumando. ¡Gracias por escribir!", hace(9)]], "resuelta", "baja");
  if (rIncidencia) consulta(d.usuarios.find((u) => u.id === rIncidencia.usuarioId), "reserva", `Problema con la reserva ${rIncidencia.codigo}`, [["usuario", rIncidencia.incidencia.nota, hace(1)]], "abierta", "alta", rIncidencia.id);

  // Contenido: páginas, preguntas frecuentes y blog
  for (const [s, p] of Object.entries(paginas)) d.contenidos.push({ id: id("ct"), creado: hace(300), tipo: "pagina", slug: s, titulo: p.titulo, resumen: p.resumen, cuerpo: p.cuerpo, estado: "publicado", publicado: hace(300), orden: 0, publico: "todos", etiquetas: [], seo: {} });
  preguntas.forEach((p, i) => d.contenidos.push({ id: id("ct"), creado: hace(300), tipo: "faq", slug: slug(p.titulo), titulo: p.titulo, resumen: "", cuerpo: p.cuerpo, categoria: p.categoria, estado: "publicado", publicado: hace(300), orden: i, publico: "todos", etiquetas: [], seo: {} }));
  const ARTICULOS = [
    ["5 señales de que necesitás un masaje descontracturante", "masajes", "Bienestar", "Dolor de cuello, dolores de cabeza frecuentes o sueño liviano pueden ser señales de tensión acumulada.",
      "Pasamos horas frente a la computadora y el cuerpo lo registra. Estas son algunas señales de que te vendría bien un masaje:\n\n## 1. Te duele el cuello al final del día\nLa postura frente a pantallas carga trapecios y cervicales.\n\n## 2. Tenés dolores de cabeza tensionales\nMuchas cefaleas empiezan en la nuca.\n\n## 3. Dormís mal\nUn cuerpo tenso descansa peor.\n\n## 4. Sentís los hombros \"pegados\" a las orejas\nEs una forma muy común de cargar el estrés.\n\n## 5. Te cuesta concentrarte\nEl dolor de fondo consume energía.\n\nSi te identificaste, mirá los [especialistas en masajes](/masajes) cerca tuyo."],
    ["Yoga para principiantes: cómo empezar sin lesionarte", "yoga", "Movimiento", "No hace falta ser flexible para empezar. Te contamos cómo elegir clase y profesor.",
      "El yoga es para todos los cuerpos. Algunas recomendaciones para empezar con buen pie:\n\n- **Empezá con clases individuales o grupos chicos.** Así el profesor puede corregir tu postura.\n- **Contá tus lesiones o dolores.** Un buen profesor adapta las posturas.\n- **No compitas.** Ni con otros ni con vos.\n- **Respirá.** La respiración es la mitad de la práctica.\n\n> La constancia vale más que la intensidad.\n\nEncontrá [profesores de yoga](/yoga) con reseñas verificadas."],
    ["¿Qué es el reiki y qué se siente en una sesión?", "reiki", "Terapias", "Una explicación simple de qué es el reiki, cómo es una sesión y qué podés esperar.",
      "El reiki es una práctica de origen japonés en la que el terapeuta apoya o acerca las manos al cuerpo con la intención de favorecer la relajación.\n\n## Cómo es una sesión\nTe recostás vestido, con música suave. La sesión dura entre 45 y 60 minutos.\n\n## Qué se siente\nMuchas personas describen calor en las manos del terapeuta, sensación de calma o somnolencia.\n\n## Importante\nEl reiki no reemplaza la atención médica. Es un complemento para el bienestar."],
    ["Acupuntura: mitos y verdades", "acupuntura", "Terapias", "¿Duele? ¿Es segura? Respondemos las preguntas más frecuentes sobre la acupuntura.",
      "## ¿Duele?\nLas agujas son muy finas. Lo habitual es sentir un pinchazo leve o una sensación de pesadez.\n\n## ¿Es segura?\nCon agujas descartables y un profesional formado, sí.\n\n## ¿Cuántas sesiones necesito?\nDepende de cada caso; tu acupunturista te lo indicará después de la primera consulta."],
    ["Meditar 10 minutos por día: una guía práctica", "meditacion", "Mente", "Un plan simple de cuatro semanas para incorporar la meditación a tu rutina.",
      "1. **Semana 1:** 5 minutos de respiración consciente al despertar.\n2. **Semana 2:** sumá un escaneo corporal antes de dormir.\n3. **Semana 3:** 10 minutos de meditación guiada.\n4. **Semana 4:** elegí tu momento favorito del día y sostenelo.\n\nSi querés acompañamiento, mirá [especialistas en meditación](/meditacion)."],
  ];
  ARTICULOS.forEach(([titulo, c, categoria, resumen, cuerpo], i) => d.contenidos.push({ id: id("ct"), creado: hace(10 + i * 12), tipo: "articulo", slug: slug(titulo), titulo, resumen, cuerpo, portada: `/img/demo/categorias/${c}.jpg`, categoria, estado: "publicado", publicado: hace(10 + i * 12), orden: 0, publico: "todos", etiquetas: [c], seo: {}, autorId: admin.id }));
  d.contenidos.push({ id: id("ct"), creado: hace(1), tipo: "articulo", slug: "guia-de-aromaterapia-en-casa", titulo: "Guía de aromaterapia en casa (borrador)", resumen: "Borrador sin publicar.", cuerpo: "Texto en preparación.", portada: "/img/demo/categorias/aromaterapia.jpg", categoria: "Bienestar", estado: "borrador", publicado: null, orden: 0, publico: "todos", etiquetas: [], seo: {}, autorId: admin.id });

  // Auditoría
  const audita = (accion, entidad, entidadId, resumen, dias, severidad = "info") => d.auditoria.push({ id: id("au"), creado: hace(dias), actorId: admin.id, rol: "admin", actor: admin.nombre, accion, entidad, entidadId, resumen, ip: "127.0.0.1", severidad });
  audita("especialista.estado", "especialista", lucia.e.id, "Publicó la ficha de Lucía Fernández", 420);
  audita("verificacion.aprobar", "verificacion", lucia.e.id, "Verificó la identidad de Lucía Fernández", 88, "seguridad");
  audita("comision.regla", "reglaComision", d.reglasComision[0].id, "Creó la regla Acupuntura 8%", 300, "aviso");
  audita("especialista.crear", "especialista", esp[19].e.id, "Cargó el perfil de Centro Shanti e invitó a reclamarlo", 5);
  audita("destacado.crear", "destacado", d.destacados[0].id, "Activó destacado en inicio para Lucía Fernández", 5);

  d.meta.secuencia = seq;
  // Ninguna fecha de reseña o respuesta puede quedar en el futuro.
  const tope = ahora.getTime() - 20 * 60000;
  for (const rv of d.resenas) {
    const fin = new Date(d.reservas.find((x) => x.id === rv.reservaId)?.fin || rv.creado).getTime();
    if (new Date(rv.creado).getTime() > tope) rv.creado = new Date(Math.max(fin + 60000, tope - 3600000)).toISOString();
    if (rv.respuesta && new Date(rv.respuesta.fecha).getTime() > tope) rv.respuesta.fecha = new Date(Math.max(new Date(rv.creado).getTime() + 60000, tope)).toISOString();
  }
  return d;
}

if (require.main === module) {
  const store = require("../config/store");
  store.reemplazarTodo(generar());
  const datos = store.cargar();
  console.log(`Datos de prueba generados en ${path.relative(config.raiz, config.archivoDatos)}:`);
  for (const k of Object.keys(datos).filter((x) => Array.isArray(datos[x]))) console.log(`  ${k.padEnd(16)} ${datos[k].length}`);
  console.log(`\nUsuarios de prueba (contraseña "${config.claveDemo}"):`);
  for (const u of datos.usuarios.filter((x) => x.prueba)) console.log(`  ${u.email.padEnd(36)} ${u.prueba}`);
}

module.exports = { generar };
