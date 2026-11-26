import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CHECK_CLASSES, DEFAULT_INITIATIVE_SETTINGS, MAX_MANUAL_AGENTS, MODELS, RULE_ROLES, RULE_SCOPES, type InitiativeDetail, type RunEvent } from '@factory/shared';
import { claudeVersion, resolveClaudeBin } from './agents/claude.ts';
import { config } from './config.ts';
import { sql } from './db.ts';
import * as discovery from './discovery.ts';
import { bus } from './events.ts';
import * as gitx from './git.ts';
import { ghUser } from './github.ts';
import { liveHub } from './live-hub.ts';
import * as engine from './pipeline/engine.ts';
import { validCheckRules } from './pipeline/check-policy.ts';
import { slugify } from './pipeline/plan.ts';
import { renderReport } from './pipeline/report.ts';
import * as repo from './repo.ts';
import * as usage from './usage.ts';

const id = z.object({ id: z.string().uuid() });
const model = z.enum(MODELS);
const effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
const live = liveHub(bus, (runId, after) => repo.listRunEvents(runId, after));
const usageRange = z
  .object({ from: z.coerce.date(), to: z.coerce.date() })
  .refine((r) => r.from < r.to && r.to.getTime() - r.from.getTime() <= 400 * 86_400_000, 'from must come before to, at most 400 days apart');
const liveRuns = z.object({
  watch: z.array(z.object({ id: z.string().uuid(), after: z.number().int().min(0) })).max(200).default([]),
  unwatch: z.array(z.string().uuid()).max(200).default([]),
});

const settingsPatch = z
  .object({
    autoPlanReview: z.boolean(),
    autoExecute: z.boolean(),
    autoReview: z.boolean(),
    autoFix: z.boolean(),
    createPrs: z.boolean(),
    postReviewsToPr: z.boolean(),
    dependentsWaitForCi: z.boolean(),
    dependentsStartWhenBuilt: z.boolean(),
    autoArbiter: z.boolean(),
    autoMerge: z.boolean(),
    autoRetro: z.boolean(),
    foundationCheckpoint: z.boolean(),
    lineInPlanOrder: z.boolean(),
    landStackAtOnce: z.boolean(),
    resumeFixSessions: z.boolean(),
    maxRounds: z.number().int().min(1).max(10),
    maxPlanRounds: z.number().int().min(1).max(5),
    maxArbiterDecisions: z.number().int().min(1).max(10),
    concurrency: z.number().int().min(1).max(10),
    maxTickets: z.number().int().min(1).max(30),
    models: z
      .object({ plan: model, plan_review: model, execute: model, review: model, fix: model, mechanicalFix: model, verify: model, arbitrate: model, ask: model, steer: model, retro: model })
      .partial(),
    efforts: z
      .object({ plan: effort, plan_review: effort, execute: effort, review: effort, fix: effort, verify: effort, arbitrate: effort, ask: effort, steer: effort, retro: effort })
      .partial(),
  })
  .partial();

const checkRule = z.object({
  pattern: z.string().trim().min(1).max(300),
  class: z.enum(CHECK_CLASSES),
  logPattern: z.string().trim().min(1).max(300).optional(),
  note: z.string().trim().max(200).optional(),
});

function expandPath(p: string): string {
  const trimmed = p.trim();
  return path.resolve(trimmed === '~' || trimmed.startsWith('~/') ? path.join(os.homedir(), trimmed.slice(1)) : trimmed);
}

