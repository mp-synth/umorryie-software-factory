import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Basier Square is licensed to Synthesia, so the files stay in TTVPlatform: the UI loads them from
 * a sibling checkout when there is one, and falls back to Inter when there is not.
 */
const TTV_FONTS = process.env.FACTORY_TTV_FONTS ?? fileURLToPath(new URL('../../TTVPlatform/apps/studio/src/assets/fonts', import.meta.url));

const TTV_FACES: [family: string, weight: string, style: string, file: string][] = [
  ['Basier Square', '400', 'normal', 'Basier-Square/Basier-Square-Regular/basiersquare-regular-webfont.woff2'],
  ['Basier Square', '400', 'italic', 'Basier-Square/Basier-Square-RegularItalic/basiersquare-regularitalic-webfont.woff2'],
  ['Basier Square', '500', 'normal', 'Basier-Square/Basier-Square-Medium/basiersquare-medium-webfont.woff2'],
  ['Basier Square', '500', 'italic', 'Basier-Square/Basier-Square-MediumItalic/basiersquare-mediumitalic-webfont.woff2'],
  ['Basier Square', '600', 'normal', 'Basier-Square/Basier-Square-SemiBold/basiersquare-semibold-webfont.woff2'],
  ['Basier Square', '700', 'normal', 'Basier-Square/Basier-Square-Bold/basiersquare-bold-webfont.woff2'],
  ['Basier Square Mono', '400', 'normal', 'Basier-Square-Mono/Basier-Square-Mono-Regular/basiersquaremono-regular-webfont.woff2'],
  ['Basier Square Mono', '600', 'normal', 'Basier-Square-Mono/Basier-Square-Mono-SemiBold/basiersquaremono-semibold-webfont.woff2'],
];

function ttvFonts(): Plugin {
  const id = 'virtual:ttv-fonts';
  const faces = TTV_FACES.filter(([, , , file]) => existsSync(join(TTV_FONTS, file)));
  return {
    name: 'ttv-fonts',
    config: () => (faces.length ? { server: { fs: { allow: [searchForWorkspaceRoot(fileURLToPath(new URL('.', import.meta.url))), TTV_FONTS] } } } : undefined),
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(resolved) {
      if (resolved !== `\0${id}`) return;
      const imports = faces.map(([, , , file], i) => `import f${i} from ${JSON.stringify(`${join(TTV_FONTS, file)}?url`)};`);
      const list = faces.map(([family, weight, style], i) => `{ family: ${JSON.stringify(family)}, weight: '${weight}', style: '${style}', url: f${i} }`);
      return `${imports.join('\n')}\nexport const ttvFaces = [${list.join(', ')}];\n`;
    },
  };
}

export default defineConfig({
  plugins: [react(), ttvFonts()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
          markdown: ['react-markdown', 'remark-gfm'],
          ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-switch', '@radix-ui/react-tooltip', 'lucide-react', 'sonner'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4317', changeOrigin: false },
    },
  },
});
