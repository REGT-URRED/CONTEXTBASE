// Motor EGM (Elephant-Goldfish): revision determinista por severidad y convergencia.
// No puntua: clasifica hallazgos por severidad y decide PASS/REFIX/RERUN/FAIL.
// Cero dependencias y cero red: cada hallazgo cita evidencia leida del disco.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeAtomic } from './fsutil.js';

export const EGM_PERSONAS = [
  {
    id: 'egm-zoom-out',
    nombre: 'Zoom Out',
    mision: 'Cuestionar el alcance antes del detalle: YAGNI, reuso real, anti-weeds y causa raiz.',
    dimensiones: ['alcance', 'yagni', 'reuso', 'causa-raiz'],
    estandar: 'zoom-out-standard',
    modo: 'REVIEW',
    artefacto: 'informe de alcance con weeds, causa raiz y oportunidades de reuso',
    criterio_pass: 'El alcance es el minimo que el objetivo exige, cada supuesto tiene causa raiz y nada se reimplementa lo que ya existe.',
  },
  {
    id: 'egm-inventive-catalyst',
    nombre: 'Inventive Catalyst',
    mision: 'Romper los falsos compromisos: contradicciones, promesas excluyentes y TRIZ sobre el problema real.',
    dimensiones: ['contradiccion', 'falso-compromiso', 'triz'],
    estandar: 'heilmeier-standard',
    modo: 'BRAINSTORM',
    artefacto: 'catalogo de contradicciones y de compromisos que hay que elegir',
    criterio_pass: 'Ningun compromiso promete dos propiedades excluyentes a la vez y toda contradiccion tiene resolucion o escala.',
  },
  {
    id: 'egm-codebase-details',
    nombre: 'Codebase Details',
    mision: 'Verificar que el doc coincida con el codigo: referencias, supuestos declarados y casos borde.',
    dimensiones: ['referencias', 'supuestos', 'casos-borde'],
    estandar: 're-implementation-standard',
    modo: 'REVIEW',
    artefacto: 'hallazgos de referencias rotas y supuestos no declarados',
    criterio_pass: 'Cada ruta citada existe en el proyecto o esta declarada como pendiente, y ningun supuesto queda implicito.',
  },
  {
    id: 'egm-comprehension',
    nombre: 'Comprehension',
    mision: 'Exigir auto-contenido: terminos definidos, prerrequisitos declarados y flujo preciso.',
    dimensiones: ['terminos', 'prerrequisitos', 'flujo'],
    estandar: 'zoom-out-standard',
    modo: 'REVIEW',
    artefacto: 'lista de terminos sin definir y de vaguedades de flujo',
    criterio_pass: 'Un lector sin contexto previo entiende que hace cada parte, que significa cada termino y que pasos siguen.',
  },
  {
    id: 'egm-design',
    nombre: 'Design',
    mision: 'Forzar el diseño explicito: alternativas obligatorias, riesgos con mitigacion y preguntas nucleo respondidas.',
    dimensiones: ['alternativas', 'riesgos', 'preguntas-nucleo'],
    estandar: 'feature-spec-standard',
    modo: 'REVIEW',
    artefacto: 'seccion de alternativas y seccion de riesgos con mitigaciones',
    criterio_pass: 'El doc compara al menos dos alternativas, nombra riesgos con su mitigacion y responde las preguntas nucleo.',
  },
  {
    id: 'egm-structural',
    nombre: 'Structural',
    mision: 'Validar la estructura del documento: jerarquia de titulos, secciones obligatorias, tablas y bloques de codigo.',
    dimensiones: ['jerarquia', 'secciones', 'tablas', 'codigo'],
    estandar: 'feature-spec-standard',
    modo: 'REVIEW',
    artefacto: 'informe de estructura con jerarquia y secciones obligatorias',
    criterio_pass: 'La jerarquia de titulos no tiene saltos, las secciones obligatorias estan presentes y las tablas y bloques de codigo estan bien formados.',
  },
  {
    id: 'egm-style',
    nombre: 'Style',
    mision: 'Limpiar la prosa: hype, relleno, jargon y claims sin calibrar.',
    dimensiones: ['hype', 'relleno', 'jargon', 'claims'],
    estandar: 'feature-spec-standard',
    modo: 'REVIEW',
    artefacto: 'hallazgos de prosa con accion DROP/CALIBRATE/RELOCATE/KEEP',
    criterio_pass: 'No hay hype ni relleno y todo claim universal trae su evidencia al lado.',
  },
  {
    id: 'egm-implementation-readiness',
    nombre: 'Implementation Readiness',
    mision: 'Comprobar que el doc se pueda implementar sin decidir nada: fases, file boundary y plan de pruebas.',
    dimensiones: ['decisiones-abiertas', 'fases', 'file-boundary', 'test-plan'],
    estandar: 'implementation-readiness-standard',
    modo: 'REVIEW',
    artefacto: 'hallazgos de readiness y de decisiones abiertas',
    criterio_pass: 'No queda ninguna decision abierta, el alcance por archivo esta declarado y existe un plan de pruebas.',
  },
  {
    id: 'egm-synthesizer',
    nombre: 'Synthesizer',
    mision: 'Consolidar lo revisado: deduplicar, agregar severidades y fijar el veredicto.',
    dimensiones: ['dedup', 'severidad', 'trazabilidad'],
    estandar: 'heilmeier-standard',
    modo: 'REVIEW',
    artefacto: 'breakdown blocker/major/nit y veredicto con trazabilidad al id de cada hallazgo',
    criterio_pass: 'Cada hallazgo conserva su id y su evidencia, no hay duplicados y la severidad agregada es coherente.',
  },
  {
    id: 'egm-bootstrap-orchestrator',
    nombre: 'Bootstrap Orchestrator',
    mision: 'Orquestar el arranque por directorio: contrato de cada carpeta y README estilo Peanuts/Hay.',
    dimensiones: ['contrato', 'readme', 'arranque'],
    estandar: 'implementation-readiness-standard',
    modo: 'REVIEW',
    artefacto: 'contrato por directorio y README de entrada',
    criterio_pass: 'Cada directorio declara su contrato y el README permite arrancar sin leer el codigo.',
    // Su criterio exige juzgar el contrato de un directorio y su README de arranque: no hay regla
    // determinista que lo evalue sin inventar hallazgos. Se declara no automatizable en vez de fingir
    // que corre: el modelo lo reporta como "manual" y nunca lo cuenta como revisor ejecutado.
    automatizable: false,
    motivo_no_automatico: 'Requiere juicio humano sobre el contrato del directorio y el README de arranque; no tiene checker determinista.',
  },
];

export const EGM_ESTANDARES = [
  {
    id: 'feature-spec-standard',
    nombre: 'Feature Spec Standard',
    reglas: [
      'La seccion de alternativas es obligatoria: comparar al menos dos opciones y dejar constancia de la elegida.',
      'La seccion de riesgos es obligatoria y cada riesgo lleva su mitigacion.',
      'Las secciones obligatorias (contexto, alcance, pruebas) no se omiten aunque el equipo las considere obvias.',
      'La prosa no usa hype ni claims sin evidencia.',
    ],
    aceptacion: 'El doc enumera alternativas con su descarte, riesgos con mitigacion y las secciones obligatorias presentes.',
  },
  {
    id: 'heilmeier-standard',
    nombre: 'Heilmeier Standard',
    reglas: [
      'Cual es el objetivo y por que importa.',
      'Como se sabe cuando el trabajo esta terminado.',
      'Que es diferente respecto de lo que ya existe.',
      'Que es lo mas dificil del problema.',
      'Que forma tiene la respuesta mas simple que funcionaria.',
      'Que skills, recursos o conocimiento hacen falta.',
      'Cuanto costara en tiempo y en esfuerzo.',
      'Que riesgos hay y cual es el plan si el riesgo se materializa.',
    ],
    aceptacion: 'Las ocho preguntas del catecismo estan respondidas en el documento y ninguna se responde con un supuesto.',
  },
  {
    id: 'implementation-readiness-standard',
    nombre: 'Implementation Readiness Standard',
    reglas: [
      'Regla Zero-Decision: ninguna decision queda abierta para quien implemente.',
      'Las fases van numeradas y cada una tiene un resultado verificable.',
      'File boundary declarado: que archivos se tocan y cuales no.',
      'Plan de pruebas explicito con casos asociados a cada fase.',
    ],
    aceptacion: 'Un implementador puede trabajar sin preguntar nada y sabe que archivos puede tocar y como se verifica.',
  },
  {
    id: 're-implementation-standard',
    nombre: 'Re-Implementation Standard',
    reglas: [
      'Regla Zero-Assumption: nada se da por supuesto, cada default implicito se declara.',
      'Cada referencia a un archivo del proyecto se verifica contra el disco.',
      'Los casos borde se enumeran, no se insinuan.',
      'Los supuestos del entorno (versiones, permisos, datos) van escritos.',
    ],
    aceptacion: 'Reimplementar desde el doc reproduce el mismo resultado sin acceso al historial ni a la conversacion original.',
  },
  {
    id: 'zoom-out-standard',
    nombre: 'Zoom Out Standard',
    reglas: [
      'Suficiencia de contexto: quien lee sin historial entiende el problema.',
      'Causa raiz: se ataca el origen, no el sintoma.',
      'YAGNI: solo lo que el objetivo exige, sin developmentally provisions.',
      'Leverage existing: reusar lo que ya existe antes de escribir algo nuevo.',
    ],
    aceptacion: 'El alcance esta justificado por el objetivo, cada parte tiene causa raiz y no se duplica capacidad existente.',
  },
];