function sse(req: FastifyRequest, reply: FastifyReply): (event: string, data: unknown) => void {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  reply.raw.write('retry: 2000\n\n');
  const ping = setInterval(() => reply.raw.write(`event: ping\ndata: ${Date.now()}\n\n`), 10_000);
  req.raw.on('close', () => clearInterval(ping));
  return (event, data) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function routes(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((err: Error & { statusCode?: number; status?: number }, _req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    }
    const status = err instanceof engine.PipelineError ? err.status : err.statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.status(status).send({ error: err.message });
  });

  app.get('/api/health', async () => {
    let db = false;
    try {
      await sql`select 1`;
      db = true;
    } catch {
      db = false;
    }
    const [version, user] = await Promise.all([claudeVersion(), ghUser()]);
    return {
      db,
      claude: { ok: !!version, path: resolveClaudeBin(), version },
      gh: { ok: !!user, user },
      home: config.home,
    };
  });

  app.get('/api/settings', async () => repo.getAppSettings());
  app.patch('/api/settings', async (req) => {
    const body = z
      .object({
        autoScaleAgents: z.boolean(),
        maxConcurrentAgents: z.number().int().min(1).max(MAX_MANUAL_AGENTS),
        runTimeoutMinutes: z.number().int().min(5).max(600),
        maxBudgetUsdPerRun: z.number().positive().max(1000).nullable(),
        loadUserSettings: z.boolean(),
        gateTimeoutMinutes: z.number().int().min(1).max(180),
        sweepOpenPrs: z.boolean(),
        resumeInterruptedRuns: z.boolean(),
        prNoiseCommentAuthors: z.array(z.string().trim().min(1).max(100)).max(200),
        keepAwake: z.boolean(),
        minBatteryPercent: z.number().int().min(0).max(100),
      })
      .partial()
      .parse(req.body);
    const next = await repo.updateAppSettings(body);
    engine.kick();
    return next;
  });

  app.get('/api/capacity', async () => engine.capacityStatus());

  app.post('/api/pr-sweep', async () => ({ ok: true, count: await engine.sweepOpenPrs() }));

  app.get('/api/defaults', async () => ({ initiativeSettings: DEFAULT_INITIATIVE_SETTINGS }));

  // Agent spend from the usage ledger, between two instants (the UI asks for UTC weeks).
  app.get('/api/usage', async (req) => {
    const { from, to } = usageRange.parse(req.query);
    return usage.usageSummary(from, to);
  });

  app.get('/api/usage/sessions', async (req) => {
    const { from, to } = usageRange.parse(req.query);
    return usage.usageSessions(from, to);
  });

  app.get('/api/usage/weeks', async () => usage.usageWeeks());

  // A tab's only live connection: changes, plus the runs it names below (see live-hub.ts).
  app.get('/api/stream', async (req, reply) => {
    const stream = live.open(sse(req, reply));
    req.raw.on('close', () => stream.close());
  });

  app.post('/api/stream/:sid/runs', async (req, reply) => {
    const { sid } = z.object({ sid: z.string().uuid() }).parse(req.params);
    const { watch, unwatch } = liveRuns.parse(req.body ?? {});
    const stream = live.get(sid);
    // The tab sees its stream close too, reconnects and names its runs again.
    if (!stream) return reply.status(404).send({ error: 'that live stream has closed' });
    for (const runId of unwatch) stream.unwatch(runId);
    await Promise.all(watch.map((w) => stream.watch(w.id, w.after)));
    return { ok: true };
  });

  app.get('/api/projects', async () => repo.listProjects());

  app.get('/api/fs/browse', async (req) => {
    const { path: p } = z.object({ path: z.string().optional() }).parse(req.query);
    const dir = p?.trim() ? expandPath(p) : discovery.defaultBrowseRoot();
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new engine.PipelineError(`${dir} is not a folder`, 400);
    try {
      return discovery.browse(dir);
    } catch (err) {
      throw new engine.PipelineError(`cannot open ${dir}: ${(err as Error).message}`, 400);
    }
  });

  app.get('/api/fs/inspect', async (req) => {
    const { path: p } = z.object({ path: z.string().min(1) }).parse(req.query);
    const dir = expandPath(p);
    if (!fs.existsSync(dir)) return { ok: false, path: dir, error: 'Path does not exist' };
    if (!(await gitx.isGitRepo(dir))) return { ok: false, path: dir, error: 'Not the root of a git repository' };
    const [defaultBranch, remote, branches, suggestion] = await Promise.all([
      gitx.detectDefaultBranch(dir),
      gitx.remoteUrl(dir),
      gitx.listBranches(dir),
      discovery.suggestFromFiles(dir),
    ]);
    return {
      ok: true,
      path: dir,
      name: path.basename(dir),
      defaultBranch,
      remoteUrl: remote,
      github: gitx.isGithubUrl(remote),
      branches,
      suggestion,
    };
  });

  app.post('/api/fs/discover', async (req) => {
    const body = z.object({ path: z.string().min(1), force: z.boolean().default(false) }).parse(req.body);
    const dir = expandPath(body.path);
    if (!(await gitx.isGitRepo(dir))) throw new engine.PipelineError(`${dir} is not the root of a git repository`, 400);
    return discovery.discoverWithClaude(dir, body.force);
  });

  const projectBody = z.object({
    name: z.string().trim().min(1).max(80),
    repoPath: z.string().trim().min(1),
    defaultBranch: z.string().trim().min(1).optional(),
    checksCommand: z.string().trim().max(2000).nullable().optional(),
    setupCommand: z.string().trim().max(2000).nullable().optional(),
    fixCommand: z.string().trim().max(2000).nullable().optional(),
    mergeCheckCommand: z.string().trim().max(2000).nullable().optional(),
    quickChecksCommand: z.string().trim().max(2000).nullable().optional(),
    checkPolicy: z
      .array(checkRule)
      .max(100)
      .refine((rules) => validCheckRules(rules).length === 0, (rules) => ({ message: validCheckRules(rules).join('; ') }))
      .optional(),
    generatedPaths: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
    skipAgentCommitHooks: z.boolean().optional(),
    notes: z.string().max(20_000).nullable().optional(),
    copyFiles: z
      .array(z.string().trim().min(1).refine(gitx.isSafeRelativePath, 'must be a path inside the repository'))
      .max(20)
      .optional(),
    referenceDirs: z
      .array(z.string().trim().min(1).transform(expandPath).refine((d) => fs.existsSync(d) && fs.statSync(d).isDirectory(), 'folder not found'))
      .max(10)
      .optional(),
  });

  app.post('/api/projects', async (req, reply) => {
    const body = projectBody.parse(req.body);
    const dir = expandPath(body.repoPath);
    if (!(await gitx.isGitRepo(dir))) return reply.status(400).send({ error: `${dir} is not the root of a git repository` });
    const project = await repo.insertProject({
      name: body.name,
      repoPath: dir,
      defaultBranch: body.defaultBranch || (await gitx.detectDefaultBranch(dir)),
      checksCommand: body.checksCommand || null,
      setupCommand: body.setupCommand || null,
      fixCommand: body.fixCommand || null,
      mergeCheckCommand: body.mergeCheckCommand || null,
      quickChecksCommand: body.quickChecksCommand || null,
      checkPolicy: body.checkPolicy ?? [],
      generatedPaths: body.generatedPaths ?? [],
      skipAgentCommitHooks: body.skipAgentCommitHooks ?? false,
      notes: body.notes || null,
      remoteUrl: await gitx.remoteUrl(dir),
      copyFiles: body.copyFiles ?? [],
      referenceDirs: body.referenceDirs ?? [],
    });
    return reply.status(201).send(project);
  });

  app.patch('/api/projects/:id', async (req) => {
    const { id: pid } = id.parse(req.params);
    const body = projectBody.omit({ repoPath: true }).partial().parse(req.body);
    return repo.updateProject(pid, body);
  });

  app.delete('/api/projects/:id', async (req, reply) => {
    const { id: pid } = id.parse(req.params);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from initiatives where project_id = ${pid} and status <> 'archived'`;
    if (n > 0) return reply.status(409).send({ error: 'Delete or archive this project’s initiatives first' });
    await repo.deleteProject(pid);
    return { ok: true };
  });

  app.get('/api/projects/:id/rules', async (req) => {
    const { id: pid } = id.parse(req.params);
    return repo.listRules({ projectId: pid });
  });

  app.post('/api/rules/:id/:action', async (req) => {
    const { id: rid, action } = z.object({ id: z.string().uuid(), action: z.enum(['accept', 'reject', 'retire']) }).parse(req.params);
    if (action === 'reject') return engine.rejectRule(rid);
    if (action === 'retire') return engine.retireRule(rid);
    const edit = z
      .object({ body: z.string().trim().min(1).max(600), role: z.enum(RULE_ROLES), scope: z.enum(RULE_SCOPES) })
      .partial()
      .parse(req.body ?? {});
    return engine.acceptRule(rid, edit);
  });

  app.get('/api/projects/:id/branches', async (req) => {
    const { id: pid } = id.parse(req.params);
    const p = await repo.getProject(pid);
    if (!p) throw new engine.PipelineError('project not found', 404);
    return { branches: await gitx.listBranches(p.repoPath), defaultBranch: p.defaultBranch };
  });

  app.get('/api/initiatives', async () => repo.listInitiativeSummaries());

  app.post('/api/initiatives', async (req, reply) => {
    const body = z
      .object({
        projectId: z.string().uuid(),
        title: z.string().trim().min(3).max(120),
        brief: z.string().trim().min(10).max(50_000),
        baseBranch: z.string().trim().min(1).optional(),
        settings: settingsPatch.optional(),
        start: z.boolean().default(true),
      })
      .parse(req.body);
    const project = await repo.getProject(body.projectId);
    if (!project) return reply.status(404).send({ error: 'project not found' });
    const baseBranch = body.baseBranch || project.defaultBranch;
    if (!(await gitx.refExists(project.repoPath, baseBranch)) && !(await gitx.refExists(project.repoPath, `origin/${baseBranch}`))) {
      return reply.status(400).send({ error: `branch "${baseBranch}" does not exist in ${project.name}` });
    }
    const init = await repo.insertInitiative({
      projectId: project.id,
      slug: slugify(body.title, 32),
      title: body.title,
      brief: body.brief,
      baseBranch,
      settings: { ...DEFAULT_INITIATIVE_SETTINGS, ...body.settings, models: { ...DEFAULT_INITIATIVE_SETTINGS.models, ...body.settings?.models } },
    });
    if (body.start) await engine.enqueue({ kind: 'plan', initiativeId: init.id, trigger: 'manual' });
    return reply.status(201).send(init);
  });

  app.get('/api/initiatives/:id', async (req, reply): Promise<InitiativeDetail | undefined> => {
    const { id: iid } = id.parse(req.params);
    const initiative = await repo.getInitiative(iid);
    if (!initiative) {
      reply.status(404).send({ error: 'initiative not found' });
      return;
    }
    const [project, tickets, runs, messages, rules, cost] = await Promise.all([
      repo.getProject(initiative.projectId),
      repo.listTickets(iid),
      repo.listRuns({ initiativeId: iid, limit: 500 }),
      repo.listMessages(iid),
      repo.listRules({ initiativeId: iid }),
      repo.initiativeCost(iid),
    ]);
    return { initiative, project: project!, tickets, runs, messages, rules, costUsd: cost };
  });

  app.get('/api/initiatives/:id/report', async (req, reply) => {
    const { id: iid } = id.parse(req.params);
    const initiative = await repo.getInitiative(iid);
    if (!initiative) return reply.status(404).send({ error: 'initiative not found' });
    const [tickets, cost] = await Promise.all([
      repo.listTickets(iid),
      repo.initiativeCost(iid),
    ]);
    return reply.type('text/markdown; charset=utf-8').send(renderReport({ initiative, tickets, costUsd: cost }));
  });

  app.patch('/api/initiatives/:id', async (req) => {
    const { id: iid } = id.parse(req.params);
    const body = z
      .object({
        title: z.string().trim().min(3).max(120),
        brief: z.string().trim().min(10).max(50_000),
        status: z.enum(['archived', 'draft']),
        settings: settingsPatch,
      })
      .partial()
      .parse(req.body);
    const init = await repo.getInitiative(iid);
    if (!init) throw new engine.PipelineError('initiative not found', 404);
    if (body.status === 'draft' && init.status !== 'archived') throw new engine.PipelineError('only archived initiatives can be restored');
    if (body.settings?.lineInPlanOrder !== undefined && body.settings.lineInPlanOrder !== init.settings.lineInPlanOrder) {
      if ((await repo.listTickets(iid)).length) {
        throw new engine.PipelineError('One GitHub stack in plan order can change only before the plan creates tickets; reset or replan first');
      }
    }
    const status = body.status === 'draft' ? (init.planJson ? (init.approvedAt ? 'in_progress' : 'awaiting_approval') : 'draft') : body.status;
    const settings = body.settings
      ? {
          ...init.settings,
          ...body.settings,
          models: { ...init.settings.models, ...body.settings.models },
          efforts: { ...init.settings.efforts, ...body.settings.efforts },
        }
      : undefined;
    const next = await repo.updateInitiative(iid, { title: body.title, brief: body.brief, status, settings });
    if (body.settings) engine.kick();
    if (body.settings?.autoMerge) void engine.advanceAutoMerge(iid);
    return next;
  });

  app.delete('/api/initiatives/:id', async (req) => {
    const { id: iid } = id.parse(req.params);
    await engine.deleteInitiative(iid);
    return { ok: true };
  });

  app.post('/api/initiatives/:id/plan', async (req) => {
    const { id: iid } = id.parse(req.params);
    const { feedback } = z.object({ feedback: z.string().trim().max(20_000).optional() }).parse(req.body ?? {});
    if (feedback) return engine.requestPlanChanges(iid, feedback).then(() => ({ ok: true }));
    return engine.enqueue({ kind: 'plan', initiativeId: iid, trigger: 'manual' });
  });

  app.post('/api/initiatives/:id/plan-review', async (req) => {
    const { id: iid } = id.parse(req.params);
    return engine.enqueue({ kind: 'plan_review', initiativeId: iid, trigger: 'manual' });
  });

  app.post('/api/initiatives/:id/approve', async (req) => {
    const { id: iid } = id.parse(req.params);
    const { note } = z.object({ note: z.string().max(5000).optional() }).parse(req.body ?? {});
    await engine.approvePlan(iid, note);
    return { ok: true };
  });

  app.post('/api/initiatives/:id/reset', async (req) => {
    const { id: iid } = id.parse(req.params);
    await engine.resetInitiative(iid);
    return { ok: true };
  });

  app.post('/api/initiatives/:id/actions/:action', async (req) => {
    const { id: iid, action } = z
      .object({ id: z.string().uuid(), action: z.enum(['run-ready', 'review-all', 'fix-all', 'fix-prs', 'sync-prs', 'ready-prs']) })
      .parse(req.params);
    const n = await engine.bulk(iid, action);
    return { ok: true, count: n };
  });

  app.post('/api/initiatives/:id/retro', async (req) => {
    const { id: iid } = id.parse(req.params);
    return engine.retroNow(iid, null);
  });

  app.post('/api/initiatives/:id/messages', async (req, reply) => {
    const { id: iid } = id.parse(req.params);
    const body = z
      .object({
        body: z.string().trim().min(1).max(20_000),
        kind: z.enum(['comment', 'feedback', 'question']),
        ticketId: z.string().uuid().nullable().optional(),
        act: z.boolean().default(true),
      })
      .parse(req.body);
    const ticketId = body.ticketId ?? null;
    const ticket = ticketId ? await repo.getTicket(ticketId) : null;
    if (ticket && body.kind === 'feedback' && body.act) engine.assertTicketAcceptsWork(ticket);
    if (body.kind === 'question') {
      const run = await engine.ask(iid, ticketId, body.body);
      return reply.status(201).send({ ok: true, runId: run.id });
    }
    if (body.kind === 'feedback' && !ticketId && body.act) {
      await engine.steerInitiative(iid, body.body);
      return reply.status(201).send({ ok: true });
    }
    const msg = await repo.addMessage({ initiativeId: iid, ticketId, author: 'human', kind: body.kind, body: body.body });
    if (body.kind === 'feedback' && ticketId && body.act) {
      const kind = ticket?.branch ? 'fix' : 'execute';
      const run = await engine.enqueue({ kind, initiativeId: iid, ticketId, trigger: 'manual' });
      return reply.status(201).send({ ok: true, message: msg, runId: run.id });
    }
    return reply.status(201).send({ ok: true, message: msg });
  });

  app.patch('/api/tickets/:id', async (req) => {
    const { id: tid } = id.parse(req.params);
    const t = await repo.getTicket(tid);
    if (!t) throw new engine.PipelineError('ticket not found', 404);
    if (!['proposed', 'todo', 'blocked'].includes(t.status)) throw new engine.PipelineError('only tickets that have not started can be edited');
    const bullet = z.string().trim().min(1).max(400);
    const body = z
      .object({
        title: z.string().trim().min(3).max(120),
        what: z.string().trim().max(2000),
        goal: z.string().trim().max(2000),
        outcome: z.string().trim().max(2000),
        guidance: z.array(bullet).max(12),
        acceptance: z.array(bullet).max(12),
      })
      .partial()
      .parse(req.body);
    return repo.updateTicket(tid, body);
  });

  app.post('/api/tickets/:id/:action', async (req) => {
    const { id: tid, action } = z
      .object({
        id: z.string().uuid(),
        action: z.enum(['run', 'check', 'review', 'fix', 'retro', 'arbitrate', 'reset', 'mark-approved', 'mark-merged', 'mark-todo']),
      })
      .parse(req.params);
    const t = await repo.getTicket(tid);
    if (!t) throw new engine.PipelineError('ticket not found', 404);
    switch (action) {
      case 'run':
        return engine.enqueue({ kind: 'execute', initiativeId: t.initiativeId, ticketId: t.id, trigger: 'manual' });
      case 'check':
        return engine.checkTicket(t.id);
      case 'review':
        return engine.enqueue({ kind: 'review', initiativeId: t.initiativeId, ticketId: t.id, trigger: 'manual' });
      case 'fix':
        return engine.enqueue({ kind: 'fix', initiativeId: t.initiativeId, ticketId: t.id, trigger: 'manual' });
      case 'retro':
        return engine.retroNow(t.initiativeId, t.id);
      case 'arbitrate':
        return engine.arbitrateNow(t.initiativeId, t.id);
      case 'reset':
        await engine.resetTicket(t.id);
        return { ok: true };
      case 'mark-approved':
        await engine.setTicketStatus(t.id, 'approved');
        return { ok: true };
      case 'mark-merged':
        await engine.setTicketStatus(t.id, 'merged');
        return { ok: true };
      case 'mark-todo':
        await engine.setTicketStatus(t.id, 'todo');
        return { ok: true };
    }
  });

  app.get('/api/runs', async (req) => {
    const q = z
      .object({
        initiativeId: z.string().uuid().optional(),
        ticketId: z.string().uuid().optional(),
        active: z.coerce.boolean().optional(),
        limit: z.coerce.number().int().min(1).max(1000).optional(),
      })
      .parse(req.query);
    return repo.listRuns(q);
  });

  app.get('/api/runs/:id', async (req, reply) => {
    const { id: rid } = id.parse(req.params);
    const [run] = await repo.listRunsById(rid);
    if (!run) return reply.status(404).send({ error: 'run not found' });
    return run;
  });

  app.get('/api/runs/:id/events', async (req) => {
    const { id: rid } = id.parse(req.params);
    return repo.listRunEvents(rid);
  });

  // One connection per run. The UI now watches runs over /api/stream; this stays
  // for tabs still running a bundle from before that.
  app.get('/api/runs/:id/stream', async (req, reply) => {
    const { id: rid } = id.parse(req.params);
    const { after } = z.object({ after: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    const send = sse(req, reply);
    let last = after;
    const buffer: RunEvent[] = [];
    let replaying = true;
    const onEvent = (e: RunEvent) => {
      if (replaying) buffer.push(e);
      else if (Number(e.id) > last) {
        last = Number(e.id);
        send('event', e);
      }
    };
    bus.on(`run:${rid}`, onEvent);
    req.raw.on('close', () => bus.off(`run:${rid}`, onEvent));
    for (const e of await repo.listRunEvents(rid, after)) {
      last = Number(e.id);
      send('event', e);
    }
    replaying = false;
    for (const e of buffer) onEvent(e);
    send('ready', { last });
  });

  app.post('/api/runs/:id/cancel', async (req) => {
    const { id: rid } = id.parse(req.params);
    await engine.cancelRun(rid);
    return { ok: true };
  });
}
