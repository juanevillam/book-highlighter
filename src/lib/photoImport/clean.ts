/** Fix what the Latin recogniser gets wrong in Spanish, every time. */
export const cleanOcr = (s: string): string =>
  s
    .replace(/ä/g, 'á')
    .replace(/ë/g, 'é')
    .replace(/ï/g, 'í')
    .replace(/ö/g, 'ó')
    .replace(/[êè]/g, 'é')
    .replace(/[âà]/g, 'á')
    .replace(/[ôò]/g, 'ó')
    .replace(/([^gG])ü/g, '$1ú')
    .replace(/([a-záéíóúñ])6(?=[^0-9]|$)/g, '$1ó')
    .replace(/>/g, '»')
    .replace(/</g, '«')
    .replace(/^\s*--?(?=\s*[¡¿A-ZÀ-Þa-z])/, '—')
    .replace(/\s+([,;:.])/g, '$1')
    .replace(/([,;:])(?=[A-Za-zÀ-ÿ])/g, '$1 ');