export const EGM_SKILLS = [
  {
    id: 'egm-brainstorm',
    nombre: 'EGM Brainstorm',
    proposito: 'Abrir el problema con el catalogo de contradicciones antes de escribir nada.',
    trigger: 'Idea nueva, requisito ambiguo o "no se por donde empezar".',
    entradas: ['objetivo en lenguaje humano', 'contexto del repositorio'],
    salida: 'contradicciones detectadas, alternativas y preguntas a responder',
    personas: ['egm-inventive-catalyst', 'egm-zoom-out', 'egm-design'],
  },
  {
    id: 'egm-draft',
    nombre: 'EGM Draft',
    proposito: 'Redactar la especificacion con las secciones obligatorias ya decididas.',
    trigger: 'Alternativas y riesgos ya resueltos, listo para documentar.',
    entradas: ['salida de egm-brainstorm', 'referencias verificadas del codigo'],
    salida: 'documento con contexto, alcance, alternativas, riesgos, fases y pruebas',
    personas: ['egm-design', 'egm-structural', 'egm-codebase-details', 'egm-style'],
  },
  {
    id: 'egm-review',
    nombre: 'EGM Review',
    proposito: 'Pasar el motor determinista sobre un documento y emitir PASS/REFIX/RERUN/FAIL.',
    trigger: 'Documento drafted que necesita veredicto antes de avanzar.',
    entradas: ['ruta del documento', 'raiz del proyecto'],
    salida: 'goldfish_review_report.md con hallazgos por severidad y veredicto',
    personas: ['egm-structural', 'egm-style', 'egm-comprehension', 'egm-design', 'egm-codebase-details', 'egm-zoom-out', 'egm-inventive-catalyst', 'egm-synthesizer'],
  },
  {
    id: 'egm-review-loop',
    nombre: 'EGM Review Loop',
    proposito: 'Iterar rondas de revision hasta la convergencia o el cap, con deteccion de churn.',
    trigger: 'Primer veredicto REFIX con hallazgos abiertos.',
    entradas: ['rondas de egm-review', 'hallazgos corregidos'],
    salida: 'convergencia alcanzada o escalado al humano',
    personas: ['egm-synthesizer', 'egm-design'],
  },
  {
    id: 'egm-resolve',
    nombre: 'EGM Resolve',
    proposito: 'Resolver cada hallazgo con la evidencia leida y dejar el estado al dia.',
    trigger: 'Hallazgo abierto con evidencia suficiente para decidir.',
    entradas: ['hallazgo con id estable', 'evidencia citada'],
    salida: 'hallazgo en estado fixed o settled con resolucion contest/escalate/propose_fix/decline',
    personas: ['egm-codebase-details', 'egm-synthesizer'],
  },
  {
    id: 'egm-drift-report',
    nombre: 'EGM Drift Report',
    proposito: 'Comparar la documentacion contra el codigo y clasificar la diferencia.',
    trigger: 'Cambio en el codigo que no se reflejo en los docs.',
    entradas: ['directorio de docs', 'raiz del proyecto'],
    salida: 'informe de drift con missing_feature, incomplete_model, logic_shortcut o architectural_divergence',
    personas: ['egm-codebase-details', 'egm-synthesizer'],
  },
  {
    id: 'egm-bootstrap',
    nombre: 'EGM Bootstrap',
    proposito: 'Preparar un directorio nuevo con su contrato y un README de entrada.',
    trigger: 'Directorio nuevo o modulo que entra al alcance.',
    entradas: ['nombre del directorio', 'objetivo del directorio'],
    salida: 'contrato por directorio y README estilo Peanuts/Hay',
    personas: ['egm-bootstrap-orchestrator', 'egm-comprehension', 'egm-design'],
  },
];

export const EGM_SEVERIDADES = {
  blocker: {
    descripcion: 'El doc afirma algo falso, contradice el codigo o deja una ambiguedad irresoluble.',
    bloquea: true,
  },
  major: {
    descripcion: 'Halla una brecha contra el estandar aplicado.',
    bloquea: true,
  },
  nit: {
    descripcion: 'Halla cosmetico: no bloquea la revision.',
    bloquea: false,
  },
};

export const EGM_SEVERIDAD_ORDEN = ['blocker', 'major', 'nit'];

export const EGM_RESOLUCIONES = {
  contest: {
    descripcion: 'Hallazgo invalido: debe citar la evidencia leida que lo refuta.',
    reabre: false,
  },
  escalate: {
    descripcion: 'La evidencia esta fuera del alcance: decide un humano.',
    reabre: false,
  },
  propose_fix: {
    descripcion: 'Hallazgo valido: se propone un reemplazo preciso.',
    reabre: true,
  },
  decline: {
    descripcion: 'Nit registrado y no corregido.',
    reabre: false,
  },
};

// Escala de accion del revisor de estilo: que hacer con el texto marcado.
export const EGM_ACCIONES_ESTILO = ['DROP', 'CALIBRATE', 'RELOCATE', 'KEEP'];

export const EGM_MAX_RONDAS = 5;

