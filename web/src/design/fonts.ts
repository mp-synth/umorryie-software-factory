import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import interLatin from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import { ttvFaces } from 'virtual:ttv-fonts';

/** Framework 26's numeric preset sets figures in Inter, tabular, inside Basier Square text. */
const NUMERALS = 'U+0024-0025, U+002B-003A, U+00D7, U+2212';

export const hasBasierSquare = ttvFaces.some((f) => f.family === 'Basier Square');

export function registerFonts(): void {
  const faces = [
    new FontFace('Inter Numerals', `url(${interLatin}) format('woff2')`, { weight: '100 900', display: 'swap', unicodeRange: NUMERALS }),
    ...ttvFaces.map((f) => new FontFace(f.family, `url(${f.url}) format('woff2')`, { weight: f.weight, style: f.style, display: 'swap' })),
  ];
  for (const face of faces) {
    document.fonts.add(face);
    face.load().catch(() => undefined);
  }
}
