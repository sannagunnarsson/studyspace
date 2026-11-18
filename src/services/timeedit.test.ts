import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBookings, isCovered, normalizeBookings } from './timeedit';

afterEach(() => vi.unstubAllGlobals());

describe('normalizeBookings', () => {
  it('maps seconds from midnight to local times on that day', () => {
    const [b] = normalizeBookings('2026-11-18', [{ room: 'X', startTime: 8 * 3600, endTime: 9.5 * 3600 }]);
    expect(b.roomId).toBe('X');
    expect([b.start.getDate(), b.start.getHours(), b.start.getMinutes()]).toEqual([18, 8, 0]);
    expect([b.end.getHours(), b.end.getMinutes()]).toEqual([9, 30]);
  });
});

describe('fetchBookings', () => {
  it('returns live data when the API answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ bookings: [{ roomId: 'X', start: '2026-11-18T07:00:00Z', end: '2026-11-18T08:00:00Z' }] })));
    const r = await fetchBookings('2026-11-18');
    expect(r.source).toBe('live');
    expect(r.bookings).toHaveLength(1);
    expect(r.bookings[0].start.toISOString()).toBe('2026-11-18T07:00:00.000Z');
  });

  it('marks dates outside the feed coverage as not covered', async () => {
    const coverage = { from: '2026-11-16', to: '2026-12-18' };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ bookings: [], coverage })));
    const inside = await fetchBookings('2026-12-18');
    const outside = await fetchBookings('2026-12-19');
    expect(inside.source === 'live' && inside.covered).toBe(true);
    expect(outside.source === 'live' && outside.covered).toBe(false);
  });

  it("uses the server's covered flag when given (gaps between feeds)", async () => {
    const coverage = { from: '2026-11-16', to: '2027-01-15' };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ bookings: [], coverage, covered: false })));
    const r = await fetchBookings('2026-12-25');
    expect(r.source === 'live' && r.covered).toBe(false);
  });

  it('treats a missing coverage as covered', () => {
    expect(isCovered('2030-01-01', null)).toBe(true);
  });

  it('shows the proxy error message in demo mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'TIMEEDIT_ICS_URL is not set in .env.local' }, { status: 503 })));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await fetchBookings('2026-11-18');
    expect(r.source === 'demo' && r.error).toBe('TIMEEDIT_ICS_URL is not set in .env.local');
  });

  it('marks fallback data as demo with the error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await fetchBookings('2026-11-18');
    expect(r.source).toBe('demo');
    if (r.source === 'demo') expect(r.error).toContain('404');
  });
});