// Espejo de las reglas de prosa de src/slop.js: ese modulo solo expone scan() sobre diffs de git,
// asi que aqui se replican los mismos patrones para poder revisar un archivo suelto.
const SLOP_PROSA = [
  { id: 'banned-word', severity: 'major', accion: 'DROP', detalle: 'palabra de relleno o marketing IA', re: /\b(seamless(ly)?|leverage|leveraging|robust|cutting-edge|world-class|game-?changer|unlock|empower|elevate|delve|tapestry|myriad|pivotal|meticulous|intricate|testament to|in today'?s fast-paced|revolutioni[sz]e)\b/i },
  { id: 'not-x-but-y', severity: 'nit', accion: 'DROP', detalle: 'construccion contrastiva de relleno', re: /\bnot\s+[a-z][\w\s-]{0,30}\bbut\b/i },
  { id: 'dash-density', severity: 'nit', accion: 'DROP', detalle: 'dos o mas guiones largos en una linea', re: /\u2014/g },
  { id: 'bold-label', severity: 'nit', accion: 'DROP', detalle: 'etiqueta en negrita tipo informe IA', re: /\*\*[^*\n]{2,40}\*\*\s*:/ },
];

const HYPE = ['robusto', 'seamless', 'delve', 'tapestry', 'leverage', 'cutting-edge', 'world-class'];
const CLAIM_FUERTE = /\b(siempre|nunca|jamas|jam[aá]s|garantiza\w*|100\s?%)\b/i;
const CLAIM_DEBIL = /\btodos\b/i;
const EVIDENCIA = /\d|%|benchmark|prueba|test|mide|medici[oó]n|medido|medicion/i;
const ACRONIMOS = new Set(['API', 'URL', 'URI', 'HTTP', 'HTTPS', 'JSON', 'YAML', 'CLI', 'ID', 'OK', 'OS', 'DB', 'SQL', 'CSS', 'HTML', 'JS', 'TS', 'MCP', 'LLM', 'AI', 'UI', 'UX', 'CI', 'CD', 'IO', 'PR', 'RPC', 'TCP', 'UDP', 'GDPR', 'SLA', 'SLO', 'UUID', 'SHA', 'MD', 'PDF', 'CSV', 'TXT', 'XML', 'QA', 'EGM', 'H1', 'H2', 'H3']);

// Palabras españolas que aparecen en mayusculas solo por enfasis. Sin esta lista, el detector
// de siglas marca PROHIBIDO, MISMO o ACTIVA como "sigla sin explicar" y produce ruido puro.
const SIGLAS_ES_NO = new Set([
  'PROHIBIDO', 'MISMO', 'MISMA', 'MISMOS', 'MISMAS', 'ACTIVA', 'ACTIVO',
  'SI', 'NO', 'YA', 'MAS', 'MENOS', 'TODO', 'TODA', 'NADA', 'NUNCA', 'SIEMPRE',
]);

// Hogares externos de agentes: son ubicaciones de OTRA herramienta (o del home del usuario),
// no archivos de este repositorio. Un doc puede mencionarlos sin afirmar que vivan aqui.
const HOGARES_EXTERNOS = [
  '.github/', '.vscode/', '.gemini/', '.kilo/', '.kilocode/', '.opencode/', '.claude/', '.cursor/',
  '.windsurf/', '.continue/', '.agents/', '.pi/', '.hermes/', '.roo/', '.cline/', '.aider', '.goose',
];

// Subdirectorios historicos de planificacion/archivo que se excluyen del pulso automatico y drift
// por defecto (salvo solicitud explicita sobre esa ruta).
const ARCHIVED_DOC_DIRS = new Set(['superpowers', 'archive', 'archived', 'history', 'legacy']);

// Verbos de mencion o estado pasado: la linea narra un hecho historico ("pisaban", "rompia"),
// no afirma que el archivo exista hoy. Se evalua sobre la linea sin acentos y en minusculas.
const VERBO_MENCION = /\b(pisaba|pisaban|sobrescribia|sobrescribian|sobrescribio|rompia|rompian|rompio|causaba|causaban|causo|eliminaba|eliminaban|elimino|dejaba|dejaban|dejo\s+de)\b/;

// Marcas de cita/ejemplo inmediatamente antes de la ruta: "como `x`", "por ejemplo `x`",
// "si existe `x`", "opcional: `x`", "antes `x`". Se exige que la marca este pegada a la ruta:
// un "antes" lejano en la misma linea no absuelve una afirmacion de existencia.
const PREPOSICION_MENCION = /(?:como|por\s+ejemplo|si\s+existe|opcional|antes(?:\s+de)?)\s*[:`"'(]?\s*$/;

// Tipo de documento por nombre y H1. El estandar de diseño (alternativas + riesgos) solo aplica
// a specs/designs reales; un README, un CHANGELOG o un doc de compatibilidad no es un spec.
const KIND_SPEC = /(?:^|[^a-z])(?:spec|rfc|design|plan|propuesta)(?:[^a-z]|$)|especificaci|dise[nñ]o/;
const KIND_REFERENCIA = /readme|compatibilidad|changelog|guia|faq|referencia|manual|troubleshoot|diagnostico|notas|funcionamiento|fundamentos|arquitectura|componentes|tasklist/;

const CODE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|py|go|rs|java|cs|rb|php|sh|ps1|css|scss|less|html|vue|svelte)$/i;
// Acepta separador posix y Windows: un doc escrito en Windows cita rutas con barra invertida
// y tambien debe verificarse contra el disco.
const PATH_RE = /(?:[A-Za-z0-9_.-]+[\/\\])+[A-Za-z0-9_.-]*\.[A-Za-z0-9]+/g;
// Copia sin flag global: RegExp con /g es stateful y .test() avanza lastIndex.
const PATH_ANY = /(?:[A-Za-z0-9_.-]+[\/\\])+[A-Za-z0-9_.-]*\.[A-Za-z0-9]+/;
const CREATION = /\b(create|creating|modify|modifying|delete|deleting|new|nuevo|nueva|crear|creara|creará|creacion|creación|agregar|agrega|anadir|añadir|pendiente|renombrar|eliminar|to\s+create)\b/i;
// TODO/TBD/FIXME/XXX exigen mayusculas para no confundir la palabra espanola "todo" con un pendiente;
// las locuciones en espanol ("por definir", "por decidir", "a definir") si admiten mayusculas o minusculas.
const DECISION_CAPS = /\b(?:TODO|TBD|FIXME|XXX)\b/;
const DECISION_ES = /\b(?:por\s+definir|por\s+decidir|a\s+definir)\b/i;
const matchDecisionMarker = (text) => text.match(DECISION_CAPS) || text.match(DECISION_ES);
const VAGUE = /\b(el|este|ese)\s+(sistema|c[oó]digo|proyecto|m[oó]dulo|servicio)\b/i;
const EXCLUSIVO = new Set([
  'rapido|simple', 'simple|rapido',
  'flexible|estricto', 'estricto|flexible',
  'seguro|barato', 'barato|seguro',
  'rapido|seguro', 'seguro|rapido',
  'ligero|poderoso', 'poderoso|ligero',
  'minimo|maximo', 'maximo|minimo',
  'perfecto|real', 'real|perfecto',
]);
const OVER_ENGINEERING = ['en el futuro', 'podemos agregar', 'por si acaso', 'para escalar', 'placeholder', 'todo futuro'];
const TECHOS = ['express', 'react', 'vue', 'angular', 'svelte', 'sqlite', 'postgres', 'postgresql', 'mysql', 'mongodb', 'redis', 'docker', 'kubernetes', 'graphql', 'rest', 'grpc', 'websocket', 'terraform', 'ansible', 'django', 'fastify', 'nestjs', 'prisma', 'sequelize'];

// ---------- utilidades ----------

function deaccent(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function snippet(text, max = 160) {
  return String(text || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function stripUrls(text) {
  return String(text || '').replace(/https?:\/\/\S+/gi, ' ');
}

// Normaliza una ruta citada en un doc: quita puntuacion final y unifica el separador a '/'.
// Sin esto, una referencia escrita con separador de Windows nunca se resolveria contra el disco.
function cleanRef(raw) {
  return String(raw || '').replace(/[.,;:)]+$/, '').replace(/\\/g, '/');
}

// Extensiones plausibles para una ruta citada. Sin este filtro, un literal de regex como
// /prueba|test/i.test se lee como ruta ("hito/i.test") y produce blockers inventados en un objetivo de codigo.
const REF_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|py|go|rs|java|cs|rb|php|sh|bash|zsh|ps1|psm1|bat|cmd|css|scss|sass|less|html|htm|vue|svelte|md|markdown|mdx|json|jsonc|json5|yml|yaml|toml|ini|cfg|conf|env|txt|csv|tsv|sql|proto|graphql|gql|wasm|svg|png|jpe?g|gif|ico|webp|pdf|zip|tar|gz|lock|log)$/i;

function refsIn(text) {
  return (stripUrls(text).match(PATH_RE) || []).map(cleanRef).filter(r => r && REF_EXT.test(r));
}

// Igual que refsIn pero conserva el indice de cada ruta dentro de la linea (ya sin URLs).
// Sin la posicion no se puede decidir si la ruta viene precedida por "como", "por ejemplo", etc.
function refsWithPos(text) {
  const clean = stripUrls(text);
  const re = new RegExp(PATH_RE.source, 'g');
  const out = [];
  let m;
  while ((m = re.exec(clean))) {
    const ref = cleanRef(m[0]);
    if (!ref || !REF_EXT.test(ref)) continue;
    out.push({ ref, index: m.index, text: clean });
  }
  return out;
}

// Tramos de negrita/cursiva de una linea. Un token en mayusculas dentro de un tramo es enfasis
// del autor ("**PROHIBIDO.**"), no una sigla tecnica que necesite explicacion.
function emphasisSpans(text) {
  const spans = [];
  const src = String(text || '');
  const bold = /(\*\*|__)([^\n]*?)\1/g;
  let m;
  while ((m = bold.exec(src))) spans.push([m.index, m.index + m[0].length]);
  const ital = /(^|[^A-Za-z0-9*_])([*_])([^*_\n]+?)\2(?![A-Za-z0-9*_])/g;
  while ((m = ital.exec(src))) {
    const start = m.index + m[1].length;
    spans.push([start, m.index + m[0].length]);
  }
  return spans;
}

function esHogarExterno(ref) {
  const r = String(ref || '').toLowerCase();
  return HOGARES_EXTERNOS.some(prefix => r.startsWith(prefix));
}

// Una ruta es mencion (no afirmacion) si vive en un hogar externo de agentes, si la linea narra
// un estado pasado o si viene precedida por una marca de ejemplo. En esos casos el doc no afirma
// que el archivo exista en el proyecto y no corresponde blocker.
function esMencion(line, index, ref) {
  if (esHogarExterno(ref)) return true;
  const flat = deaccent(String(line || '')).toLowerCase();
  if (VERBO_MENCION.test(flat)) return true;
  const before = flat.slice(0, Math.max(0, index));
  return PREPOSICION_MENCION.test(before);
}

// Clasifica el objetivo por nombre y H1. 'spec' exige el estandar de diseño; 'referencia'
// (README, CHANGELOG, COMPATIBILIDAD, GUIA, FAQ) no. El nombre del archivo manda: es la
// declaracion mas estable del tipo de documento.
function docKind(ctx) {
  const base = deaccent(path.basename(ctx.rel || ctx.file || '')).toLowerCase();
  if (KIND_REFERENCIA.test(base)) return 'referencia';
  if (KIND_SPEC.test(base)) return 'spec';
  const h1 = ctx.headings.find(h => h.level === 1);
  const title = deaccent(h1 ? h1.title : '').toLowerCase();
  if (KIND_SPEC.test(title)) return 'spec';
  if (KIND_REFERENCIA.test(title)) return 'referencia';
  return 'general';
}

function walk(dir, opts = {}) {
  const ignoreDirs = opts && opts.ignoreDirs;
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (ignoreDirs && ignoreDirs.has(e.name.toLowerCase())) continue;
      out.push(...walk(full, opts));
    } else if (e.isFile()) out.push(full);
  }
  return out;
}

function splitLines(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    const m = t.match(/^(`{3,}|~{3,})/);
    if (fence) {
      out.push({ n: i + 1, text: raw, code: true });
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      continue;
    }
    if (m) { fence = m[1]; out.push({ n: i + 1, text: raw, code: true }); continue; }
    out.push({ n: i + 1, text: raw, code: false });
  }
  return out;
}

