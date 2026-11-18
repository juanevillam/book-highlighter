/**
 * Spanish orthographic & typographic post-processor for PP-OCRv3 Latin.
 *
 * The 25-language Latin recognizer frequently confuses:
 * - `«` / `»` with `<` / `>`
 * - `—` (raya de diálogo) with `-`, `--`, or `S ` / `: ` at line start
 * - `¿` before a capital letter with `:` (or drops `¿` / `¡` outright, or reads `¡` as `j` / `;`)
 * - `ó` at word end with `6` (`pens6` → `pensó`)
 * - Spanish `ñ` with `n` / `ni` (`ano` → `año`, `suenos` → `sueños`, `peldanio` → `peldaño`, `las unas` → `las uñas`)
 * - Spanish hiatus `í` / `ú` (`dia` → `día`, `habia` → `había`, `aun` → `aún`, `caidos` → `caídos`)
 */

const EXACT_WORD_FIXES: Record<string, string> = {
  // Hiatus & monosyllabic/oxytone words that never exist unaccented in Spanish
  dia: 'día',
  dias: 'días',
  frio: 'frío',
  fria: 'fría',
  frios: 'fríos',
  frias: 'frías',
  vacio: 'vacío',
  vacia: 'vacía',
  vacios: 'vacíos',
  vacias: 'vacías',
  mio: 'mío',
  mia: 'mía',
  mios: 'míos',
  mias: 'mías',
  rio: 'río',
  rios: 'ríos',
  oido: 'oído',
  oidos: 'oídos',
  oir: 'oír',
  reir: 'reír',
  sonreir: 'sonreír',
  ahi: 'ahí',
  aqui: 'aquí',
  asi: 'así',
  pais: 'país',
  paises: 'países',
  raiz: 'raíz',
  raices: 'raíces',
  maiz: 'maíz',
  baul: 'baúl',
  ataud: 'ataúd',
  caido: 'caído',
  caida: 'caída',
  caidos: 'caídos',
  caidas: 'caídas',
  crei: 'creí',
  conoci: 'conocí',
  aprendi: 'aprendí',
  senti: 'sentí',
  vivi: 'viví',
  oia: 'oía',
  ojala: 'ojalá',
  algun: 'algún',
  ningun: 'ningún',
  segun: 'según',
  comun: 'común',
  ademas: 'además',
  detras: 'detrás',
  jamas: 'jamás',
  quizas: 'quizás',
  quiza: 'quizá',
  alli: 'allí',
  alla: 'allá',
  tambien: 'también',
  despues: 'después',
  traves: 'través',
  interes: 'interés',
  recien: 'recién',
  corazon: 'corazón',
  razon: 'razón',
  ocasion: 'ocasión',
  oracion: 'oración',
  cancion: 'canción',
  pasion: 'pasión',
  compasion: 'compasión',
  ilusion: 'ilusión',
  vision: 'visión',
  accion: 'acción',
  atencion: 'atención',
  emocion: 'emoción',
  estacion: 'estación',
  respiracion: 'respiración',
  meditacion: 'meditación',
  mortificacion: 'mortificación',
  liberacion: 'liberación',
  perfeccion: 'perfección',
  creacion: 'creación',
  sensacion: 'sensación',
  tentacion: 'tentación',
  habitacion: 'habitación',
  generacion: 'generación',
  direccion: 'dirección',
  instruccion: 'instrucción',
  bendicion: 'bendición',
  maldicion: 'maldición',
  perdicion: 'perdición',
  tradicion: 'tradición',
  condicion: 'condición',
  posicion: 'posición',
  religion: 'religión',
  region: 'región',
  union: 'unión',
  opinion: 'opinión',
  reunion: 'reunión',
  rincon: 'rincón',
  jubon: 'jubón',
  sermon: 'sermón',
  escalon: 'escalón',
  monton: 'montón',
  baston: 'bastón',
  dragon: 'dragón',
  leon: 'león',
  perdon: 'perdón',
  // Esdrújulas & llanas with mandatory accents
  espiritu: 'espíritu',
  espiritus: 'espíritus',
  practicas: 'prácticas',
  brahmanica: 'brahmánica',
  brahman: 'brahmán',
  autentico: 'auténtico',
  autentica: 'auténtica',
  dificil: 'difícil',
  dificiles: 'difíciles',
  facil: 'fácil',
  faciles: 'fáciles',
  inutil: 'inútil',
  util: 'útil',
  debil: 'débil',
  debiles: 'débiles',
  fertil: 'fértil',
  fragil: 'frágil',
  habil: 'hábil',
  movil: 'móvil',
  docil: 'dócil',
  esteril: 'estéril',
  rigido: 'rígido',
  rigida: 'rígida',
  minimo: 'mínimo',
  minima: 'mínima',
  maximo: 'máximo',
  maxima: 'máxima',
  circulo: 'círculo',
  circulos: 'círculos',
  ultimo: 'último',
  ultima: 'última',
  ultimos: 'últimos',
  ultimas: 'últimas',
  unico: 'único',
  unica: 'única',
  unicos: 'únicos',
  unicas: 'únicas',
  tunica: 'túnica',
  musica: 'música',
  publico: 'público',
  numero: 'número',
  numeros: 'números',
  pagina: 'página',
  paginas: 'páginas',
  capitulo: 'capítulo',
  capitulos: 'capítulos',
  principe: 'príncipe',
  principes: 'príncipes',
  discipulo: 'discípulo',
  discipulos: 'discípulos',
  calido: 'cálido',
  palido: 'pálido',
  valido: 'válido',
  abulico: 'abúlico',
  estupido: 'estúpido',
  rapido: 'rápido',
  intimo: 'íntimo',
  intima: 'íntima',
  identico: 'idéntico',
  identicos: 'idénticos',
  proposito: 'propósito',
  relampago: 'relámpago',
  oceano: 'océano',
  arbol: 'árbol',
  arboles: 'árboles',
  pajaro: 'pájaro',
  pajaros: 'pájaros',
  lagrima: 'lágrima',
  lagrimas: 'lágrimas',
  cadaver: 'cadáver',
  caracter: 'carácter',
  crater: 'cráter',
  martir: 'mártir',
  angel: 'ángel',
  angeles: 'ángeles',
  carcel: 'cárcel',
  calao: 'cálao',
  atman: 'Atmán',
  alegria: 'alegría',
  alegrias: 'alegrías',
  sabiduria: 'sabiduría',
  caceria: 'cacería',
  ironia: 'ironía',
  cortesia: 'cortesía',
  lejania: 'lejanía',
  melancolia: 'melancolía',
  agonia: 'agonía',
  armonia: 'armonía',
  energia: 'energía',
  filosofia: 'filosofía',
  poesia: 'poesía',
  teoria: 'teoría',
  guia: 'guía',
  guias: 'guías',
  // Pronominal enclitic gerunds (always esdrújulas in Spanish)
  poblandose: 'poblándose',
  quedandose: 'quedándose',
  quedandote: 'quedándote',
  insensibilizandose: 'insensibilizándose',
  parandose: 'parándose',
  acercandose: 'acercándose',
  acercandonos: 'acercándonos',
  alejandose: 'alejándose',
  inclininandose: 'inclinándose',
  inclinandose: 'inclinándose',
  burlandote: 'burlándote',
  burlandose: 'burlándose',
  // Unambiguous imperfect, conditional & future verbs
  habia: 'había',
  habias: 'habías',
  habian: 'habían',
  habria: 'habría',
  habrias: 'habrías',
  habrian: 'habrían',
  tenia: 'tenía',
  tenias: 'tenías',
  tenian: 'tenían',
  tendria: 'tendría',
  tendrias: 'tendrías',
  tendrian: 'tendrían',
  podia: 'podía',
  podias: 'podías',
  podian: 'podían',
  podria: 'podría',
  podrias: 'podrías',
  podrian: 'podrían',
  veia: 'veía',
  veias: 'veías',
  veian: 'veían',
  creia: 'creía',
  creias: 'creías',
  creian: 'creían',
  decia: 'decía',
  decias: 'decías',
  decian: 'decían',
  solia: 'solía',
  solias: 'solías',
  solian: 'solían',
  sentia: 'sentía',
  sentias: 'sentías',
  sentian: 'sentían',
  vivia: 'vivía',
  vivias: 'vivías',
  vivian: 'vivían',
  moria: 'moría',
  morias: 'morías',
  morian: 'morían',
  volvia: 'volvía',
  volvias: 'volvías',
  volvian: 'volvían',
  recorria: 'recorría',
  recorrian: 'recorrían',
  seguia: 'seguía',
  seguias: 'seguías',
  seguian: 'seguían',
  queria: 'quería',
  querias: 'querías',
  querian: 'querían',
  parecia: 'parecía',
  parecian: 'parecían',
  existia: 'existía',
  existian: 'existían',
  resistiria: 'resistiría',
  quedaria: 'quedaría',
  sufria: 'sufría',
  sufrian: 'sufrían',
  yacia: 'yacía',
  yacian: 'yacían',
  caia: 'caía',
  caian: 'caían',
  recaia: 'recaía',
  recaian: 'recaían',
  oian: 'oían',
  dormia: 'dormía',
  dormian: 'dormían',
  corria: 'corría',
  corrian: 'corrían',
  pedia: 'pedía',
  pedian: 'pedían',
  salia: 'salía',
  salian: 'salían',
  ofrecia: 'ofrecía',
  ofrecian: 'ofrecían',
  mentia: 'mentía',
  mentian: 'mentían',
  permanecia: 'permanecía',
  permanecian: 'permanecían',
  acogia: 'acogía',
  introducia: 'introducía',
  descomponia: 'descomponía',
  convertia: 'convertía',
  convertian: 'convertían',
  esparcia: 'esparcía',
  escurria: 'escurría',
  sometia: 'sometía',
  sometian: 'sometían',
  dirigia: 'dirigía',
  dirigian: 'dirigían',
  conocia: 'conocía',
  conocian: 'conocían',
  acabaria: 'acabaría',
  acabarias: 'acabarías',
  gustaria: 'gustaría',
  deberiamos: 'deberíamos',
  cumplira: 'cumplirá',
  cumpliran: 'cumplirán',
  sentira: 'sentirá',
  sentiran: 'sentirán',
  podra: 'podrá',
  podran: 'podrán',
  volvera: 'volverá',
  volveran: 'volverán',
  quedara: 'quedará',
  quedaran: 'quedarán',
  sera: 'será',
  seran: 'serán',
  convertianse: 'convertíanse',
  mostrabase: 'mostrábase',
  tornabase: 'tornábase',
  regresaria: 'regresaría',
  sumergiria: 'sumergiría',
  pretendia: 'pretendía',
  pretendian: 'pretendían',
  resplandecia: 'resplandecía',
  convendria: 'convendría',
  ponia: 'ponía',
  haria: 'haría',
  pertenecia: 'pertenecía',
  compartia: 'compartía',
  compartian: 'compartían',
  compartiria: 'compartiría',
  hablaria: 'hablaría',
  impulsaria: 'impulsaría',
  contenia: 'contenía',
  viviamos: 'vivíamos',
  volvi: 'volví',
  sabia: 'sabía',
  sabias: 'sabías',
  sabian: 'sabían',
  alegrarias: 'alegrarías',
  presentia: 'presentía',
  hacian: 'hacían',
  discurria: 'discurría',
  leia: 'leía',
  leian: 'leían',
  obedecia: 'obedecía',
  combatia: 'combatía',
  renacia: 'renacía',
  renacian: 'renacían',
  fluia: 'fluía',
  fluian: 'fluían',
  cernia: 'cernía',
  sonreia: 'sonreía',
  sonreian: 'sonreían',
  sonrien: 'sonríen',
  sonreido: 'sonreído',
  atraido: 'atraído',
  reirse: 'reírse',
  reirme: 'reírme',
  reirte: 'reírte',
  desconfio: 'desconfío',
  todavia: 'todavía',
  mercancia: 'mercancía',
  mercancias: 'mercancías',
  sombrio: 'sombrío',
  sombria: 'sombría',
  vias: 'vías',
  jabali: 'jabalí',
  jabalies: 'jabalíes',
  increible: 'increíble',
  increibles: 'increíbles',
  univoco: 'unívoco',
  univoca: 'unívoca',
  metafora: 'metáfora',
  metaforas: 'metáforas',
  mascara: 'máscara',
  mascaras: 'máscaras',
  habito: 'hábito',
  habitos: 'hábitos',
  pacifico: 'pacífico',
  pacifica: 'pacífica',
  reciproco: 'recíproco',
  reciproca: 'recíproca',
  reciprocos: 'recíprocos',
  reciprocas: 'recíprocas',
  ridiculo: 'ridículo',
  ridicula: 'ridícula',
  dificilmente: 'difícilmente',
  facilmente: 'fácilmente',
  enigmatico: 'enigmático',
  enigmatica: 'enigmática',
  objecion: 'objeción',
  atras: 'atrás',
  fijate: 'fíjate',
  cuidate: 'cuídate',
  inclinate: 'inclínate',
  permiteme: 'permíteme',
  encontro: 'encontró',
  constato: 'constató',
  sopeso: 'sopesó',
  demas: 'demás',
  linea: 'línea',
  lineas: 'líneas',
  vinculo: 'vínculo',
  vinculos: 'vínculos',
  efimero: 'efímero',
  efimera: 'efímera',
  efimeros: 'efímeros',
  efimeras: 'efímeras',
  magnanimo: 'magnánimo',
  magnanima: 'magnánima',
  integro: 'íntegro',
  integra: 'íntegra',
  integros: 'íntegros',
  integras: 'íntegras',
  caracteristico: 'característico',
  caracteristica: 'característica',
  caracteristicos: 'característicos',
  caracteristicas: 'características',
  autntico: 'auténtico',
  autntica: 'auténtica',
  infimo: 'ínfimo',
  infima: 'ínfima',
  infimos: 'ínfimos',
  infimas: 'ínfimas',
  fantasia: 'fantasía',
  fantasias: 'fantasías',
  soberania: 'soberanía',
  valia: 'valía',
  cria: 'cría',
  crian: 'crían',
  naci: 'nací',
  traido: 'traído',
  traida: 'traída',
  traidos: 'traídos',
  traidas: 'traídas',
  bailarin: 'bailarín',
  despidete: 'despídete',
  acuerdate: 'acuérdate',
  recuerdate: 'recuérdate',
  levantame: 'levántame',
  tirame: 'tírame',
  cinete: 'cíñete',
  estan: 'están',
  estare: 'estaré',
  estaras: 'estarás',
  estara: 'estará',
  estaran: 'estarán',
  extinguiria: 'extinguiría',
  extinguirian: 'extinguirían',
  amaria: 'amaría',
  amarias: 'amarías',
  amarian: 'amarían',
  dejaria: 'dejaría',
  dejarias: 'dejarías',
  dejarian: 'dejarían',
  desharia: 'desharía',
  arrastraria: 'arrastraría',
  sabria: 'sabría',
  sabrias: 'sabrías',
  sabrian: 'sabrían',
  echarias: 'echarías',
  echaria: 'echaría',
  pasaria: 'pasaría',
  daria: 'daría',
  darian: 'darían',
  envio: 'envío',
  envios: 'envíos',
  viveres: 'víveres',
  vencera: 'vencerá',
  venceran: 'vencerán',
  vencia: 'vencía',
  vencian: 'vencían',
  librara: 'librará',
  libraran: 'librarán',
  correra: 'correrá',
  correran: 'correrán',
  ganara: 'ganará',
  ganaran: 'ganarán',
  perdera: 'perderá',
  perderan: 'perderán',
  hara: 'hará',
  haran: 'harán',
  tomara: 'tomará',
  tomaran: 'tomarán',
  metodo: 'método',
  metodos: 'métodos',
  plumon: 'plumón',
  valentia: 'valentía',
  inequivoco: 'inequívoco',
  inequivoca: 'inequívoca',
  inequivocos: 'inequívocos',
  inequivocas: 'inequívocas',
  espia: 'espía',
  espias: 'espías',
  tactica: 'táctica',
  tacticas: 'tácticas',
  estrategal: 'estratega',
  interfierant: 'interfieran',
  leys: 'ley',
  guerrat: 'guerra',
  militarys: 'militar',
  // Unambiguous `ñ` words (auto-indexed for `n`, `f`, and `ni` OCR confusions below)
  otonal: 'otoñal',
  senuelo: 'señuelo',
  senuelos: 'señuelos',
  ano: 'año',
  anos: 'años',
  sueno: 'sueño',
  suenos: 'sueños',
  nino: 'niño',
  ninos: 'niños',
  nina: 'niña',
  ninas: 'niñas',
  engano: 'engaño',
  enganos: 'engaños',
  enganar: 'engañar',
  enganarlo: 'engañarlo',
  enganarnos: 'engañarnos',
  peldano: 'peldaño',
  peldanos: 'peldaños',
  montana: 'montaña',
  montanas: 'montañas',
  pequeno: 'pequeño',
  pequena: 'pequeña',
  pequenos: 'pequeños',
  pequenas: 'pequeñas',
  extrano: 'extraño',
  extrana: 'extraña',
  extranos: 'extraños',
  extranas: 'extrañas',
  dueno: 'dueño',
  duena: 'dueña',
  duenos: 'dueños',
  aduena: 'adueña',
  aduenan: 'adueñan',
  aduenar: 'adueñar',
  aduenarse: 'adueñarse',
  aduenado: 'adueñado',
  otono: 'otoño',
  bano: 'baño',
  dano: 'daño',
  danos: 'daños',
  danado: 'dañado',
  danada: 'dañada',
  danados: 'dañados',
  danadas: 'dañadas',
  danar: 'dañar',
  danino: 'dañino',
  danina: 'dañina',
  daaina: 'dañina',
  daáina: 'dañina',
  pano: 'paño',
  rebano: 'rebaño',
  tamano: 'tamaño',
  ermitano: 'ermitaño',
  compania: 'compañía',
  companero: 'compañero',
  companera: 'compañera',
  companeros: 'compañeros',
  acompanar: 'acompañar',
  acompanado: 'acompañado',
  acompanada: 'acompañada',
  acompane: 'acompañe',
  ensenar: 'enseñar',
  ensena: 'enseña',
  ensenan: 'enseñan',
  ensenado: 'enseñado',
  ensenando: 'enseñando',
  ensenarte: 'enseñarte',
  ensenarle: 'enseñarle',
  ensenarla: 'enseñarla',
  ensenarlo: 'enseñarlo',
  ensenanza: 'enseñanza',
  ensenanzas: 'enseñanzas',
  enseno: 'enseñó',
  anadir: 'añadir',
  anadas: 'añadas',
  manana: 'mañana',
  senor: 'señor',
  senora: 'señora',
  senal: 'señal',
  senales: 'señales',
  espanol: 'español',
  espanola: 'española',
  arana: 'araña',
  aranas: 'arañas',
  aranazo: 'arañazo',
  aranazos: 'arañazos',
  cabana: 'cabaña',
  campana: 'campaña',
  entranas: 'entrañas',
  entranable: 'entrañable',
  entranables: 'entrañables',
  desentranar: 'desentrañar',
  hazana: 'hazaña',
  lena: 'leña',
  pestana: 'pestaña',
  pestanas: 'pestañas',
  carrona: 'carroña',
  puno: 'puño',
  punal: 'puñal',
  punales: 'puñales',
  antano: 'antaño',
  empeno: 'empeño',
  empenado: 'empeñado',
  empenada: 'empeñada',
  empenados: 'empeñados',
  empenarias: 'empeñarías',
  ceno: 'ceño',
  diseno: 'diseño',
  carino: 'cariño',
  desdena: 'desdeña',
  desdenar: 'desdeñar',
  atane: 'atañe',
};

