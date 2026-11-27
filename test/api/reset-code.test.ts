// The self-service reset code is shown on screen only on a developer's own machine. A deployed UAT/staging copy is
// public, so returning it there would let anyone who knows a staff e-mail take over that account.
import { describe, it, expect } from 'vitest';
import { setup, USERS } from '../helpers/app';

const request = async (APP_ENV: string) => {
  const t = await setup({ APP_ENV } as any);
  return t.call('POST', '/api/v1/auth/forgot-password/request', { body: { email: USERS.admin } });
};

describe('forgot-password reset code', () => {
  it('is never returned on staging, test or production', async () => {
    for (const env of ['staging', 'test', 'production']) {
      const r = await request(env);
      expect(r.status, env).toBe(200);
      expect(r.body.devCode, env).toBeUndefined();
    }
  });

  it('is returned only in local development', async () => {
    const r = await request('development');
    expect(r.status).toBe(200);
    expect(r.body.devCode).toMatch(/^\d{6}$/);
  });
});