function proseOf(lines) {
  return lines.filter(l => !l.code).map(l => ({ n: l.n, text: l.text.replace(/`[^`]*`/g, '') }));
}

function headingsOf(lines) {
  const out = [];
  for (const l of lines) {
    if (l.code) continue;
    const m = l.text.match(/^(#{1,6})\s+(.*)$/);
    if (m) out.push({ level: m[1].length, title: m[2].trim(), n: l.n });
  }
  return out;
}

function sectionsOf(lines, headings) {
  const out = [];
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].n;
    const end = i + 1 < headings.length ? headings[i + 1].n - 1 : lines.length;
    const body = lines.filter(l => !l.code && l.n > start && l.n <= end).map(l => l.text.trim()).filter(Boolean);
    out.push({ level: headings[i].level, title: headings[i].title, n: start, body });
  }
  return out;
}

// ---------- ids estables ----------

// El id se deriva de persona+dimension+scope: el mismo hallazgo conserva su id entre rondas y procesos.
const ID_ASSIGNED = new Map();

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function stableId(persona, dimension, scope) {
  const key = persona + '|' + dimension + '|' + scope;
  if (ID_ASSIGNED.has(key)) return ID_ASSIGNED.get(key);
  let n = hash32(key) % 10000 + 1;
  const taken = new Set(ID_ASSIGNED.values());
  while (taken.has(persona + '-' + n)) n = (n % 10000) + 1;
  const id = persona + '-' + n;
  ID_ASSIGNED.set(key, id);
  return id;
}

// `advisory: true` marca una senal de calibracion, no un defecto: el hallazgo se reporta con su
// persona y su evidencia (trazabilidad), pero no cuenta para el veredicto. Sin este campo, un
// [CALIBRATE] de estilo se leia como "major pendiente" y el documento quedaba en REFIX por ruido.
function mk(persona, severity, dimension, scope, detail, evidence, resolution, advisory) {
  const finding = {
    id: stableId(persona, dimension, scope),
    persona,
    severity,
    dimension,
    scope,
    detail,
    evidence: evidence || '',
    resolution: resolution || (severity === 'nit' ? 'decline' : 'propose_fix'),
    status: 'open',
  };
  if (advisory) finding.advisory = true;
  return finding;
}

// ---------- contexto ----------

function readTarget(root, target) {
  const file = path.resolve(root, String(target || ''));
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return { ok: false, file, reason: 'El objetivo no es un archivo: ' + file };
    const text = fs.readFileSync(file, 'utf8');
    return { ok: true, file, text, rel: path.relative(root, file).replace(/\\/g, '/') };
  } catch (e) {
    return { ok: false, file, reason: 'No se pudo leer el objetivo "' + String(target || '') + '": ' + (e && e.message ? e.message : e) };
  }
}

function buildContext(root, read) {
  const lines = splitLines(read.text);
  const headings = headingsOf(lines);
  const ctx = {
    root,
    file: read.file,
    rel: read.rel,
    text: read.text,
    lines,
    prose: proseOf(lines),
    headings,
    sections: sectionsOf(lines, headings),
    isMd: /\.md$/i.test(read.file),
  };
  ctx.kind = docKind(ctx);
  return ctx;
}

// ---------- checkers deterministas ----------

// "skipped" = el criterio no aplica a este tipo de objetivo (no es un fallo de ejecucion).
// "not run" queda reservado para el revisor que existia y no pudo correr (error de lectura, excepcion).
function skipped(persona, motivo) {
  return {
    persona,
    status: 'skipped',
    findings: [],
    motivo: motivo || 'El criterio solo aplica a documentos Markdown y el objetivo no lo es.',
  };
}

function checkStructural(ctx) {
  if (!ctx.isMd) return skipped('egm-structural');
  const out = [];
  const hs = ctx.headings;
  const h1 = hs.filter(h => h.level === 1);
  if (h1.length === 0) {
    out.push(mk('egm-structural', 'major', 'jerarquia', 'structure:h1', 'El documento no tiene titulo H1.', 'headings encontrados: ' + hs.length, 'propose_fix'));
  } else if (h1.length > 1) {
    out.push(mk('egm-structural', 'major', 'jerarquia', 'structure:h1', 'El documento tiene ' + h1.length + ' titulos H1; debe tener exactamente uno.', 'lineas H1: ' + h1.map(x => x.n).join(', '), 'propose_fix'));
  }
  let prev = 0;
  for (const h of hs) {
    if (prev && h.level > prev + 1) {
      out.push(mk('egm-structural', 'major', 'jerarquia', 'structure:jump:' + prev + '-' + h.level, 'Salto de jerarquia de titulos: H' + prev + ' a H' + h.level + ' en "' + h.title + '".', 'linea ' + h.n, 'propose_fix'));
    }
    prev = h.level;
  }
  const fences = ctx.lines.filter(l => l.code && /^\s*(`{3,}|~{3,})/.test(l.text)).length;
  if (fences % 2 !== 0) {
    out.push(mk('egm-structural', 'major', 'codigo', 'structure:fence', 'Hay un bloque de codigo delimitado sin cerrar.', 'delimitadores encontrados: ' + fences, 'propose_fix'));
  }
  for (const bad of tableProblems(ctx.lines)) {
    out.push(mk('egm-structural', 'major', 'tablas', 'structure:table:' + bad.line, bad.detail, 'linea ' + bad.line, 'propose_fix'));
  }
  if (ctx.kind !== 'referencia' && hs.length >= 3 && !hs.some(h => /contexto|objetivo|proposito|resumen|alcance/i.test(h.title))) {
    out.push(mk('egm-structural', 'major', 'secciones', 'structure:contexto', 'Falta la seccion de contexto, objetivo o alcance que exige el estandar.', 'headings: ' + hs.map(h => h.title).join(' | '), 'propose_fix'));
  }
  return { persona: 'egm-structural', status: 'completed', findings: out };
}

function tableProblems(lines) {
  const problems = [];
  let group = [];
  const flush = () => {
    if (group.length >= 2) {
      const rows = group.map(l => l.text.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()));
      const sep = rows[1] || [];
      if (!sep.length || !sep.every(c => /^:?-{2,}:?$/.test(c))) {
        problems.push({ line: group[1].n, detail: 'La tabla no tiene fila separadora valida.' });
      }
      const widths = new Set(rows.map(r => r.length));
      if (widths.size > 1) {
        problems.push({ line: group[0].n, detail: 'La tabla tiene filas con distinto numero de columnas.' });
      }
    }
    group = [];
  };
  for (const l of lines) {
    const t = l.text.trim();
    if (!l.code && /^\|.*\|$/.test(t)) group.push(l);
    else flush();
  }
  flush();
  return problems;
}

function checkStyle(ctx) {
  if (!ctx.isMd) return skipped('egm-style');
  const out = [];
  for (const l of ctx.prose) {
    const plain = l.text;
    const flat = deaccent(plain).toLowerCase();
    const hypeWords = new Set();
    for (const word of HYPE) {
      const re = new RegExp('\\b' + deaccent(word).toLowerCase() + '\\w*', 'i');
      const m = plain.match(re);
      if (!m) continue;
      hypeWords.add(m[0].toLowerCase());
      const compound = m[0].length > word.length;
      const refAdvisory = !compound && ctx.kind === 'referencia';
      out.push(mk('egm-style', compound ? 'nit' : 'major', 'hype', 'style:hype:' + m[0].toLowerCase(),
        '[' + (compound ? 'KEEP' : 'DROP') + '] Hype de marketing en la prosa: "' + m[0] + '".',
        'linea ' + l.n + ': ' + snippet(plain), compound ? 'decline' : 'propose_fix', refAdvisory));
    }
    for (const rule of SLOP_PROSA) {
      const m = plain.match(rule.re);
      if (!m) continue;
      if (rule.id === 'banned-word' && hypeWords.has(m[0].toLowerCase())) continue;
      // [DROP] cosmetico: la propia accion dice "descartar". Se deja fuera del reporte en vez de
      // ensuciarlo con hallazgos que el revisor mismo no considera un defecto. Un [DROP] major
      // (hype o palabra de relleno) si es defecto de prosa y se conserva.
      if (rule.accion === 'DROP' && rule.severity === 'nit') continue;
      const count = rule.id === 'dash-density' ? (plain.match(/\u2014/g) || []).length : 1;
      out.push(mk('egm-style', rule.severity, 'relleno', 'style:' + rule.id + ':' + m[0].toLowerCase().trim(),
        '[' + rule.accion + '] ' + rule.detalle + ' ("' + snippet(m[0]) + '").',
        'linea ' + l.n + ': ' + snippet(plain) + (count > 1 ? ' (' + count + ' guiones)' : ''), rule.severity === 'nit' ? 'decline' : 'propose_fix'));
    }
    // [CALIBRATE] = el claim necesita evidencia o acotarse, no es un defecto comprobado: se reporta
    // como advisory y no empuja el veredicto a REFIX.
    if (CLAIM_FUERTE.test(flat) && !EVIDENCIA.test(plain)) {
      const m = flat.match(CLAIM_FUERTE);
      out.push(mk('egm-style', 'major', 'claims', 'style:claim:' + m[0], '[CALIBRATE] Claim universal sin evidencia: "' + snippet(m[0]) + '".', 'linea ' + l.n + ': ' + snippet(plain), 'propose_fix', true));
    } else if (CLAIM_DEBIL.test(flat) && !EVIDENCIA.test(plain)) {
      const m = flat.match(CLAIM_DEBIL);
      out.push(mk('egm-style', 'nit', 'claims', 'style:claim:' + m[0], '[CALIBRATE] Cuantificador sin evidencia: "' + snippet(m[0]) + '".', 'linea ' + l.n + ': ' + snippet(plain), 'decline', true));
    }
    // Siglas: solo tokens de 2 a 5 letras, fuera de negrita/cursiva, que no sean palabra común
    // del español ni un acrónimo técnico conocido.
    const spans = emphasisSpans(plain);
    const acroRe = /\b[A-Z]{2,5}\b/g;
    const reportadas = new Set();
    let m;
    while ((m = acroRe.exec(plain))) {
      const sigla = m[0];
      if (ACRONIMOS.has(sigla) || SIGLAS_ES_NO.has(sigla) || reportadas.has(sigla)) continue;
      if (spans.some(([a, b]) => m.index >= a && m.index < b)) continue;
      reportadas.add(sigla);
      out.push(mk('egm-style', 'nit', 'jargon', 'style:jargon:' + sigla, '[CALIBRATE] Sigla sin explicar: "' + sigla + '".', 'linea ' + l.n + ': ' + snippet(plain), 'decline', true));
    }
  }
  return { persona: 'egm-style', status: 'completed', findings: out };
}

function checkComprehension(ctx) {
  if (!ctx.isMd) return skipped('egm-comprehension');
  const out = [];
  const terms = new Map();
  for (const l of ctx.lines) {
    if (l.code) continue;
    const re = /`([A-Za-z_][A-Za-z0-9_]*)`/g;
    let m;
    while ((m = re.exec(l.text))) {
      if (!terms.has(m[1])) terms.set(m[1], { n: l.n, text: l.text });
    }
  }
  for (const [term, def] of terms) {
    const re = new RegExp('\\b' + term + '\\b', 'i');
    for (const l of ctx.prose) {
      if (l.n >= def.n) break;
      if (re.test(l.text)) {
        out.push(mk('egm-comprehension', 'major', 'terminos', 'term:' + term,
          'El termino "' + term + '" se usa antes de definirse.',
          'uso en linea ' + l.n + ', definicion en linea ' + def.n, 'propose_fix', ctx.kind === 'referencia'));
        break;
      }
    }
  }
  for (const l of ctx.prose) {
    const m = l.text.match(VAGUE);
    if (!m) continue;
    if (PATH_ANY.test(l.text)) continue;
    out.push(mk('egm-comprehension', 'nit', 'flujo', 'vague:' + m[0].toLowerCase(),
      '[RELOCATE] Referencia generica sin ruta: "' + snippet(m[0]) + '".',
      'linea ' + l.n + ': ' + snippet(l.text), 'decline', true));
  }
  for (const s of ctx.sections) {
    if (s.level === 1) continue;
    if (s.body.length < 2) {
      out.push(mk('egm-comprehension', 'nit', 'flujo', 'short:' + s.title,
        'La seccion "' + s.title + '" tiene ' + s.body.length + ' linea(s) de cuerpo; queda vaga.',
        'linea ' + s.n, 'decline'));
    }
  }
  return { persona: 'egm-comprehension', status: 'completed', findings: out };
}

