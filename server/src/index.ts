import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolveClaudeBin } from './agents/claude.ts';
import { config } from './config.ts';
import { migrate, sql } from './db.ts';
import { recoverOnStartup, startScheduler, stopAllAgents } from './pipeline/engine.ts';
import { routes } from './routes.ts';
import { loadLoginShellPath } from './shell-env.ts';

async function main(): Promise<void> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'warn' },
    bodyLimit: 5 * 1024 * 1024,
  });

  await migrate();
  if (!(await loadLoginShellPath())) console.warn('[shell] could not read your login shell PATH; repo commands use the server PATH');
  await recoverOnStartup();
  await app.register(routes);

  const indexHtml = path.join(config.webDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'not found' });
      return reply.type('text/html').send(fs.readFileSync(indexHtml));
    });
  }

  await app.listen({ port: config.port, host: config.host });
  startScheduler();

  console.log(`\n  ▲ Software Factory  http://localhost:${config.port}`);
  console.log(`    state     ${config.home}`);
  console.log(`    claude    ${resolveClaudeBin() ?? 'NOT FOUND (set CLAUDE_BIN)'}\n`);

  const shutdown = async () => {
    stopAllAgents();
    await app.close();
    await sql.end({ timeout: 2 });
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
