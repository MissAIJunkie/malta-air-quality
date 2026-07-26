/**
 * The cron authorisation boundary.
 *
 * These endpoints mutate stored data and send email, so "who may invoke them" is
 * the one behaviour here worth pinning down in a test: a regression that let an
 * unauthenticated caller through would be silent, and would stay silent until
 * somebody noticed the traffic.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { resetEnvCache } from '@/config/env';
import { isAuthorisedScheduler, runCronJob } from '../shared';

const SECRET = 'cron-secret-value';

function withSecret(secret: string | undefined) {
  if (secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = secret;
  resetEnvCache();
}

function request(authorization?: string): Request {
  const headers = new Headers();
  if (authorization) headers.set('authorization', authorization);
  return new Request('https://maqua.app/api/cron/cleanup', { headers });
}

afterEach(() => {
  withSecret(undefined);
});

describe('isAuthorisedScheduler', () => {
  it('accepts the scheduler bearer token', () => {
    withSecret(SECRET);
    expect(isAuthorisedScheduler(request(`Bearer ${SECRET}`))).toBe(true);
  });

  it('rejects a missing, malformed or incorrect credential', () => {
    withSecret(SECRET);
    expect(isAuthorisedScheduler(request())).toBe(false);
    expect(isAuthorisedScheduler(request(SECRET))).toBe(false);
    expect(isAuthorisedScheduler(request(`Bearer ${SECRET}x`))).toBe(false);
    expect(isAuthorisedScheduler(request('Bearer x'))).toBe(false);
    expect(isAuthorisedScheduler(request(`Basic ${SECRET}`))).toBe(false);
  });

  it('refuses everything when no secret is configured', () => {
    // The opposite of how the optional subsystems behave, and deliberately so:
    // an unconfigured secret cannot mean "let anybody run the job".
    withSecret(undefined);
    expect(isAuthorisedScheduler(request())).toBe(false);
    expect(isAuthorisedScheduler(request('Bearer '))).toBe(false);
    expect(isAuthorisedScheduler(request('Bearer undefined'))).toBe(false);
  });

  it('is not fooled by a header of the same length as the expected value', () => {
    withSecret(SECRET);
    const sameLength = `Bearer ${'x'.repeat(SECRET.length)}`;
    expect(sameLength.length).toBe(`Bearer ${SECRET}`.length);
    expect(isAuthorisedScheduler(request(sameLength))).toBe(false);
  });
});

describe('runCronJob', () => {
  const options = { job: 'test-job', lockKey: 'v1:lock:test', lockTtlSeconds: 30 };

  it('does not run the job at all when unauthorised', async () => {
    withSecret(SECRET);
    let ran = false;

    const response = await runCronJob(request(), options, async () => {
      ran = true;
      return {};
    });

    expect(response.status).toBe(401);
    expect(ran).toBe(false);
  });

  it('reports a completed run', async () => {
    withSecret(SECRET);

    const response = await runCronJob(request(`Bearer ${SECRET}`), options, async () => ({
      detail: { rowsWritten: 3 },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');

    const body = await response.json();
    expect(body.job).toBe('test-job');
    expect(body.status).toBe('completed');
    expect(body.detail).toEqual({ rowsWritten: 3 });
    expect(typeof body.startedAt).toBe('string');
    expect(typeof body.durationMs).toBe('number');
  });

  it('reports a deliberate no-op as skipped rather than as success', async () => {
    withSecret(SECRET);

    const response = await runCronJob(request(`Bearer ${SECRET}`), options, async () => ({
      skipped: 'No database is configured.',
    }));

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe('skipped');
    expect(body.note).toBe('No database is configured.');
  });

  it('answers non-2xx when the job throws, so the platform records a failure', async () => {
    withSecret(SECRET);

    const response = await runCronJob(request(`Bearer ${SECRET}`), options, async () => {
      throw new Error('upstream exploded');
    });

    expect(response.status).toBe(500);

    // The internal message must not reach the caller.
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain('upstream exploded');
  });
});