function checkImplementationReadiness(ctx) {
  if (!ctx.isMd) return skipped('egm-implementation-readiness');
  const out = [];
  // Evaluamos ctx.prose (excluye bloques de codigo y literales `...` en linea) para no
  // marcar documentacion tecnica que explica comandos o palabras clave (p. ej. `TODO`/`FIXME`).
  for (const l of ctx.prose) {
    const m = matchDecisionMarker(l.text);
    if (!m) continue;
    out.push(mk('egm-implementation-readiness', 'major', 'decisiones-abiertas', 'marker:' + m[0].toLowerCase().trim(),
      'Decision abierta en el documento ("' + snippet(m[0]) + '"); la regla Zero-Decision lo impide.',
      'linea ' + l.n + ': ' + snippet(l.text), 'propose_fix'));
  }
  for (const s of ctx.sections) {
    if (!/plan|fase|implementa|hito/i.test(s.title)) continue;
    for (const line of s.body) {
      if (!/[¿?]/.test(line) || !/\?\s*$/.test(line)) continue;
      out.push(mk('egm-implementation-readiness', 'major', 'decisiones-abiertas', 'question:' + snippet(line, 40),
        'Pregunta sin responder en la seccion "' + s.title + '".',
        'linea ' + s.n + ': ' + snippet(line), 'propose_fix'));
    }
  }
  // El plan de pruebas se exige a un spec de implementacion, no a cualquier prosa que mencione
  // "test": un doc de compatibilidad explica fallos, no promete una suite. En documentos de
  // referencia o generales el requisito queda como advisory (se reporta, no bloquea).
  const mentionsTests = /\b(test|pruebas?|QA)\b/i.test(ctx.text);
  const hasTestSection = ctx.headings.some(h => /prueba|test|qa/i.test(h.title));
  if (mentionsTests && !hasTestSection) {
    out.push(mk('egm-implementation-readiness', 'major', 'test-plan', 'tests:missing',
      'El documento menciona pruebas pero no tiene seccion de plan de pruebas.',
      'headings: ' + ctx.headings.map(h => h.title).join(' | '), 'propose_fix', ctx.kind !== 'spec'));
  }
  const hasImplSection = ctx.headings.some(h => /implementa|fase|hito/i.test(h.title));
  if (hasImplSection && !/archivo|file/i.test(ctx.text)) {
    out.push(mk('egm-implementation-readiness', 'major', 'file-boundary', 'file-boundary:missing',
      'Hay seccion de implementacion sin file boundary declarado (que archivos se tocan).',
      'headings: ' + ctx.headings.map(h => h.title).join(' | '), 'propose_fix'));
  }
  return { persona: 'egm-implementation-readiness', status: 'completed', findings: out };
}

function checkDesign(ctx) {
  if (!ctx.isMd) return skipped('egm-design');
  const out = [];
  if (ctx.headings.length < 3) return { persona: 'egm-design', status: 'completed', findings: out };
  // El estandar de alternativas/riesgos es de specs y diseños. Un README, un CHANGELOG o un
  // documento de compatibilidad no es un spec: exigirle "alternativas" inventa un major.
  if (ctx.kind === 'referencia') return { persona: 'egm-design', status: 'completed', findings: out };
  if (!ctx.headings.some(h => /alternativ/i.test(h.title))) {
    out.push(mk('egm-design', 'major', 'alternativas', 'section:alternativas',
      'Falta la seccion de alternativas exigida por el estandar.',
      'headings: ' + ctx.headings.map(h => h.title).join(' | '), 'propose_fix'));
  }
  if (!ctx.headings.some(h => /riesgo|mitigaci/i.test(h.title))) {
    out.push(mk('egm-design', 'major', 'riesgos', 'section:riesgos',
      'Falta la seccion de riesgos con mitigacion exigida por el estandar.',
      'headings: ' + ctx.headings.map(h => h.title).join(' | '), 'propose_fix'));
  }
  return { persona: 'egm-design', status: 'completed', findings: out };
}

function checkCodebaseDetails(ctx) {
  const out = [];
  const occ = new Map();
  for (const l of ctx.lines) {
    if (l.code) continue;
    for (const hit of refsWithPos(l.text)) {
      if (!occ.has(hit.ref)) occ.set(hit.ref, []);
      occ.get(hit.ref).push({
        n: l.n,
        text: hit.text,
        creation: CREATION.test(l.text),
        mention: esMencion(hit.text, hit.index, hit.ref),
      });
    }
  }
  for (const [ref, list] of occ) {
    if (ref.endsWith('/')) continue;
    // Solo una ocurrencia que AFIRMA existencia puede ser blocker. Una mencion historica
    // ("pisaban archivos completos") o un hogar externo de agentes no afirma que el archivo
    // viva en este proyecto.
    const afirmaciones = list.filter(o => !o.creation && !o.mention);
    const menciones = list.filter(o => !o.creation && o.mention);
    // Se resuelve contra la raiz del proyecto y tambien contra el directorio del objetivo:
    // un import relativo al propio archivo es correcto aunque no exista en la raiz.
    const existe = fs.existsSync(path.join(ctx.root, ref)) || fs.existsSync(path.join(path.dirname(ctx.file), ref));
    if (afirmaciones.length && !existe) {
      const first = afirmaciones[0];
      out.push(mk('egm-codebase-details', 'blocker', 'referencias', 'ref:' + ref,
        'El documento da por existente "' + ref + '" pero ese archivo no existe en el proyecto.',
        'linea ' + first.n + ': ' + snippet(first.text), 'propose_fix'));
    } else if (!afirmaciones.length && menciones.length && !existe) {
      // Senal conservada sin peso en el veredicto: se ve en el reporte, no bloquea.
      const first = menciones[0];
      out.push(mk('egm-codebase-details', 'nit', 'referencias', 'ref-mencion:' + ref,
        '[INFO] Mencion de "' + ref + '" (hogar externo de agentes, ejemplo o estado pasado): no se exige que exista en el proyecto.',
        'linea ' + first.n + ': ' + snippet(first.text), 'decline', true));
    }
  }
  return { persona: 'egm-codebase-details', status: 'completed', findings: out };
}

function checkZoomOut(ctx) {
  const out = [];
  const hits = [];
  for (const l of ctx.prose) {
    const flat = deaccent(l.text).toLowerCase();
    for (const s of OVER_ENGINEERING) {
      if (flat.includes(s)) hits.push({ s, n: l.n, text: l.text });
    }
  }
  const distinct = [...new Set(hits.map(h => h.s))];
  for (const s of distinct) {
    const first = hits.find(h => h.s === s);
    out.push(mk('egm-zoom-out', 'nit', 'sobre-ingenieria', 'overengineering:' + s,
      'Senal de sobre-ingenieria ("' + s + '") sin necesidad demostrada (YAGNI).',
      'linea ' + first.n + ': ' + snippet(first.text), 'decline'));
  }
  if (distinct.length >= 3) {
    out.push(mk('egm-zoom-out', 'major', 'sobre-ingenieria', 'overengineering:global',
      'Sobre-ingenieria sistematica: ' + distinct.length + ' senales de alcance futuro en el mismo documento.',
      'senales: ' + distinct.join(', '), 'propose_fix'));
  }
  for (const name of proposedHelpers(ctx)) {
    const existing = findExistingHelper(ctx.root, name);
    if (!existing) continue;
    out.push(mk('egm-zoom-out', 'major', 'reuso', 'reuse:' + name,
      'El documento propone el helper "' + name + '" pero ya existe en el proyecto.',
      'helper existente: ' + existing, 'propose_fix'));
  }
  return { persona: 'egm-zoom-out', status: 'completed', findings: out };
}

