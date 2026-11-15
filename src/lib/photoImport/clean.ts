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
  convertianse: 'convertíanse',
  mostrabase: 'mostrábase',
  tornabase: 'tornábase',
  // Unambiguous `ñ` words (and `ni` misreads like `peldanio`)
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
  enganarnos: 'engañarnos',
  peldano: 'peldaño',
  peldanio: 'peldaño',
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
  otono: 'otoño',
  bano: 'baño',
  dano: 'daño',
  danos: 'daños',
  pano: 'paño',
  rebano: 'rebaño',
  tamano: 'tamaño',
  ermitano: 'ermitaño',
  compania: 'compañía',
  companero: 'compañero',
  companera: 'compañera',
  companeros: 'compañeros',
  ensenar: 'enseñar',
  ensenando: 'enseñando',
  ensenanza: 'enseñanza',
  ensenanzas: 'enseñanzas',
  enseno: 'enseñó',
  manana: 'mañana',
  senor: 'señor',
  senora: 'señora',
  senal: 'señal',
  espanol: 'español',
  espanola: 'española',
  arana: 'araña',
  cabana: 'cabaña',
  campana: 'campaña',
  entranas: 'entrañas',
  hazana: 'hazaña',
  lena: 'leña',
  pestana: 'pestaña',
  pestanas: 'pestañas',
  carrona: 'carroña',
  puno: 'puño',
  empeno: 'empeño',
  ceno: 'ceño',
  diseno: 'diseño',
};

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
    // In Spanish, `ü` only exists in `güe`/`güi`; anywhere else it is `ú`.
    .replace(/ü(?![eiEI])/g, 'ú')
    .replace(/([^gG])ü/g, '$1ú')
    .replace(/^ü/g, 'ú')
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
  // Word-by-word dictionary restoration for unambiguous Spanish words first
  let out = s.replace(/[A-Za-zÀ-ÿ]+/g, word => {
    const lower = word.toLowerCase();
    const fixed = EXACT_WORD_FIXES[lower];
    return fixed ? preserveCase(word, fixed) : word;
  });

  out = out
    // Leading dialogue line where `—` was misread as `S ` or `: ` across a multi-line paragraph
    .replace(/(^|\n\n)[S:]\s+(?=[A-ZÀ-Þ][a-zà-ÿ]+\s*[-—]\s*le\s+dijo)/g, '$1—')
    .replace(/(^|\n\n):\s*(?=[A-ZÀ-Þ][a-zà-ÿ]+[^?!\n]*!)/g, '$1—¡')
    // Word-internal parenthetical em-dashes (`Govinda-preguntó`, `Si-pensó`, `aguas-replicó Siddhartha—`)
    .replace(
      /([A-Za-zÀ-ÿ¡!¿?])\s*[-—]\s*((?:pens[oó]|dijo|replic[oó]|repuso|pregunt[oó]|contest[oó]|exclam[oó]|murmur[oó]|a[ñn]adi[oó]|grit[oó]|susurr[oó]|habl[oó]|le\s+dijo|y\s+a[uú]n|en\s+el\s+curso)(?![A-Za-zÀ-ÿ]))/gi,
      '$1 —$2',
    )
    .replace(/\b(Govinda|Siddhartha)(dijo|replic[oó]|repuso|pregunt[oó]|contest[oó]|exclam[oó]|murmur[oó])—/g, '$1 —$2—')
    .replace(/([A-Za-zÀ-ÿ])—(?=[A-Za-zÀ-ÿ])/g, '$1 —')
    // Fix `«Si —pensó` -> `«Sí —pensó` and `¡Si,` -> `¡Sí,` and `Pero si sé` -> `Pero sí sé`
    .replace(/([«¡])\s*Si(?=\s*[-—,.;:!?\s])/g, '$1Sí')
    .replace(/\bPero\s+si\s+s[eé](?![A-Za-zÀ-ÿ])/g, 'Pero sí sé')
    // Reflexive `sí mismo` and prepositional `de mí` / `a mí` / `en mí`
    .replace(/\b(para|en|a|por|contra|sobre|de)\s+si\s+mism([oa]s?)\b/gi, '$1 sí mism$2')
    .replace(/\b(burla|habla|piensa|dentro|cerca|lejos|detrás|delante|alrededor)\s+de\s+mi(?=[.,;:?!»\s])/gi, '$1 de mí')
    .replace(/\b(en|a|para|por|contra|sin)\s+mi(?=[.,;:?!»])/gi, '$1 mí')
    // Subject pronoun `tú` in unambiguous contexts
    .replace(/\bcomo\s+tu\s+(dices|crees|piensas|sabes|quieres)\b/gi, 'como tú $1')
    .replace(/\by\s+tu\s+y\s+yo\b/gi, 'y tú y yo')
    // Verb `está` + `en todas partes` / `en mí` / `allí` / `aquí`
    .replace(/\bque\s+esta\s+en\b/g, 'que está en')
    // Preterite speech verbs after subject (`Govinda contestó:`, `Govinda replicó:`, `Siddhartha contestó`)
    .replace(/\b(Govinda|Siddhartha)\s+contesto(?![A-Za-zÀ-ÿ])/g, '$1 contestó')
    .replace(/\b(Govinda|Siddhartha)\s+replico(?![A-Za-zÀ-ÿ])/g, '$1 replicó')
    // Common OCR glued/truncated tokens
    .replace(/\balos\s+(?=[a-zà-ÿ])/g, 'a los ')
    .replace(/\bun\s+feli\s+augurio\b/g, 'un feliz augurio')
    .replace(/\bque\s+poco\s+sab[ií]a(?![A-Za-zÀ-ÿ])/g, 'qué poco sabía')
    // Fix context-sensitive Spanish words (`las unas` -> `las uñas`, `aun lo sigo` -> `aún lo sigo`, etc.)
    .replace(/\blas\s+(?:unas|ufas)\b/gi, m => (m[0] === 'L' ? 'Las uñas' : 'las uñas'))
    .replace(/\by\s+aun\b/gi, 'y aún')
    .replace(
      /\baun\s+(?=(?:lo|la|los|las|le|les|me|te|se|nos|os|sigo|sigue|queda|quedan|no|más|mas|así|asi|cuando)(?![A-Za-zÀ-ÿ]))/gi,
      m => (m[0] === 'A' ? 'Aún ' : 'aún '),
    )
    .replace(
      /\b(el|la|lo|los|las|nunca|nada|nadie|mucho|poco|algo|vez|por|no\s+ser|no\s+era|piensa|cuanto|tanto|a[uú]n|sin)\s+mas(?![A-Za-zÀ-ÿ])/gi,
      (_, prefix: string) => `${prefix} más`,
    )
    .replace(
      /\bmas\s+(?=(?:de\s+lo|bien\b|vale\b|anciano|anciana|joven|jóvenes|all[aá]\b|tarde\b|f[aá]cil|dif[ií]cil|grande|peque[ñn]|alto|bajo|lejos|cerca|pronto|profund|íntimo|intimo|adelante|arriba|abajo|tiempo))/gi,
      m => (m[0] === 'M' ? 'Más ' : 'más '),
    )
    .replace(
      /([¿¡]?Qu[eé]|qu[eé]|meta|eso|esto|no|todo)\s+seria(?![A-Za-zÀ-ÿ])/g,
      (_, prefix: string) => `${prefix} sería`,
    )
    .replace(
      /\bseria\s+(?=(?:de\s+la|entonces|llegar|un|una|el|la|mejor|peor|posible|imposible|inútil|cuerdo)(?![A-Za-zÀ-ÿ]))/gi,
      m => (m[0] === 'S' ? 'Sería ' : 'sería '),
    )
    .replace(/\bde\s+El,\s+el\b/g, 'de Él, el');

  // Restore missing opening `¿` ONLY on the actual question clause (never crossing `.`, `;`, or `:`)
  out = out
    .replace(
      /([,;:—«])\s*:\s*(?=(?:qu[eé]|c[oó]mo|d[oó]nde|cu[aá]ndo|qui[eé]n|cu[aá]l|cu[aá]nt[oa]s?|por\s+qu[eé])\b[^.?!\n:;]*\?)/gi,
      '$1 ¿',
    )
    .replace(
      /(^|\n\n|[.!?…»]\s+|—\s*|«\s*|:\s+)(?=(?:Qu[eé]|C[oó]mo|D[oó]nde|Cu[aá]ndo|Qui[eé]n|Cu[aá]l|Cu[aá]nt[oa]s?|Por\s+qu[eé]|Crees\b|Podr[aá]\b|Estaremos\b|Alcanzaremos\b|No\s+seguiremos\b|No\s+deber[ií]amos\b|Y\s+no\s+me\s+dijiste\b)[^.?!\n:;]*\?)/gm,
      '$1¿',
    )
    .replace(
      /(—,\s*|,\s+)(?=(?:qu[eé]\s+(?:quedar[ií]a|ser[ií]a|edad|es\b|significa)|c[oó]mo\s+(?:saber|es\s+posible|habr[ií]as|la\s+doctrina)|no\s+deber[ií]amos|crees\s+que)\b[^.?!\n:;]*\?)/g,
      '$1¿',
    )
    .replace(/(^|\n\n|[.!?]\s+|—\s*)Pero\s+(?=no\s+se\s+ha\s+despertado[^.?!\n:;]*\?)/gm, '$1Pero ¿')
    .replace(/([.?!]\s+)(?=De\s+modo,\s+querido\s+amigo,\s+que\s+ahora[^.?!\n:;]*\?)/g, '$1¿')
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
    // Restore missing opening `¡` on exclamatory clauses ending in `!`
    .replace(
      /(^|\n\n|[.!?…»]\s+|—\s*|«\s*)(?=(?:Oh\b|Ojal[aá]\b|S[ií],\s+Govinda|Gocemos\b)[^.!\n]*!)/gm,
      '$1¡',
    )
    .replace(/¡Si,/g, '¡Sí,')
    // Restore leading dialogue dash `—` on paragraphs immediately following a speech-intro paragraph ending in `:`
    .replace(/(:\n\n)(?=[¡¿A-ZÀ-Þ])/g, '$1—')
    // Close missing `«` before `Upanishad»` or `Vedas»`
    .replace(/\bun\s+(?=Upanishad»)/g, 'un «')
    .replace(/\bsagrados\s+(?=Vedas»)/g, 'sagrados «')
    .replace(/¿+/g, '¿')
    .replace(/¡+/g, '¡');

  return out;
};
