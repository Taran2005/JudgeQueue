import { randomUUID } from 'node:crypto';
import express from 'express';
import type { ErrorRequestHandler, Express } from 'express';
import { createSubmissionSchema } from '@judgequeue/shared';
import type { EnqueueRequest, Logger } from '@judgequeue/shared';
import { z } from 'zod';
import type { SubmissionRepo } from './repo.js';

export interface AppDeps {
  repo: SubmissionRepo;
  enqueue(request: EnqueueRequest): Promise<void>;
  checkReady(): Promise<void>;
  log: Logger;
}

const idSchema = z.string().uuid();

const errorHandler =
  (log: Logger): ErrorRequestHandler =>
  (err, _req, res, _next) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'validation_error', issues: err.issues });
      return;
    }
    const status = typeof err?.status === 'number' ? err.status : 500;
    if (status >= 500) log.error({ err }, 'unhandled request error');
    res.status(status).json({ error: status >= 500 ? 'internal_error' : 'bad_request' });
  };

export function createApp(deps: AppDeps): Express {
  const { repo, enqueue, checkReady, log } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', 'weak');
  app.use(express.json({ limit: '128kb' }));

  app.get('/health', async (_req, res) => {
    try {
      await checkReady();
      res.json({ status: 'ok' });
    } catch (err) {
      log.warn({ err }, 'health check failed');
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.post('/submissions', async (req, res) => {
    const input = createSubmissionSchema.parse(req.body);
    if (!(await repo.problemExists(input.problemId))) {
      res.status(404).json({ error: 'problem_not_found' });
      return;
    }
    const id = randomUUID();
    await repo.insert({ ...input, id });
    // The reconciler re-enqueues QUEUED rows, so a failed enqueue is recoverable.
    await enqueue({ submissionId: id, judgeVersion: 1, attempts: 0, context: input.context }).catch(
      (err: unknown) => log.error({ err, submissionId: id }, 'enqueue failed after insert'),
    );
    res.status(201).json({ id });
  });

  app.get('/submissions/:id', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const submission = await repo.find(id);
    if (!submission) {
      res.status(404).json({ error: 'submission_not_found' });
      return;
    }
    res.set('Cache-Control', 'no-cache');
    res.json(submission);
  });

  app.post('/submissions/:id/rejudge', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const judgeVersion = await repo.resetForRejudge(id);
    if (judgeVersion === undefined) {
      res.status(404).json({ error: 'submission_not_found' });
      return;
    }
    await enqueue({ submissionId: id, judgeVersion, attempts: 0, context: 'rejudge' }).catch(
      (err: unknown) => log.error({ err, submissionId: id }, 'enqueue failed after rejudge reset'),
    );
    res.status(202).json({ id, judgeVersion });
  });

  app.use(errorHandler(log));
  return app;
}