function proposedHelpers(ctx) {
  const out = new Set();
  for (const l of ctx.prose) {
    if (!/\b(nuev[oa]s?|crea\w*|agrega\w*|helper\w*|utilidad\w*|funci[oó]n\w*)/i.test(l.text)) continue;
    const matches = l.text.match(/`([A-Za-z_][A-Za-z0-9_]*)`/g) || [];
    for (const raw of matches) {
      const name = raw.replace(/`/g, '');
      if (name.length > 2) out.add(name);
    }
  }
  return [...out];
}

function findExistingHelper(root, name) {
  const srcDir = path.join(root, 'src');
  if (!fs.existsSync(srcDir)) return null;
  const re = new RegExp('(?:export\\s+(?:async\\s+)?function\\s+' + name + '\\b|export\\s+const\\s+' + name + '\\b|(?:const|let|var|function)\\s+' + name + '\\b)');
  for (const f of walk(srcDir)) {
    if (!CODE_EXT.test(f)) continue;
    let text = '';
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    if (re.test(text)) return path.relative(root, f).replace(/\\/g, '/');
  }
  return null;
}

function checkInventiveCatalyst(ctx) {
  const out = [];
  for (const l of ctx.prose) {
    const flat = deaccent(l.text).toLowerCase();
    const pairs = flat.matchAll(/([a-z]+)\s+y\s+([a-z]+)/g);
    for (const p of pairs) {
      const key = p[1] + '|' + p[2];
      if (!EXCLUSIVO.has(key)) continue;
      out.push(mk('egm-inventive-catalyst', 'major', 'falso-compromiso', 'commitment:' + key,
        'Falso compromiso: "' + p[1] + ' y ' + p[2] + '" promete dos propiedades excluyentes a la vez.',
        'linea ' + l.n + ': ' + snippet(l.text), 'propose_fix'));
    }
    const simple = flat.match(/lo mas simple posible|lo mas facil posible|tan simple como sea posible/i);
    if (simple) {
      out.push(mk('egm-inventive-catalyst', 'major', 'falso-compromiso', 'commitment:lo-mas-simple-possible',
        'Falso compromiso: "' + snippet(simple[0]) + '" no admite criterio de verificacion.',
        'linea ' + l.n + ': ' + snippet(l.text), 'propose_fix'));
    }
  }
  return { persona: 'egm-inventive-catalyst', status: 'completed', findings: out };
}

const CHECKERS = [
  checkStructural,
  checkStyle,
  checkComprehension,
  checkImplementationReadiness,
  checkDesign,
  checkCodebaseDetails,
  checkZoomOut,
  checkInventiveCatalyst,
];

// ---------- motor de revision ----------

// Un hallazgo advisory es una senal de calibracion: se reporta, pero no cuenta para el veredicto.
function countBy(findings) {
  const c = { blocker: 0, major: 0, nit: 0 };
  for (const f of findings) {
    if (!f || f.advisory) continue;
    if (c[f.severity] !== undefined) c[f.severity]++;
  }
  return c;
}

function countAdvisory(findings) {
  return findings.filter(f => f && f.advisory).length;
}

function dedupeById(findings) {
  const seen = new Map();
  for (const f of findings) {
    if (!f || !f.id) continue;
    if (!seen.has(f.id)) seen.set(f.id, f);
  }
  return [...seen.values()];
}

// Orden de severidad: se usa el export EGM_SEVERIDAD_ORDEN (blocker -> major -> nit)
// para que el resultado y el reporte presenten primero lo que bloquea.
function severityRank(severity) {
  const i = EGM_SEVERIDAD_ORDEN.indexOf(severity);
  return i === -1 ? EGM_SEVERIDAD_ORDEN.length : i;
}

function orderBySeverity(findings) {
  return findings.slice().sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

// Estados que significan "no pudo ejecutarse", unico motivo valido para RERUN.
// "skipped" (el criterio no aplica) y "manual" (persona sin checker) no son fallos de ejecucion.
const NOT_EXECUTED = new Set(['not run', 'error']);

function summaryOf(findings, reviewers) {
  const c = countBy(findings);
  const open = findings.filter(f => f.status === 'open' && !f.advisory);
  const oc = countBy(open);
  const dims = [...new Set(findings.map(f => f.dimension))].sort();
  const failed = reviewers.filter(r => NOT_EXECUTED.has(r.status)).length;
  return {
    total: findings.length,
    blocker: c.blocker,
    major: c.major,
    nit: c.nit,
    advisory: countAdvisory(findings),
    abiertos: { total: open.length, blocker: oc.blocker, major: oc.major, nit: oc.nit },
    revisores: {
      total: reviewers.length,
      completed: reviewers.filter(r => r.status === 'completed').length,
      skipped: reviewers.filter(r => r.status === 'skipped').length,
      manual: reviewers.filter(r => r.status === 'manual').length,
      failed,
      // Compatibilidad: "no completaron", cualquiera sea el motivo.
      notRun: reviewers.filter(r => r.status !== 'completed').length,
    },
    dimensiones: dims,
  };
}

function detectChurn(current, previous) {
  const fixed = new Set();
  for (const p of previous || []) {
    if (!p || p.status !== 'fixed') continue;
    if (p.scope) fixed.add(p.scope);
    if (p.id) fixed.add(p.id);
  }
  for (const f of current) {
    if (f.status === 'fixed' || f.status === 'settled') continue;
    // Un advisory no es un fix reabierto: no puede disparar churn ni escalado.
    if (f.advisory) continue;
    if (fixed.has(f.scope) || fixed.has(f.id)) {
      return { id: f.id, scope: f.scope, persona: f.persona };
    }
  }
  return null;
}

// ---------- comparacion contra base (git, solo built-ins) ----------

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return {
    ok: !r.error && r.status === 0,
    out: String(r.stdout || '').trim(),
    err: String(r.stderr || '').trim(),
  };
}

function parseNumstat(out) {
  const files = [];
  for (const line of String(out || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    files.push({
      file: parts.slice(2).join('\t'),
      // "-" es un archivo binario: git no cuenta lineas.
      added: parts[0] === '-' ? null : Number(parts[0]),
      deleted: parts[1] === '-' ? null : Number(parts[1]),
    });
  }
  return files;
}

// Compara de verdad contra la base citada: sin esto el flag --base solo se imprimia.
// Devuelve siempre un objeto { ref, ok, files, target, message } para que el reporte
// pueda distinguir "no hay diff" de "no se pudo comparar".
function compareAgainstBase(root, base, targetRel) {
  if (!base) return null;
  const info = { ref: String(base), ok: false, files: [], target: null, message: '' };

  const inside = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.out !== 'true') {
    info.message = 'No se pudo comparar contra "' + info.ref + '": "' + root + '" no es un repositorio git o git no esta disponible.';
    return info;
  }
  if (!git(root, ['rev-parse', '--verify', '--quiet', info.ref + '^{commit}']).ok) {
    info.message = 'La referencia base "' + info.ref + '" no existe en este repositorio: no hay comparacion posible.';
    return info;
  }
  if (!git(root, ['ls-files', '--error-unmatch', '--', targetRel]).ok) {
    info.message = 'El objetivo "' + targetRel + '" no esta versionado en git: no hay diff contra "' + info.ref + '".';
    return info;
  }

  const diff = git(root, ['-c', 'core.quotepath=false', 'diff', '--numstat', info.ref]);
  if (!diff.ok) {
    info.message = 'git diff contra "' + info.ref + '" fallo: ' + (diff.err || 'sin detalle').split(/\r?\n/)[0];
    return info;
  }

  info.ok = true;
  info.files = parseNumstat(diff.out);
  const changed = info.files.find(f => f.file === targetRel) || null;
  info.target = {
    file: targetRel,
    added: changed ? changed.added : 0,
    deleted: changed ? changed.deleted : 0,
    changed: Boolean(changed),
  };
  info.message = info.files.length
    ? info.files.length + ' archivo(s) cambiaron respecto de "' + info.ref + '".'
    : 'Sin cambios respecto de "' + info.ref + '".';
  return info;
}

// ---------- una ronda de revision ----------

function runReviewers(ctx) {
  const reviewers = [];
  const raw = [];
  for (const checker of CHECKERS) {
    const r = checker(ctx);
    const entry = { persona: r.persona, status: r.status, findings: r.findings.length };
    if (r.motivo) entry.motivo = r.motivo;
    reviewers.push(entry);
    raw.push(...r.findings.filter(Boolean));
  }
  // Personas sin checker determinista: se listan como "manual" para que la lista de
  // revisores refleje exactamente quien corrio y no oculte la brecha.
  for (const p of EGM_PERSONAS) {
    if (p.automatizable !== false) continue;
    reviewers.push({ persona: p.id, status: 'manual', findings: 0, motivo: p.motivo_no_automatico });
  }
  // El sintetizador no genera hallazgos: deduplica y consolida lo que los revisores produjeron.
  const findings = dedupeById(raw);
  reviewers.push({ persona: 'egm-synthesizer', status: 'completed', findings: 0, consolidated: findings.length });
  return { reviewers, findings };
}

function roundIsClean(findings, reviewers) {
  const c = countBy(findings);
  if (c.blocker > 0 || c.major > 0) return false;
  return !reviewers.some(r => NOT_EXECUTED.has(r.status));
}

export function egmReview({ cwd, target, base, maxRounds = EGM_MAX_RONDAS, previous } = {}) {
  const root = path.resolve(cwd || process.cwd());
  // Sin --target se revisa el mismo objetivo por defecto que usa el pulso
  // (el documento de diseno mas reciente de docs/); antes se resolvia contra el
  // cwd y un comando recomendado por el propio digest terminaba en FAIL espurio.
  const resolvedTarget = target || egmPulseTarget(root, null) || '';
  const read = readTarget(root, resolvedTarget);
  if (!read.ok) {
    const result = {
      target: String(resolvedTarget || ''),
      rounds: 0,
      findings: [],
      summary: summaryOf([], []),
      verdict: 'FAIL',
      reviewComplete: false,
      reason: read.reason,
      reviewers: [],
      base: base || null,
      baseDiff: null,
      maxRounds,
      convergence: null,
    };
    result.report = egmReport(result);
    return result;
  }

  const ctx = buildContext(root, read);

  // Varias rondas sobre el mismo archivo: el contenido no cambia dentro de la llamada,
  // asi que cada ronda extra solo confirma estabilidad. Si la firma de hallazgos se repite,
  // seguir leyendo no aporta evidencia y se corta antes del cap.
  const cap = Math.max(1, Math.floor(Number(maxRounds)) || 1);
  const roundsData = [];
  let signature = null;
  for (let i = 0; i < cap; i++) {
    const round = runReviewers(ctx);
    const next = round.findings.map(f => f.id + ':' + f.status).sort().join('|');
    roundsData.push(round);
    if (signature !== null && next === signature) break;
    signature = next;
  }

  const last = roundsData[roundsData.length - 1];
  const findings = orderBySeverity(last.findings);
  const reviewers = last.reviewers;
  const counts = countBy(findings);
  const failed = reviewers.filter(r => NOT_EXECUTED.has(r.status));
  const churn = detectChurn(findings, previous);
  const convergence = egmConvergence({ findingsByRound: roundsData, maxRounds: cap });

  let verdict;
  let reason;
  if (counts.blocker > 0) {
    verdict = 'FAIL';
    reason = counts.blocker + ' blocker(s): el documento contradice el codigo o afirma algo falso.';
  } else if (churn) {
    verdict = 'RERUN';
    reason = 'Churn: el hallazgo ' + churn.id + ' reaparece en el scope ' + churn.scope + ' despues de un fix.';
  } else if (failed.length) {
    verdict = 'RERUN';
    reason = 'Revisores sin ejecutar: ' + failed.map(r => r.persona).join(', ') + '.';
  } else if (counts.major > 0) {
    verdict = 'REFIX';
    reason = counts.major + ' major(s) pendientes contra el estandar aplicado.';
  } else if (convergence.converged) {
    verdict = 'PASS';
    reason = 'Sin blockers ni majors; ' + convergence.cleanRounds + ' ronda(s) limpias consecutivas en ' + roundsData.length + ' ronda(s).';
  } else {
    verdict = 'PASS';
    reason = 'Sin blockers ni majors y todos los revisores aplicables completaron.';
  }

  const result = {
    target: read.rel || String(target || ''),
    rounds: roundsData.length,
    findings,
    summary: summaryOf(findings, reviewers),
    verdict,
    reviewComplete: true,
    reason,
    reviewers,
    base: base || null,
    baseDiff: compareAgainstBase(root, base, read.rel || String(target || '')),
    maxRounds,
    convergence: {
      converged: convergence.converged,
      cleanRounds: convergence.cleanRounds,
      escalation: convergence.escalation,
    },
  };
  result.report = egmReport(result);
  return result;
}

// ---------- motor de convergencia ----------

function normalizeRound(round) {
  // Los elementos nulos se descartan antes de mapear: una ronda con un hueco no debe tumbar el motor.
  if (Array.isArray(round)) return { findings: round.filter(Boolean), reviewers: [] };
  const findings = Array.isArray(round && round.findings) ? round.findings.filter(Boolean) : [];
  const reviewers = Array.isArray(round && round.reviewers) ? round.reviewers.filter(Boolean) : [];
  return { findings, reviewers };
}

function scopeKey(f) {
  return (f && (f.scope || f.id)) || '';
}

export function egmConvergence({ findingsByRound, maxRounds = EGM_MAX_RONDAS } = {}) {
  const input = Array.isArray(findingsByRound) ? findingsByRound : [];
  const cap = Math.max(1, Number(maxRounds) || EGM_MAX_RONDAS);
  const statusById = new Map();
  const statusByScope = new Map();
  const resolutionById = new Map();
  const resolutionByScope = new Map();
  const fixedIds = new Set();
  const fixedScopes = new Set();
  let churn = false;
  let churnDetail = null;
  let cleanStreak = 0;
  let cleanRounds = 0;
  let openBlockers = 0;
  let openMajors = 0;
  const detalle = [];

  for (const raw of input) {
    const round = normalizeRound(raw);
    const resolved = round.findings.map(f => {
      const prev = statusById.get(f.id) || statusByScope.get(scopeKey(f));
      if (prev !== 'settled') return f;
      // Una resolucion con reabre=true (propose_fix) autoriza que el hallazgo vuelva a abrirse.
      const prevResolution = resolutionById.get(f.id) || resolutionByScope.get(scopeKey(f));
      const def = prevResolution ? EGM_RESOLUCIONES[prevResolution] : null;
      if (def && def.reabre) return Object.assign({}, f, { status: 'open', reabierto: true });
      return Object.assign({}, f, { status: 'settled' });
    });
    for (const f of resolved) {
      if (f.status === 'fixed' || f.status === 'settled') continue;
      if (fixedIds.has(f.id) || fixedScopes.has(scopeKey(f))) {
        churn = true;
        churnDetail = { id: f.id, scope: f.scope, persona: f.persona };
      }
    }
    for (const f of resolved) {
      statusById.set(f.id, f.status);
      statusByScope.set(scopeKey(f), f.status);
      if (f.resolution) {
        resolutionById.set(f.id, f.resolution);
        resolutionByScope.set(scopeKey(f), f.resolution);
      }
      if (f.status === 'fixed') {
        fixedIds.add(f.id);
        fixedScopes.add(scopeKey(f));
      }
    }
    // Los advisory no cuentan como abiertos: una ronda con solo senales de calibracion es limpia.
    const open = resolved.filter(f => f.status === 'open' && !f.advisory);
    const blockers = open.filter(f => f.severity === 'blocker').length;
    const majors = open.filter(f => f.severity === 'major').length;
    openBlockers = Math.max(openBlockers, blockers);
    openMajors = Math.max(openMajors, majors);
    // "skipped" y "manual" no son fallos de ejecucion: no impiden una ronda limpia.
    const reviewersOk = !round.reviewers.some(rv => NOT_EXECUTED.has(rv.status));
    const clean = blockers === 0 && majors === 0 && reviewersOk;
    if (clean) { cleanStreak++; cleanRounds = cleanStreak; } else cleanStreak = 0;
    detalle.push({ findings: resolved, clean, blockers, majors });
  }

  const rounds = input.length;
  const converged = cleanRounds >= 2;
  let verdict;
  let escalation = null;
  if (churn) {
    verdict = 'FAIL';
    escalation = {
      required: true,
      motivo: 'Churn: ' + churnDetail.id + ' reaparece en el scope ' + churnDetail.scope + ' tras un fix. Escalar a humano.',
      id: churnDetail.id,
      scope: churnDetail.scope,
    };
  } else if (rounds >= cap && !converged) {
    verdict = 'FAIL';
    escalation = {
      required: true,
      motivo: 'Cap de ' + cap + ' rondas alcanzado con hallazgos abiertos. Escalar a humano.',
      rondas: rounds,
    };
  } else if (converged) {
    verdict = 'PASS';
  } else if (openBlockers > 0) {
    verdict = 'FAIL';
  } else if (openMajors > 0) {
    verdict = 'REFIX';
  } else {
    verdict = 'RERUN';
  }

  return { converged, rounds, cleanRounds, churn, verdict, escalation, open: { blocker: openBlockers, major: openMajors }, detalle };
}

// ---------- drift doc-codigo ----------

function driftIncompleteModel(ctx, codeRefs) {
  const out = [];
  const modelSections = ctx.sections.filter(s => /campo|modelo|esquema|datos|contrato/i.test(s.title));
  if (!modelSections.length) return out;
  const target = codeRefs.find(r => CODE_EXT.test(r));
  if (!target) return out;
  let code = '';
  try { code = fs.readFileSync(path.join(ctx.root, target), 'utf8'); } catch { return out; }
  const flat = deaccent(code);
  for (const s of modelSections) {
    for (const line of s.body) {
      const names = [];
      const bt = line.match(/`([A-Za-z_][A-Za-z0-9_]*)`/g) || [];
      for (const raw of bt) names.push(raw.replace(/`/g, ''));
      const kv = line.match(/^\s*[-*]?\s*([A-Za-z_][A-Za-z0-9_]*)\s*[:=]/);
      if (kv) names.push(kv[1]);
      for (const name of names) {
        if (!flat.includes(name)) {
          out.push({
            doc: ctx.rel,
            kind: 'incomplete_model',
            ref: target,
            campo: name,
            detail: 'El campo "' + name + '" declarado en el doc no aparece en ' + target + '.',
          });
        }
      }
    }
  }
  return out;
}

