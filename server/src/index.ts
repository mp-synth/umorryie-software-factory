import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolveClaudeBin } from './agents/claude.ts';
import { config } from './config.ts';
import { migrate, sql } from './db.ts';
import { recoverOnStartup, releaseRuns, startScheduler } from './pipeline/engine.ts';
import { routes } from './routes.ts';
import { startLiveServices } from './live-services.ts';
import { lockHeldMessage, takeServerLock } from './server-lock.ts';
import { loadLoginShellPath } from './shell-env.ts';
import { stopSignals } from './stop-signals.ts';
import { recordDiscoveryUsageWith } from './discovery.ts';
import { backfillUsage, recordDiscoveryUsage } from './usage.ts';
import { emptyTrash } from './discard.ts';
import { stampConsole, watchEventLoop } from './watchdog.ts';

function stopAfterLosingTheLock(): never {
  console.error('[server] another factory server now holds this database; this one stops at once and leaves the running agents to it');
  process.exit(1);
}

async function main(): Promise<void> {
  stampConsole();
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'warn' },
    bodyLimit: 5 * 1024 * 1024,
    // An open UI tab holds /api/stream forever; without this a SIGTERM waits on
    // it until a second signal. Runs are released before app.close().
    forceCloseConnections: true,
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[server] a background task failed; the agents of every initiative keep running:', reason);
  });

  const lock = await takeServerLock(config.databaseUrl, stopAfterLosingTheLock);
  if (!lock) {
    console.error(lockHeldMessage(config.databaseUrl));
    process.exit(1);
  }

  await migrate();
  if (!(await loadLoginShellPath())) console.warn('[shell] could not read your login shell PATH; repo commands use the server PATH');
  startLiveServices();
  void emptyTrash().catch((err) => console.warn('[discard]', (err as Error).message));
  watchEventLoop();
  await app.register(routes);

  const indexHtml = path.join(config.webDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'not found' });
      return reply.type('text/html').send(fs.readFileSync(indexHtml));
    });
  }

  // Recovery owns unfinished runs and PR sweep claims. Do not expose mutating routes or start new work until
  // it has established one consistent owner for all of them; launchd retries the whole startup on failure.
  await recoverOnStartup();
  await app.listen({ port: config.port, host: config.host });
  await startScheduler();
  recordDiscoveryUsageWith(recordDiscoveryUsage);
  backfillUsage()
    .then((n) => n && console.log(`[usage] recorded ${n} agent session(s) from their transcripts`))
    .catch((err) => console.error('[usage] backfill failed:', (err as Error).message));

  console.log(`\n  ▲ Software Factory  http://localhost:${config.port}`);
  console.log(`    state     ${config.home}`);
  console.log(`    claude    ${resolveClaudeBin() ?? 'NOT FOUND (set CLAUDE_BIN)'}\n`);

  const nextStopSignal = stopSignals();
  const shutdown = (agents: 'leave-agents-running' | 'stop-agents') => async () => {
    const signal = nextStopSignal();
    if (signal === 'stop-now') process.exit(1);
    if (signal === 'copy-of-the-stop') return;
    const followed = await releaseRuns(agents);
    if (followed) {
      console.log(
        agents === 'stop-agents'
          ? `\n  stopped ${followed} running step(s); they are marked interrupted at the next start`
          : `\n  ${followed} step(s) keep running without the server and are followed again at the next start (Ctrl-\\ stops them too)`,
      );
    }
    await app.close();
    await sql.end({ timeout: 2 });
    await lock.release();
    process.exit(0);
  };
  const onExit = config.stopAgentsOnExit ? 'stop-agents' : 'leave-agents-running';
  process.on('SIGINT', shutdown(onExit));
  process.on('SIGTERM', shutdown(onExit));
  process.on('SIGQUIT', shutdown('stop-agents'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
