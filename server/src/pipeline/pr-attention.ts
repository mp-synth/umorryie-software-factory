import { createHash } from 'node:crypto';
import { SETTLED_TICKET_STATUSES, type Ticket } from '@factory/shared';
import type { PrDetail } from '../pr-view.ts';
import type { RememberedStorage } from './memory.ts';
import { Remembered } from './memory.ts';

export interface PrAttention {
  initiativeId: string;
  fingerprint: string;
  headSha: string;
  detectedAt: string;
  claimedFingerprint?: string;
  handoffReady?: boolean;
  propagating?: boolean;
}

export type AttentionHandoff = 'none' | 'ready' | 'settled' | 'changed';

export class PrAttentionQueue {
  private readonly rows: Remembered<PrAttention>;
  private readonly mutations = new Map<string, Promise<unknown>>();

  constructor(storage?: RememberedStorage) {
    this.rows = new Remembered<PrAttention>('pr-attention', storage);
  }

  private mutate<T>(ticketId: string, change: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(ticketId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(change);
    this.mutations.set(ticketId, next);
    const release = () => {
      if (this.mutations.get(ticketId) === next) this.mutations.delete(ticketId);
    };
    void next.then(release, release);
    return next;
  }

  async note(
    ticketId: string,
    attention: Omit<PrAttention, 'detectedAt' | 'claimedFingerprint'>,
    detectedAt = new Date().toISOString(),
  ): Promise<boolean> {
    return this.mutate(ticketId, async () => {
      const current = await this.rows.get(ticketId);
      if (current?.fingerprint === attention.fingerprint) return false;
      await this.rows.set(ticketId, {
        ...attention,
        detectedAt,
        ...(current?.claimedFingerprint ? { claimedFingerprint: current.claimedFingerprint } : {}),
        ...(current?.handoffReady ? { handoffReady: true } : {}),
        ...(current?.propagating ? { propagating: true } : {}),
      });
      return true;
    });
  }

  get(ticketId: string): Promise<PrAttention | undefined> {
    return this.rows.get(ticketId);
  }

  async ticketIds(initiativeId: string): Promise<Set<string>> {
    return new Set((await this.rows.entries()).filter(([, attention]) => attention.initiativeId === initiativeId).map(([ticketId]) => ticketId));
  }

  async pendingTicketIds(initiativeId: string): Promise<Set<string>> {
    return new Set(
      (await this.rows.entries()).filter(([, attention]) => attention.initiativeId === initiativeId && !attention.propagating).map(([ticketId]) => ticketId),
    );
  }

  async propagatingTicketIds(initiativeId: string): Promise<Set<string>> {
    return new Set(
      (await this.rows.entries()).filter(([, attention]) => attention.initiativeId === initiativeId && attention.propagating).map(([ticketId]) => ticketId),
    );
  }

  async initiativeIds(): Promise<Set<string>> {
    return new Set((await this.rows.entries()).map(([, attention]) => attention.initiativeId));
  }

  async claimed(): Promise<[string, PrAttention][]> {
    return (await this.rows.entries()).filter(([, attention]) => !!attention.claimedFingerprint);
  }

  async claim(ticketId: string, fingerprint: string): Promise<boolean> {
    return this.mutate(ticketId, async () => {
      const current = await this.rows.get(ticketId);
      if (!current || current.propagating || current.fingerprint !== fingerprint) return false;
      if (current.claimedFingerprint !== fingerprint) {
        const { handoffReady: _, ...pending } = current;
        await this.rows.set(ticketId, { ...pending, claimedFingerprint: fingerprint });
      }
      return true;
    });
  }

  async claimLatest(
    ticketId: string,
    fallback: Omit<PrAttention, 'detectedAt' | 'claimedFingerprint' | 'propagating'>,
    detectedAt = new Date().toISOString(),
  ): Promise<string | null> {
    return this.mutate(ticketId, async () => {
      const current = await this.rows.get(ticketId);
      if (current?.propagating) return null;
      if (current) {
        if (current.claimedFingerprint !== current.fingerprint) {
          const { handoffReady: _, ...pending } = current;
          await this.rows.set(ticketId, { ...pending, claimedFingerprint: current.fingerprint });
        }
        return current.fingerprint;
      }
      await this.rows.set(ticketId, { ...fallback, detectedAt, claimedFingerprint: fallback.fingerprint });
      return fallback.fingerprint;
    });
  }

  async releaseClaim(ticketId: string, fingerprint: string): Promise<void> {
    await this.mutate(ticketId, async () => {
      const current = await this.rows.get(ticketId);
      if (!current || current.propagating || current.claimedFingerprint !== fingerprint) return;
      const { claimedFingerprint: _, handoffReady: __, ...pending } = current;
      await this.rows.set(ticketId, pending);
    });
  }

  async markHandoffReady(ticketId: string): Promise<boolean> {
    return this.mutate(ticketId, async () => {
      const current = await this.rows.get(ticketId);
      if (!current?.claimedFingerprint || current.propagating) return false;
      if (!current.handoffReady) await this.rows.set(ticketId, { ...current, handoffReady: true });
      return true;
    });
  }

  async beginPropagation(ticketId: string): Promise<AttentionHandoff> {
    return this.mutate(ticketId, async () => {
      const current = await this.rows.get(ticketId);
      if (!current?.claimedFingerprint || !current.handoffReady) return 'none';
      if (!current.propagating) await this.rows.set(ticketId, { ...current, propagating: true });
      return 'ready';
    });
  }

  async completePropagation(ticketId: string): Promise<AttentionHandoff> {
    return this.mutate(ticketId, async () => {
      const current = await this.rows.get(ticketId);
      if (!current?.propagating || !current.claimedFingerprint) return 'none';
      if (current.fingerprint === current.claimedFingerprint) {
        await this.rows.delete(ticketId);
        return 'settled';
      }
      const { claimedFingerprint: _, handoffReady: __, propagating: ___, ...pending } = current;
      await this.rows.set(ticketId, pending);
      return 'changed';
    });
  }
}

export function prAttentionFingerprint(lightFingerprint: string, detail: PrDetail): string {
  const { snapshot, threads } = detail;
  return createHash('sha256')
    .update(
      JSON.stringify({
        lightFingerprint,
        head: snapshot.headRefOid,
        failing: snapshot.failingChecks.map((check) => [check.workflowName, check.name, check.url]),
        pending: snapshot.pendingChecks,
        finished: snapshot.finishedChecks,
        comments: snapshot.comments.map((comment) => [comment.author, comment.createdAt, comment.body]),
        reviews: snapshot.reviews.map((review) => [review.author, review.state, review.submittedAt, review.body]),
        threads: threads.map((thread) => [
          thread.id,
          thread.outdated,
          thread.awaitingReviewer,
          thread.lastCommentAt,
          thread.comments.map((comment) => [comment.author, comment.body]),
        ]),
      }),
    )
    .digest('hex')
    .slice(0, 16);
}

export function isDrainablePrAttention(
  ticket: Pick<Ticket, 'status' | 'gateStatus'>,
  hasHeldPush: boolean,
  sweepEnabled: boolean,
): boolean {
  return sweepEnabled && SETTLED_TICKET_STATUSES.includes(ticket.status) && ticket.gateStatus !== 'infra' && !hasHeldPush;
}