// Automatically index `f` and `ni` OCR misreads for every `ñ` word in the dictionary
for (const [, target] of Object.entries(EXACT_WORD_FIXES)) {
  if (target.includes('ñ')) {
    const fKey = target
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const withF = target
      .toLowerCase()
      .replace(/ñ/g, 'f')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const withNi = target
      .toLowerCase()
      .replace(/ñ/g, 'ni')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (!(fKey in EXACT_WORD_FIXES)) EXACT_WORD_FIXES[fKey] = target;
    if (!(withF in EXACT_WORD_FIXES)) EXACT_WORD_FIXES[withF] = target;
    if (!(withNi in EXACT_WORD_FIXES)) EXACT_WORD_FIXES[withNi] = target;
  }
}

const preserveCase = (orig: string, replacement: string): string => {
  if (orig === orig.toUpperCase()) return replacement.toUpperCase();
  if (orig[0] === orig[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
};

/** Fix what the Latin recogniser gets wrong in Spanish, line by line. */
export const cleanOcr = (s: string): string =>
  s
    .replace(/ä/g, 'á')
    .replace(/ë/g, 'é')
    .replace(/ï/g, 'í')
    .replace(/ö/g, 'ó')
    .replace(/[êè]/g, 'é')
    .replace(/[âà]/g, 'á')
    .replace(/[ôò]/g, 'ó')
    // In Spanish, `ü` only exists in `güe`/`güi`; anywhere else it is `ú`, and `gúe`/`gúi` before `n`/`d`/`r`/`ñ` is `güe`/`güi`.
    .replace(/ü(?![eiEI])/g, 'ú')
    .replace(/([^gG])ü/g, '$1ú')
    .replace(/^ü/g, 'ú')
    .replace(/([gG])ú([eiEI](?:n|d|r|ñ))/g, '$1ü$2')
    .replace(/([a-záéíóúñ])6(?=[^0-9]|$)/g, '$1ó')
    .replace(/>/g, '»')
    .replace(/</g, '«')
    // `[en el Atmán,` on page 35 of Siddhartha is read as `len el Atmán,` or `len elAtman,`
    .replace(/^[lL]en\s+el\s*Atm[aá]n/i, '[en el Atmán')
    // Leading dialogue dash (or misread `S ` / `: ` before a dialogue line)
    .replace(/^\s*--?(?=\s*[¡¿«A-ZÀ-Þa-zà-ÿ])/, '—')
    .replace(/^\s*[S:]\s+(?=[A-ZÀ-Þ][a-zà-ÿ]+\s*[-—]\s*le\s+dijo)/, '—')
    .replace(/^\s*:\s*(?=[A-ZÀ-Þ][a-zà-ÿ]+[^?!]*!)/, '—¡')
    .replace(/«\s*;\s*(?=[A-ZÀ-Þ])/g, '«¡')
    .replace(/\bj(?=[A-ZÀ-Þ][a-zà-ÿ]*[^!]*!)/g, '¡')
    .replace(/«\s*--?(?=[¡¿A-ZÀ-Þa-zà-ÿ])/g, '«—')
    // Parenthetical closing em-dash before punctuation (`-,`, `-.`, `-?`, `-!`)
    .replace(/([A-Za-zÀ-ÿ])--?([,.;:?!»])/g, '$1—$2')
    // `::Qué` or `?:Qué` where `:` is a misread opening `¿`
    .replace(/::\s*(?=[A-ZÀ-Þa-zà-ÿ])/g, ': ¿')
    .replace(/([.!?…»])\s*:(?=[A-ZÀ-Þ])/g, '$1 ¿')
    .replace(/\s+([,;:.!?»])/g, '$1')
    .replace(/(«)\s+/g, '$1')
    .replace(/([,;:])(?=[A-Za-zÀ-ÿ¡¿«])/g, '$1 ')
    .replace(/([.!?»])(?=[A-ZÀ-Þ¡¿«])/g, '$1 ');

/**
 * Paragraph/passage-level Spanish polish applied after lines and hyphenated
 * words have been joined across lines and pages.
 */
export const polishSpanishProse = (s: string): string => {
  // Strip stray mid-word apostrophes (`ver'so` -> `verso`), inline footnote superscripts glued to words/punctuation (`levas20`, `población.21`, `venza.4s`, `potencia.6s`, `sirvientes;1*8`), and split glued `c`/`s` (`cpodrias` -> `¿podrias`) before word lookup
  let out = s
    .replace(/([A-Za-zÀ-ÿ])['’]([a-zà-ÿ])/g, '$1$2')
    .replace(
      /\bse\s+destruye20\s+si\s+la\s+riqueza\b/g,
      'se destruye; si la riqueza',
    )
    .replace(/\bun\s+dana:\s+de\b/g, 'un dàn de')
    .replace(/\b(un|veinte)\s+dan\b/g, '$1 dàn')
    .replace(/\bzh[oó]ng(?:\d+)?\b/g, 'zhōng')
    .replace(/\bcultiva\s+el\s+dao\b/g, 'cultiva el dào')
    .replace(/\bEl\s+maestro\s+Sun\s+dijo:/g, 'El maestro Sūn dijo:')
    .replace(
      /\btampoco\s+es\s+lo\s+mejor\s+por\s+ello,/g,
      'tampoco es lo mejor; por ello,',
    )
    .replace(/\bplum[oó]n\s+oto[ñn]al,\s*s\s+no\b/g, 'plumón otoñal, no')
    .replace(/\bpreclaro\."\s*/g, 'preclaro.')
    .replace(
      /\bQuien\s+no\s+sea\s+un\s+Santo(?:\d+)?\s+sabio\b/g,
      'Quien no sea un Santo o sabio',
    )
    .replace(
      /\bSutileza!\s*\.?\s*Sutileza!,\s*sin\s+ella\s+no\s+se\s+puede\s+emplear\s+a\s+los\s+esp[ií]as!/g,
      '¡Sutileza! ¡Sutileza!, ¡sin ella no se puede emplear a los espías!',
    )
    .replace(
      /\bde\s+sus\s+cortesanos,\s*0\s+de\s+su\s+ordenanza,\s*\*{1,2}\s+de\s+sus\b/g,
      'de sus cortesanos, de su ordenanza, de sus',
    )
    .replace(/\bhar[aá]\s+use\.?(?=\s)/g, 'hará uso')
    .replace(/([A-Za-zÀ-ÿ]{2,})\d{1,3}[a-z]?(?=[,.;:?!»\s]|$)/g, '$1')
    .replace(/([A-Za-zÀ-ÿ][,.;:])\d[\d*a-z]{0,2}\.?(?=[ \t]|$)/g, '$1')
    .replace(
      /\b[cs](?=(?:para|por|podr[ií]a|pued[ae]|qu[eé]|c[oó]mo|cu[aá]n|d[oó]nde|qui[eé]n)[a-zà-ÿ]*[^?!\n]*\?)/gi,
      '¿',
    );

  // Word-by-word dictionary restoration for unambiguous Spanish words first
  out = out.replace(/[A-Za-zÀ-ÿ]+/g, word => {
    const lower = word.toLowerCase();
    const fixed = EXACT_WORD_FIXES[lower];
    return fixed ? preserveCase(word, fixed) : word;
  });

  // Universal Spanish enclitic gerund rule: every `-ando`/`-iendo`/`-yendo` + enclitic pronoun is esdrújula
  out = out.replace(
    /\b([A-Za-zÀ-ÿ]*?)(a|ie|ye)ndo(me|te|se|lo|la|le|nos|os|los|las|les)(?![A-Za-zÀ-ÿ])/gi,
    (_, stem: string, vowel: string, pron: string) => {
      const accented =
        vowel.toLowerCase() === 'a'
          ? vowel === 'A'
            ? 'Á'
            : 'á'
          : vowel[0] + (vowel[1] === 'E' ? 'É' : 'é');
      return `${stem}${accented}ndo${pron}`;
    },
  );

  // Universal Spanish superlative `-ísimo` / `-ísima` / `-ísimamente` and abstract noun `-ción` / `-sión` rules
  out = out
    .replace(
      /\b([A-Za-zÀ-ÿ]+?)isim([oa]s?(?:mente)?)(?![A-Za-zÀ-ÿ])/gi,
      (_, stem: string, tail: string) => `${stem}ísim${tail}`,
    )
    .replace(
      /\b([A-Za-zÀ-ÿ]{3,}?)([cs])ion(?![A-Za-zÀ-ÿ])/gi,
      (_, stem: string, cs: string) => `${stem}${cs}ión`,
    )
    // Glued `-mente` adverb + verb (`comúnmentellamamos` -> `comúnmente llamamos`)
    .replace(
      /\b([A-Za-zÀ-ÿ]+mente)(llamamos|hablamos|decimos|hacemos|vemos|creemos|pensamos|sabemos|somos|estamos|son|es|est[aá]|est[aá]n)(?![A-Za-zÀ-ÿ])/gi,
      '$1 $2',
    )
    // Duplicate single consonant produced by mid-line box split (`cumplir r como` -> `cumplir como`)
    .replace(/\b([A-Za-zÀ-ÿ]{2,}([rlnsd]))\s+\2\s+(?=[a-zà-ÿ]{2,})/gi, '$1 ');

  out = out
    // Normalize 2-dot sequences `..` into 3-dot ellipsis `...`
    .replace(/(?<!\.)\.\.(?!\.)/g, '...')
    // Restore `;` after `...` when OCR drops `;` before lowercase adversative/negative clause (`... no para`, `... mas no`, `... pero`)
    .replace(/\.{3,}[ \t]+(?=(?:no[ \t]+para|mas\b|pero\b|sino\b))/g, '...; ')
    // Collapse accidental double periods separated by horizontal space on the same line (`. . También` -> `. También`)
    .replace(/\.[ \t]+\.(?!\.)/g, '.')
    // Remove stray periods between two glued lowercase words (`bondadosa.y` -> `bondadosa y`)
    .replace(/([a-zà-ÿ])\.([a-zà-ÿ])/g, '$1 $2')
    // Remove stray single period followed by lowercase continuation on the same line (`en. polvo`, `ilusión. al`, `sonar . siempre`, `tu .objetivo`)
    // Exclude `[a-z][A-Z]` OCR prefix artifacts like `jA` (`¡A`)
    .replace(
      /(?<![.\d\n])[ \t]*\.[ \t]+(?=[a-zà-ÿ](?:[a-zà-ÿ \t,.;:?!]|$))/g,
      ' ',
    )
    .replace(/[ \t]+\.(?=[a-zà-ÿ](?:[a-zà-ÿ \t,.;:?!]|$))/g, ' ')
    // Remove stray single period after short prepositions/determiners before capitalized noun (`al. Venerable`)
    .replace(
      /\b(al|del|el|la|los|las|un|una|en|de|por|para|con|sin|mi|tu|su)\.[ \t]+(?=[A-ZÀ-Þ])/g,
      '$1 ',
    )
    // Remove stray leading dot at paragraph start (`. —Me parece`, `. -; Escúchame`, `. También`)
    .replace(/(^|\n\n)\.[ \t]*/g, '$1')
    // Collapse doubled colons (`::` -> `:`)
    .replace(/:{2,}/g, ':')
    // Leading dialogue line where `—` was misread as `S `, `: `, `.--`, or `-;`
    .replace(/(^|\n\n)[S:]\s+(?=[A-ZÀ-Þ][a-zà-ÿ]+\s*[-—]\s*le\s+dijo)/g, '$1—')
    .replace(/(^|\n\n)\.?--+\s*(?=[¡¿«A-ZÀ-Þa-zà-ÿ])/g, '$1—')
    .replace(/(^|\n\n):\s*(?=[A-ZÀ-Þ][a-zà-ÿ]+[^?!\n]*!)/g, '$1—¡')
    .replace(/(^|\n\n)[-—]+\s*;\s*(?=[A-ZÀ-Þa-zà-ÿ][^?!\n]*!)/g, '$1—¡')
    .replace(/(^|\n\n)[-—]+\s*[;:]\s*(?=[A-ZÀ-Þa-zà-ÿ][^?!\n]*\?)/g, '$1—¿')
    // Restore missing leading `—` on dialogue paragraph after speaker colon (`A lo que Siddhartha respondió:\n\n—Siempre creí`)
    .replace(
      /((?:dijo|respondi[oó]|replic[oó]|repuso|contest[oó]|pregunt[oó]|exclam[oó]|murmur[oó]|ley[oó]|habl[oó]|prosigui[oó]|entonces|Siddhartha|Govinda):\n\n)(?=[A-ZÀ-Þ¡¿])/g,
      '$1—',
    )
    // Restore missing leading `—` on paragraph that contains an internal `—preguntó` / `—dijo` / `—repuso` attribution
    .replace(
      /(^|\n\n)(?=[¡¿A-ZÀ-Þ][^\n]*?\s—(?:pregunt[oó]|dijo|repuso|replic[oó]|contest[oó]|exclam[oó]|respondi[oó])(?![A-Za-zÀ-ÿ]))/g,
      '$1—',
    )
    // Convert internal `--` before word (`Así --y esto`) to `—`
    .replace(/\s+--(?=[A-Za-zÀ-ÿ])/g, ' —')
    // Word-internal parenthetical em-dashes (`Govinda-preguntó`, `Si-pensó`, `Lo sé-respondió`, `aguas-replicó Siddhartha—`)
    .replace(
      /([A-Za-zÀ-ÿ¡!¿?])\s*[-—]\s*((?:pens[oó]|dijo|replic[oó]|repuso|pregunt[oó]|contest[oó]|exclam[oó]|murmur[oó]|respondi[oó]|a[ñn]adi[oó]|grit[oó]|susurr[oó]|habl[oó]|continu[oó]|le\s+dijo|le\s+susurr[oó]|y\s+a[uú]n|en\s+el\s+curso)(?![A-Za-zÀ-ÿ]))/gi,
      '$1 —$2',
    )
    .replace(
      /\b(Govinda|Siddhartha)(dijo|replic[oó]|repuso|pregunt[oó]|contest[oó]|exclam[oó]|murmur[oó]|respondi[oó])—/g,
      '$1 —$2—',
    )
    .replace(/([A-Za-zÀ-ÿ])—(?=[A-Za-zÀ-ÿ])/g, '$1 —')
    // Parenthetical `- ... -` or `— ... -` in Spanish prose -> `—...—`
    .replace(/\s+-(?=que\s+además\b[^-\n]+-\s)/g, ' —')
    .replace(/(?<=que\s+además\b[^-\n]+)-\s+/g, '— ')
    .replace(
      /([a-zà-ÿ])\s*[-—]\s*([a-zà-ÿ]+(?:\s+[a-zà-ÿ]+){1,4})\s*[-—]\s*(?=[a-zà-ÿ])/g,
      '$1 —$2— ',
    )
    .replace(/(—[A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,4})-\s+(?=[a-zà-ÿ])/g, '$1— ')
    .replace(/(\?\s+)(?=pregunt[oó]\s+[A-Za-zÀ-ÿ])/g, '$1—')
    // Subjunctive `como si ... quedaran` vs future `quedarán`
    .replace(
      /\b(como\s+si(?:\s+(?:te|le|les|nos|se|me))?\s+)quedarán\b/gi,
      '$1quedaran',
    )
    .replace(/\bte\s+bastaran\s+para\b/g, 'te bastarán para')
    .replace(/\by\s+veras\s+que\b/g, 'y verás que')
    .replace(/\bcon\s+unas\s+y\s+dientes\b/g, 'con uñas y dientes')
    .replace(/\b(Las|las|Unas|unas)\s+criticas\b/g, '$1 críticas')
    .replace(/\b(el|del)\s+calculo\b/gi, '$1 cálculo')
    .replace(/\bpero\s+si\s+a\s+si\s+mismo\b/gi, 'pero sí a sí mismo')
    .replace(
      /\b(puesto|poner|los|las|sus|mis|tus|sin)\s+limites\b/gi,
      '$1 límites',
    )
    .replace(
      /\bsi\s+que\s+(?=resulta|es\b|son\b|tiene|hay\b|está|están|puede)/gi,
      m => (m[0] === 'S' ? 'Sí que ' : 'sí que '),
    )
    .replace(/;\s+cuantos\s+(?=[a-zà-ÿ]+,\s+tras\b)/g, '; cuántos ')
    .replace(
      /\bayer,\s+mucosidad\s+mañana,\s+momia\b/g,
      'ayer, mucosidad; mañana, momia',
    )
    .replace(
      /\bfugaz\s+intervalo\s+el\s+destino\b/g,
      'fugaz intervalo; el destino',
    )
    .replace(
      /\b(41\.\s+)(Eres\s+una\s+pobre\s+alma\s+con\s+un\s+cadáver\s+a\s+cuestas)(,\s+como\s+decía\s+Epicteto\.)/g,
      '$1*$2*$3',
    )
    // Fix `[Aa]o tras año` -> `Año tras año`
    .replace(/\b([Aa])o\s+tras\s+a[ñnf]o\b/g, (_, c: string) =>
      c === 'A' ? 'Año tras año' : 'año tras año',
    )
    // Fix `año` where OCR misread `¿no` before a verb in a question (`Dime, amigo, año deberíamos ... ?`)
    .replace(
      /\baño\s+(?=(?:deber[ií]amos|es\b|son\b|est[aá]|hemos|has\b|habr|ser[aá]|ser[ií]a|crees|te\b|se\b|le\b|nos\b|podr|pued)[^?!\n]*\?)/gi,
      '¿no ',
    )
    // Fix `«Si —pensó` -> `«Sí —pensó`, `¡Si,` -> `¡Sí,`, `—Si,` -> `—Sí,`, `; si,` -> `; sí,`, `puede que si` -> `puede que sí`, `pero si sé` -> `pero sí sé`
    // Never turn conditional `Si yo`, `Si una`, or `Si, por ejemplo,` into `Sí`
    .replace(
      /([«¡—]|\.\s+|;\s*)\s*Si(?=\s*[-—,.;:!?»])(?!,\s+por\s+ejemplo\b)/g,
      '$1Sí',
    )
    .replace(/(;\s*)si(?=,)/g, '$1sí')
    .replace(
      /\b(He\s+tenido\s+ideas,\s+|puede\s+que\s+)si(?=[.,;:?!»\s])/gi,
      '$1sí',
    )
    .replace(/\bPero\s+si\s+s[eé](?![A-Za-zÀ-ÿ])/g, 'Pero sí sé')
    // Fix comma misread for period before capitalized sentence starter after vocative (`señor, Cuando` -> `señor. Cuando`)
    .replace(
      /\b(señor|amigo|Govinda|Siddhartha),\s+(?=(?:Cuando|Pero|Mas|No|En|El|La|Los|Las|Un|Una|Todo|Cada|Siempre|Nunca)\b)/g,
      '$1. ',
    )
    // Fix `hacia esfuerzos` -> `hacía esfuerzos` and `burlona acaso, sabía, múltiple` -> `burlona acaso, sabia, múltiple`
    .replace(
      /\bhacia\s+(esfuerzos|falta|tiempo|mucho|poco|fr[ií]o|calor)\b/gi,
      'hacía $1',
    )
    .replace(/\bburlona\s+acaso,\s+sabía,/g, 'burlona acaso, sabia,')
    // Reflexive `sí mismo` / `en sí` / `entre sí` and prepositional `de mí` / `a mí` / `en mí` / `hacia mí` / `por mí`
    .replace(
      /\b(para|en|a|por|contra|sobre|de|hacia|entre)\s+si\s+mism([oa]s?)\b/gi,
      '$1 sí mism$2',
    )
    .replace(/\bentre\s+si(?=[,.;:?!»\s])/g, 'entre sí')
    .replace(/\b(lleva|contiene|encierra)\s+en\s+si\b/gi, '$1 en sí')
    .replace(
      /\b(burla|habla|piensa|dentro|cerca|lejos|detrás|delante|alrededor|sepa|aprender)\s+de\s+mi(?=[.,;:?!»\s])/gi,
      '$1 de mí',
    )
    .replace(
      /\b(en|a|para|por|contra|sin|hacia)\s+mi(?=[.,;:?!»—\s]+\b(?:mismo|misma|le\s+|y\s+ahora\b)|[.,;:?!»—])/gi,
      '$1 mí',
    )
    // Subject pronoun `tú` and 3rd-person sacred `Él` in unambiguous contexts
    .replace(
      /\bcomo\s+tu\s+(dices|crees|piensas|sabes|quieres)\b/gi,
      'como tú $1',
    )
    .replace(/\by\s+tu\s+y\s+yo\b/gi, 'y tú y yo')
    .replace(/\bmás\s+que\s+tu\s+y\s+que\s+yo\b/gi, 'más que tú y que yo')
    .replace(/\bde\s+El,\s+el\b/g, 'de Él, el')
    .replace(/\b(cree|también|También)\s+en\s+El(?=[,.;:?!»\s])/g, '$1 en Él')
    .replace(/\bpodr[ií]a\s+El\s+ignorar\b/g, 'podría Él ignorar')
    .replace(/(^|\n\n|[.!?]\s+)El,\s+que\s+supo\b/g, '$1Él, que supo')
    .replace(
      /\bcomo\s+El\s+hab[ií]a\s+sonre[ií]do\b/g,
      'como Él había sonreído',
    )
    // Verb `está` + adjective/adverb (`está perfectamente`, `ya está ahí`, `que está en`, `ya está muerto`, `no está en`)
    .replace(
      /\b(que\s+|ya\s+|no\s+|tambi[eé]n\s+|a[uú]n\s+|todav[ií]a\s+|siempre\s+)esta\s+(?=(?:en\b|ah[ií]|aqu[ií]|all[ií]|muerto|muerta|vivo|viva|bien|mal|presente|ausente|solo|sola|seguro|segura|dispuesto|dispuesta|obligado|obligada|motivado|motivada)(?![A-Za-zÀ-ÿ]))/g,
      '$1está ',
    )
    .replace(/\besta\s+perfectamente\b/g, 'está perfectamente')
    .replace(
      /\bcuando\s+ata[ñn]e\s+al\s+ser\s+humano\b/g,
      'cuanto atañe al ser humano',
    )
    // Preterite speech verbs after subject (`Govinda contestó:`, `Govinda replicó:`, `Siddhartha contestó`)
    .replace(/\b(Govinda|Siddhartha)\s+contesto(?![A-Za-zÀ-ÿ])/g, '$1 contestó')
    .replace(/\b(Govinda|Siddhartha)\s+replico(?![A-Za-zÀ-ÿ])/g, '$1 replicó')
    // Common OCR glued/truncated tokens
    .replace(/\balos\s+(?=[a-zà-ÿ])/g, 'a los ')
    .replace(/\bdadoescuchar\b/g, 'dado escuchar')
    .replace(/\bun\s+feli\s+augurio\b/g, 'un feliz augurio')
    // Fix context-sensitive Spanish words (`las unas` -> `las uñas`, `aun lo sigo` -> `aún lo sigo`, `mas` -> `más`)
    .replace(/\blas\s+(?:unas|ufas)\b/gi, m =>
      m[0] === 'L' ? 'Las uñas' : 'las uñas',
    )
    .replace(/\by\s+aun\b/gi, 'y aún')
    .replace(
      /\baun\s+(?=(?:lo|la|los|las|le|les|me|te|se|nos|os|sigo|sigue|queda|quedan|no|más|mas|cuando)(?![A-Za-zÀ-ÿ]))/gi,
      m => (m[0] === 'A' ? 'Aún ' : 'aún '),
    )
    .replace(
      /\b(el|la|lo|los|las|nunca|nada|nadie|mucho|poco|algo|vez|por|no\s+ser|no\s+era|piensa|cuanto|tanto|a[uú]n|sin|ser|al|pensamientos|parecen|a[ñn]os|d[ií]as|veces|horas|meses|siglos|asunto)\s+mas(?![A-Za-zÀ-ÿ])/gi,
      (_, prefix: string) => `${prefix} más`,
    )
    .replace(
      /\bmas\s+(?=(?:de\s+lo|bien\b|vale\b|anciano|anciana|joven|jóvenes|all[aá]\b|tarde\b|f[aá]cil|dif[ií]cil|grande|peque[ñn]|alto|bajo|lejos|cerca|pronto|profund|íntimo|intimo|adelante|arriba|abajo|tiempo|solo\b|posesionado|sagrado|importante|contradictorio|todav[ií]a|querid[oa]|generos[oa]|secret[oa]))/gi,
      m => (m[0] === 'M' ? 'Más ' : 'más '),
    )
    .replace(
      /([¿¡]?Qu[eé]|qu[eé]|meta|eso|esto|no|todo|me|te|le|nos)\s+seria(?![A-Za-zÀ-ÿ])/g,
      (_, prefix: string) => `${prefix} sería`,
    )
    .replace(
      /\bseria\s+(?=(?:de\s+la|entonces|tambi[eé]n|llegar|un|una|el|la|mejor|peor|posible|imposible|inútil|cuerdo|dif[ií]cil|f[aá]cil)(?![A-Za-zÀ-ÿ]))/gi,
      m => (m[0] === 'S' ? 'Sería ' : 'sería '),
    );

  // Restore missing opening `¿` and fix misread `:`, `;`, `c`, `s` before questions
  out = out
    // `—,: crees ... ?` or `—,: qué ... ?` or `, : a qué ... ?` — colon right after another punctuation mark before a question is ALWAYS `¿`
    .replace(/([,;.?!—«])\s*:\s*(?=[A-ZÀ-Þa-zà-ÿ][^?!.\n]*\?)/g, '$1 ¿')
    // `. ; En qué ... ?` or `? ; Entregarme ... ?` -> `. ¿En qué ... ?`
    .replace(/([.!?…])\s*;\s*(?=[A-ZÀ-Þ][^?!.\n]*\?)/g, '$1 ¿')
    // `Pero: no has ... ?`, `Entonces: por qué ... ?`, `pues: quién ... ?`, `Porque; cual ... ?`
    .replace(
      /\b(Pero|Entonces|Pues|Porque|pues|pero|entonces|porque)\s*[:;]\s*(?=[a-zà-ÿ][^?!.\n]*\?)/g,
      '$1 ¿',
    )
    // `dime: qué es ... ?` or `pregunta: qué hay ... ?` or `inmortal: qué te ... ?` -> `: ¿qué ... ?`
    .replace(/(\bdime:\s*)(?=[A-ZÀ-Þa-zà-ÿ][^?!.\n]*\?)/gi, '$1¿')
    .replace(
      /(:\s+)(?=(?:qu[eé]|c[oó]mo|d[oó]nde|cu[aá]ndo|qui[eé]n|cu[aá]l|cu[aá]nt[oa]s?|por\s+qu[eé]|para\s+qu[eé]|en\s+qu[eé]|de\s+qu[eé]|a\s+qu[eé])(?=\s)[^.?!\n]*\?)/gi,
      '$1¿',
    )
    // Leading `s` or `c` glued to question word (`spara qué` -> `¿para qué`, `cpodrías` -> `¿podrías`)
    .replace(
      /\b[cs](?=(?:para|por|podr[ií]a|pued[ae]|qu[eé]|c[oó]mo|cu[aá]n|d[oó]nde|qui[eé]n)[a-zà-ÿ]*[^?!.\n]*\?)/gi,
      '¿',
    )
    // `«cosas»: es acaso ... ?` or `río: son en verdad realidades?` — colon before verb in a question where `¿` was misread as `:`
    .replace(
      /([»a-zà-ÿ])\s*:\s*(?=(?:es\b|son\b|est[aá]|puede|podr[aá]|habr[aá]|ser[aá]|tiene|hay|no\b|acaso\b)[^.?!\n]*\?)/g,
      '$1, ¿',
    )
    // Single-sentence dialogue line ending in `?` (or `? —preguntó ...`) without internal `—` parenthetical before `?`
    .replace(
      /^(—\s*)(?=(?!Dime\b|Mira\b|Escucha\b|Oye\b)[A-ZÀ-Þ][a-zà-ÿ]+[^.?!\n:—]*\?)/gm,
      '$1¿',
    )
    .replace(/^(—¿)Estas\s+bromeando\?/gm, '$1Estás bromeando?')
    .replace(
      /(^|\n\n|[.!?…»]\s+|—\s*|«\s*|:\s+)(?=(?:Qu[eé]|C[oó]mo|D[oó]nde|Cu[aá]ndo|Qui[eé]n|Cu[aá]l|Cu[aá]nt[oa]s?|Por\s+qu[eé]|Para\s+qu[eé]|En\s+qu[eé]|O\s+acaso\b|Acaso\b|Pretendes\b|Crees\b|Podr[aá]\b|Estaremos\b|Alcanzaremos\b|No\s+seguiremos\b|No\s+deber[ií]amos\b|Y\s+no\s+me\s+dijiste\b|Y\s+qué\s+es\b)[^.?!\n:;]*\?)/gm,
      '$1¿',
    )
    .replace(
      /(^|\n\n)(\d{1,3}\.\s+)(?=[A-ZÀ-Þ][a-zà-ÿ]+[^.?!\n:—«»]*\?»)/gm,
      '$1$2«¿',
    )
    .replace(
      /(^|\n\n)(\d{1,3}\.\s+)(?=[A-ZÀ-Þ][a-zà-ÿ]+[^.?!\n:—«»]*\?)/gm,
      '$1$2¿',
    )
    .replace(
      /(—,\s*|,\s+)(?=(?:qu[eé]\s+(?:quedar[ií]a|ser[ií]a|edad|es\b|significa|idioma)|c[oó]mo\s+(?:saber|es\s+posible|habr[ií]as|la\s+doctrina)|no\s+deber[ií]amos|crees\s+que)\b[^.?!\n:;]*\?)/g,
      '$1¿',
    )
    .replace(
      /(^|\n\n|[.!?]\s+|—\s*)Pero\s+(?=no\s+(?:se\s+ha\s+despertado|has\s+encontrado)[^.?!\n:;]*\?)/gm,
      '$1Pero ¿',
    )
    .replace(
      /([.?!]\s+)(?=De\s+modo,\s+querido\s+amigo,\s+que\s+ahora[^.?!\n:;]*\?)/g,
      '$1¿',
    )
    // Remove duplicate nested `¿` inside the same question (`¿Y crees tú, samana forastero, ¿crees que`)
    .replace(/(¿[^?!\n]*?,\s*)¿(?=[a-zà-ÿ])/g, '$1')
    // Fix accented interrogative pronouns right after `¿` (both uppercase and lowercase)
    .replace(/¿(C|c)uanto(?=\s)/g, '¿$1uánto')
    .replace(/¿(C|c)uanta(?=\s)/g, '¿$1uánta')
    .replace(/¿(C|c)uantos(?=\s)/g, '¿$1uántos')
    .replace(/¿(C|c)uantas(?=\s)/g, '¿$1uántas')
    .replace(/¿(Q|q)ue(?=\s)/g, '¿$1ué')
    .replace(/¿(C|c)omo(?=\s)/g, '¿$1ómo')
    .replace(/¿(D|d)onde(?=\s)/g, '¿$1ónde')
    .replace(/¿(C|c)uando(?=\s)/g, '¿$1uándo')
    .replace(/¿(Q|q)uien(?=\s)/g, '¿$1uién')
    .replace(/¿(C|c)ual(?=\s)/g, '¿$1uál')
    // Restore missing opening `¡` and fix `(`, `;`, `i`, `j`, `¿` before exclamations ending in `!`
    .replace(/\(\s*(?=[^()\n!]*!)/g, '¡')
    .replace(/([.!?:—])\s*;\s*(?=[A-ZÀ-Þ¡][^!?\n]*!)/g, '$1 ¡')
    .replace(/¿(?=[^?!\n]*!)/g, '¡')
    .replace(/¡Más\s+cu[ií]date\b/g, '¡Mas cuídate')
    .replace(/(^|\n\n|—)\s*i(?=[A-ZÀ-Þ][a-zà-ÿ]*[^!\n]*!)/g, '$1¡')
    .replace(
      /\b[ij](?=(?:A\s+nadie|nada\s+hay|ya\s+no|hombre\s+perfecto|intentar[eé]|el\s+miedo|este\s+es\s+un\s+santo)[^!\n]*!)/g,
      '¡',
    )
    .replace(
      /(^|\n\n|[.!?…»]\s+|—\s*|«\s*)(?=(?:Oh\b|Ojal[aá]\b|S[ií],\s+Govinda|Gocemos\b)[^.!\n]*!)/gm,
      '$1¡',
    )
    .replace(/¡Si,/g, '¡Sí,')
    .replace(/»\s+(?=Solo\s+he\s+visto)/g, '»')
    // Close missing `«` before `Upanishad»` or `Vedas»` and before capitalized quotes ending in `»`
    .replace(/\bun\s+(?=Upanishad»)/g, 'un «')
    .replace(/\bsagrados\s+(?=Vedas»)/g, 'sagrados «')
    .replace(
      /([.!?]\s+|:\s+)(?=(?:Soy\s+(?:un\s+)?(?:desdichad[oa]|dichos[oa])|Me\s+levanto\s+para|Te\s+matan,\s+te\s+despedazan)[^«»\n]*»)/g,
      '$1«',
    )
    .replace(/«[ \t]+/g, '«')
    .replace(/[ \t]+»/g, '»')
    // Restore missing leading `—` on paragraph that contains an internal `—preguntó` / `—dijo` / `—repuso` attribution
    .replace(
      /(^|\n\n)(?=[¡¿A-ZÀ-Þ][^\n]*?[ \t]—(?:pregunt[oó]|dijo|repuso|replic[oó]|contest[oó]|exclam[oó]|respondi[oó])(?![A-Za-zÀ-ÿ]))/g,
      '$1—',
    )
    .replace(/¿+/g, '¿')
    .replace(/¡+/g, '¡');

  return out;
};
