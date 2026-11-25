// Lets `node --test` run the web's TypeScript unit tests with Node's own type stripping: resolves the
// `@/` alias and the extensionless imports Vite allows.
import { register } from 'node:module';

register('./resolve.mjs', import.meta.url);
