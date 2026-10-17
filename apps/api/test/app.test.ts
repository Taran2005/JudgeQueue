import http from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@judgequeue/shared';
import type { EnqueueRequest } from '@judgequeue/shared';
import { createApp } from '../src/app.js';
import type { SubmissionRepo, SubmissionView } from '../src/repo.js';

const KNOWN_ID = '3f0f9a6e-0f64-4d5c-9a5b-8c1f3f6d2b11';

function fakeRepo(overrides: Partial<SubmissionRepo> = {}): SubmissionRepo {
  const view: SubmissionView = {
    id: KNOWN_ID,
    status: 'DONE',
    verdict: 'AC',
    time_ms: 12,
    memory_kb: 3400,
    failed_test: null,
  };
  return {
    problemExists: async (id) => id === 'a-plus-b',
    insert: async () => undefined,
    find: async (id) => (id === KNOWN_ID ? view : undefined),
    resetForRejudge: async (id) => (id === KNOWN_ID ? 2 : undefined),
    ...overrides,
  };
}

describe('api', () => {
  let server: Server;
  let base: string;
  const enqueue = vi.fn<(request: EnqueueRequest) => Promise<void>>();

  async function start(repo: SubmissionRepo = fakeRepo()): Promise<void> {
    const app = createApp({
      repo,
      enqueue,
      checkReady: async () => undefined,
      log: createLogger('test', 'silent'),
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  beforeEach(() => {
    enqueue.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  });

  const post = (path: string, body: unknown): Promise<Response> =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  // fetch() hides 304 responses behind its own cache layer, so conditional GETs use raw http.
  const rawGet = (path: string, headers: Record<string, string> = {}) =>
    new Promise<{ status: number | undefined; etag: string | undefined }>((resolve, reject) => {
      const { port } = server.address() as AddressInfo;
      http
        .get({ host: '127.0.0.1', port, path, headers }, (res) => {
          res.resume();
          resolve({ status: res.statusCode, etag: res.headers.etag });
        })
        .on('error', reject);
    });

  const valid = { problemId: 'a-plus-b', language: 'cpp', code: 'int main(){}', context: 'contest' };

  it('creates a submission and enqueues it with the contest priority context', async () => {
    await start();
    const res = await post('/submissions', valid);
    const body = (await res.json()) as { id: string };
    expect(res.status).toBe(201);
    expect(enqueue).toHaveBeenCalledWith({
      submissionId: body.id,
      judgeVersion: 1,
      attempts: 0,
      context: 'contest',
    });
  });

  it.each([
    ['unknown language', { ...valid, language: 'brainfuck' }],
    ['rejudge context', { ...valid, context: 'rejudge' }],
    ['empty code', { ...valid, code: '' }],
  ])('rejects %s', async (_name, body) => {
    await start();
    expect((await post('/submissions', body)).status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown problem', async () => {
    await start();
    expect((await post('/submissions', { ...valid, problemId: 'nope' })).status).toBe(404);
  });

  it('still returns the id when the enqueue fails', async () => {
    enqueue.mockRejectedValue(new Error('redis down'));
    await start();
    expect((await post('/submissions', valid)).status).toBe(201);
  });

  it('serves an ETag and answers 304 to a matching If-None-Match', async () => {
    await start();
    const path = `/submissions/${KNOWN_ID}`;
    const first = await rawGet(path);
    expect(first.etag).toBeTruthy();
    const second = await rawGet(path, { 'if-none-match': first.etag ?? '' });
    expect(second.status).toBe(304);
  });

  it('rejudges with a bumped version', async () => {
    await start();
    const res = await post(`/submissions/${KNOWN_ID}/rejudge`, {});
    expect(res.status).toBe(202);
    expect(enqueue).toHaveBeenCalledWith({
      submissionId: KNOWN_ID,
      judgeVersion: 2,
      attempts: 0,
      context: 'rejudge',
    });
  });

  it('reports unavailable when a dependency is down', async () => {
    const app = createApp({
      repo: fakeRepo(),
      enqueue,
      checkReady: async () => {
        throw new Error('db down');
      },
      log: createLogger('test', 'silent'),
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await fetch(`${base}/health`)).status).toBe(503);
  });
});