// Valores que se repiten pero no son valores de negocio hardcodeados: codificaciones,
// formatos y literales estructurales. Un operador como ") + " nunca es drift.
const VALOR_NO_NEGOCIO = new Set([
  'utf8', 'utf-8', 'utf16', 'latin1', 'ascii', 'base64', 'hex', 'binary',
  'json', 'text', 'plain', 'html', 'xml', 'yaml', 'string', 'number', 'boolean',
  'object', 'array', 'undefined', 'null', 'true', 'false',
]);

// Un valor de negocio hardcodeado es un identificador legible, no un fragmento de sintaxis.
function isBusinessValue(value) {
  if (typeof value !== 'string') return false;
  if (value.length < 3 || value.length > 40) return false;
  if (!/[A-Za-z]/.test(value)) return false;
  if (!/^[A-Za-z][A-Za-z0-9_.:@/-]*$/.test(value)) return false;
  return !VALOR_NO_NEGOCIO.has(value.toLowerCase());
}

// Numero magico repetido: 3+ digitos y no un ano calendario.
function isMagicNumber(value) {
  if (!/^\d{3,}$/.test(value)) return false;
  return !/^(19|20)\d{2}$/.test(value);
}

function driftLogicShortcut(ctx, codeRefs) {
  const out = [];
  if (!/din[aá]mic|configurab|por\s+par[aá]metro|variable/i.test(ctx.text)) return out;
  for (const ref of codeRefs) {
    if (!CODE_EXT.test(ref)) continue;
    let code = '';
    try { code = fs.readFileSync(path.join(ctx.root, ref), 'utf8'); } catch { continue; }
    const counts = new Map();
    for (const m of code.matchAll(/(['"])([^'"\n]{3,})\1/g)) {
      const key = m[2];
      if (!isBusinessValue(key)) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const m of code.matchAll(/\b(\d{3,})\b/g)) {
      if (!isMagicNumber(m[1])) continue;
      counts.set(m[1], (counts.get(m[1]) || 0) + 1);
    }
    for (const [value, n] of counts) {
      if (n < 3) continue;
      out.push({
        doc: ctx.rel,
        kind: 'logic_shortcut',
        ref,
        detail: 'El valor "' + value + '" esta hardcodeado ' + n + ' veces en ' + ref + ', donde el doc espera logica dinamica.',
      });
      break;
    }
  }
  return out;
}

function driftArchitecturalDivergence(ctx, root) {
  const out = [];
  const flat = deaccent(ctx.text).toLowerCase();
  const srcDir = path.join(root, 'src');
  const files = fs.existsSync(srcDir) ? walk(srcDir).filter(f => CODE_EXT.test(f)) : [];
  let corpus = '';
  for (const f of files) {
    try { corpus += fs.readFileSync(f, 'utf8').toLowerCase(); } catch { /* archivo ilegible: se ignora */ }
  }
  for (const tech of TECHOS) {
    if (!new RegExp('\\b' + tech + '\\b').test(flat)) continue;
    if (corpus.includes(tech)) continue;
    out.push({
      doc: ctx.rel,
      kind: 'architectural_divergence',
      tech,
      detail: 'El doc menciona "' + tech + '" pero el codigo de src/ no lo usa.',
    });
  }
  return out;
}

export function egmDrift({ cwd, docsDir } = {}) {
  const root = path.resolve(cwd || process.cwd());
  const docs = path.resolve(root, String(docsDir || 'docs'));
  const drift = [];
  // Un directorio inexistente NO es "sin drift": es un escaneo que nunca ocurrio.
  if (!fs.existsSync(docs)) {
    return {
      drift: [],
      docsDir: docs,
      missingDocs: true,
      scanned: 0,
      message: 'El directorio de documentacion no existe: ' + docs + '. No se escaneo ningun archivo.',
    };
  }

  const explicitSegments = String(docsDir || '').split(/[\\/]+/).filter(Boolean).map(s => s.toLowerCase());
  const includeArchived = explicitSegments.some(s => ARCHIVED_DOC_DIRS.has(s));

  let scanned = 0;
  for (const file of walk(docs, includeArchived ? {} : { ignoreDirs: ARCHIVED_DOC_DIRS })) {
    if (!/\.md$/i.test(file)) continue;
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    scanned++;
    const ctx = buildContext(root, { file, text, rel: path.relative(root, file).replace(/\\/g, '/') });
    const refs = [];
    const seen = new Set();
    for (const l of ctx.lines) {
      if (l.code) continue;
      for (const hit of refsWithPos(l.text)) {
        if (esMencion(hit.text, hit.index, hit.ref)) continue;
        if (seen.has(hit.ref)) continue;
        seen.add(hit.ref);
        refs.push({ ref: hit.ref, creation: CREATION.test(l.text), n: l.n, text: l.text });
      }
    }
    const existing = refs.filter(r => !r.creation && fs.existsSync(path.join(root, r.ref))).map(r => r.ref);
    for (const r of refs) {
      if (r.creation) continue;
      if (fs.existsSync(path.join(root, r.ref))) continue;
      drift.push({
        doc: ctx.rel,
        kind: 'missing_feature',
        ref: r.ref,
        detail: 'El doc cita "' + r.ref + '" y el proyecto no lo tiene (linea ' + r.n + ').',
      });
    }
    if (ctx.kind === 'spec') {
      drift.push(...driftIncompleteModel(ctx, existing));
      drift.push(...driftLogicShortcut(ctx, existing));
      drift.push(...driftArchitecturalDivergence(ctx, root));
    }
  }

  if (!drift.length) return { drift: [], docsDir: docs, missingDocs: false, scanned, message: 'No drift detected' };
  return { drift, docsDir: docs, missingDocs: false, scanned, message: drift.length + ' diferencia(s) doc-codigo detectada(s).' };
}

// ---------- reporte ----------

function escapeCell(text) {
  return String(text || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function egmReport(result) {
  const r = result || {};
  const s = r.summary || {};
  const L = [];
  L.push('# Goldfish Review Report');
  L.push('');
  L.push('Target: ' + (r.target || '(sin target)'));
  L.push('Veredicto: ' + (r.verdict || 'FAIL'));
  L.push('Revision completa: ' + (r.reviewComplete === false ? 'no' : 'si'));
  if (r.base) L.push('Base: ' + r.base);
  L.push('Rondas: ' + (r.rounds || 0));
  L.push('');
  L.push('## Resumen');
  L.push('- blocker: ' + (s.blocker || 0));
  L.push('- major: ' + (s.major || 0));
  L.push('- nit: ' + (s.nit || 0));
  L.push('- advisory: ' + (s.advisory || 0));
  L.push('- total: ' + (s.total || 0));
  L.push('');
  L.push('## Hallazgos');
  if (!r.findings || !r.findings.length) L.push('(sin hallazgos)');
  else {
    L.push('| id | persona | severidad | scope | detalle | advisory |');
    L.push('| --- | --- | --- | --- | --- | --- |');
    // Mismo orden que el resultado: primero lo que bloquea.
    for (const f of orderBySeverity(r.findings)) {
      L.push('| ' + f.id + ' | ' + f.persona + ' | ' + f.severity + ' | ' + escapeCell(f.scope) + ' | ' + escapeCell(f.detail) + ' | ' + (f.advisory ? 'si' : 'no') + ' |');
    }
  }
  L.push('');
  L.push('## Revisores');
  L.push('| persona | estado |');
  L.push('| --- | --- |');
  for (const rv of r.reviewers || []) {
    const nota = rv.motivo ? ' (' + escapeCell(rv.motivo) + ')' : '';
    L.push('| ' + rv.persona + ' | ' + rv.status + nota + ' |');
  }
  if (r.baseDiff) {
    L.push('');
    L.push('## Comparacion con base');
    L.push('Base: ' + r.baseDiff.ref);
    if (!r.baseDiff.ok) {
      L.push('No comparable: ' + r.baseDiff.message);
    } else {
      L.push(r.baseDiff.message);
      for (const f of r.baseDiff.files || []) {
        L.push('- ' + f.file + ' (+' + (f.added === null ? 'bin' : f.added) + ' / -' + (f.deleted === null ? 'bin' : f.deleted) + ')');
      }
      if (r.baseDiff.target) {
        L.push('Objetivo: ' + r.baseDiff.target.file + ' ' + (r.baseDiff.target.changed ? 'cambio respecto de la base.' : 'sin cambios respecto de la base.'));
      }
    }
  }
  L.push('');
  L.push('## Motivo');
  L.push(r.reason || 'Sin motivo registrado.');
  return L.join('\n');
}

// ---------- pulso automatico (heartbeat de ContextBase) ----------
// El motor deja de ser una herramienta que alguien llama a mano: ContextBase lo pulsa
// en cada latido, revisa el documento vivo del proyecto y deja el veredicto en disco.

const EGM_VERDICTOS = ['PASS', 'REFIX', 'RERUN', 'FAIL'];

function egmPaqueteVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    if (pkg && typeof pkg.version === 'string' && pkg.version) return pkg.version;
  } catch { /* sin package.json legible: la version queda como 'egm' */ }
  return 'egm';
}

function egmPulseTarget(root, explicit) {
  if (explicit) return path.resolve(root, String(explicit));
  // El modelo revisa DOCUMENTOS DE DISENO y vigentes: excluye archivos historicos
  // (superpowers/archive/legacy) salvo seleccion explicita, normaliza mtime futuros y
  // prioriza el nivel superior de docs/ antes de caer a fundamentos.md / README.md.
  const docsDir = path.join(root, 'docs');
  const now = Date.now();
  try {
    const docs = [];
    for (const full of walk(docsDir, { ignoreDirs: ARCHIVED_DOC_DIRS })) {
      if (!/\.md$/i.test(path.basename(full))) continue;
      try {
        const rawMtime = fs.statSync(full).mtimeMs;
        docs.push({
          file: full,
          topLevel: path.dirname(full) === docsDir,
          mtime: Math.min(rawMtime, now),
        });
      } catch { /* ilegible */ }
    }
    if (docs.length > 0) {
      docs.sort((a, b) =>
        (b.mtime - a.mtime) ||
        ((b.topLevel ? 1 : 0) - (a.topLevel ? 1 : 0)) ||
        (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)
      );
      return docs[0].file;
    }
  } catch { /* sin docs/: se cae a los candidatos base */ }
  const candidatos = [
    path.join(root, 'contextbase', 'fundamentos.md'),
    path.join(root, 'README.md'),
  ];
  for (const file of candidatos) {
    try {
      if (fs.statSync(file).isFile()) return file;
    } catch { /* candidato ausente: se prueba el siguiente */ }
  }
  return null;
}

function egmPulseCounts(findings) {
  const counts = {};
  for (const severidad of EGM_SEVERIDAD_ORDEN) counts[severidad] = 0;
  for (const f of findings || []) {
    // Mismo criterio que el veredicto: un advisory se reporta en el informe, no se cuenta.
    if (!f || f.advisory || !EGM_SEVERIDADES[f.severity]) continue;
    counts[f.severity]++;
  }
  return counts;
}

/**
 * Una pasada acotada del modelo EGM sobre el documento vivo del proyecto.
 * Nunca lanza: si no hay documento, si el objetivo no se puede leer o si algo falla,
 * devuelve ok:false con el motivo. Persiste el veredicto en contextbase/egm/verdict.json.
 */
export function egmPulse(projectDir, options = {}) {
  const started = Date.now();
  const opts = options && typeof options === 'object' ? options : {};
  const payload = {
    ok: false,
    verdict: null,
    target: null,
    blockers: 0,
    majors: 0,
    nits: 0,
    drift: 0,
    at: new Date().toISOString(),
    reason: null,
    durationMs: 0,
  };

  const cerrar = extra => Object.assign({}, payload, extra, { durationMs: Date.now() - started });

  try {
    const root = path.resolve(projectDir || process.cwd());
    const file = egmPulseTarget(root, opts.target);
    if (!file) {
      return cerrar({ ok: false, reason: 'sin-documentacion' });
    }
    const rel = path.relative(root, file).replace(/\\/g, '/');

    const rondas = Math.max(1, Math.floor(Number(opts.maxRounds)) || 1);
    const review = egmReview({ cwd: root, target: rel, maxRounds: rondas });
    if (!review || review.reviewComplete === false) {
      // El objetivo existe pero no se pudo leer: la pasada no ocurrio, no hay veredicto.
      return cerrar({ ok: false, target: rel, reason: 'error' });
    }

    const counts = egmPulseCounts(review.findings);
    const verdict = EGM_VERDICTOS.includes(review.verdict) ? review.verdict : 'FAIL';

    // Deriva doc-codigo: solo se cuenta si el escaneo ocurrio de verdad.
    // Un directorio de docs ausente NO es "sin deriva": queda marcado como no escaneado.
    const docsDir = opts.docsDir ? String(opts.docsDir) : 'docs';
    const docsPath = path.resolve(root, docsDir);
    let drift = 0;
    let driftMissingDocs = true;
    if (fs.existsSync(docsPath)) {
      const scan = egmDrift({ cwd: root, docsDir });
      drift = Array.isArray(scan && scan.drift) ? scan.drift.length : 0;
      driftMissingDocs = Boolean(scan && scan.missingDocs);
    }

    const resultado = cerrar({
      ok: true,
      verdict,
      target: rel,
      blockers: counts.blocker,
      majors: counts.major,
      nits: counts.nit,
      drift,
    });

    try {
      writeAtomic(
        path.join(root, 'contextbase', 'egm', 'verdict.json'),
        JSON.stringify(Object.assign({}, resultado, {
          tool: 'egm',
          version: egmPaqueteVersion(),
          driftMissingDocs,
        }), null, 2) + '\n',
      );
    } catch {
      // El pulso se calculo pero no se pudo registrar: se reporta como fallo, sin lanzar.
      return Object.assign({}, resultado, { ok: false, reason: 'error' });
    }

    return resultado;
  } catch {
    return cerrar({ ok: false, reason: 'error' });
  }
}

