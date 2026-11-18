import { describe, expect, it } from 'vitest';
import { createBookingsHandler } from './bookingsApi.js';
import { startOfDay } from './ics.js';

describe('startOfDay (Swedish time, independent of server time zone)', () => {
  it('handles winter and summer time', () => {
    expect(startOfDay('2026-11-18').toISOString()).toBe('2026-11-17T23:00:00.000Z');
    expect(startOfDay('2026-07-01').toISOString()).toBe('2026-06-30T22:00:00.000Z');
  });
  it('handles the DST switch day', () => {
    expect(startOfDay('2026-03-29').toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(startOfDay('2026-03-29', 1).toISOString()).toBe('2026-03-29T22:00:00.000Z');
  });
});

describe('createBookingsHandler', () => {
  it('rejects a bad date', async () => {
    const handle = createBookingsHandler('https://x.ics', ['1'], 'env');
    expect((await handle('18/11')).status).toBe(400);
    expect((await handle(null)).status).toBe(400);
  });
  it('says where to set a missing feed URL', async () => {
    const res = await createBookingsHandler(undefined, ['1'], 'the Vercel project settings')('2026-11-18');
    expect(res).toEqual({ status: 503, body: { error: 'TIMEEDIT_ICS_URL is not set in the Vercel project settings' } });
  });
});
