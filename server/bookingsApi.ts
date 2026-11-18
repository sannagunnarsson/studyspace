import {
  feedCoverage,
  isDayCovered,
  mergeBookings,
  overlapping,
  parseIcs,
  spanOf,
  startOfDay,
  toRoomBookings,
  type Coverage,
  type RoomBooking,
} from './ics.js';

const CACHE_MS = 15 * 60 * 1000; // TimeEdit itself says X-PUBLISHED-TTL:PT20M

/** TIMEEDIT_ICS_URL may hold several links, separated by spaces, commas or new lines. */
export function parseFeedUrls(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((u) => u.replace(/^webcal:/i, 'https:'));
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

/**
 * GET /api/bookings?date=YYYY-MM-DD, independent of the server it runs on
 * (Vite dev server locally, a serverless function on Vercel).
 * Fetches the TimeEdit subscription feeds server-side (the URLs are personal
 * access links and must never reach the browser), merges and caches them, and
 * returns only { roomId, start, end } for that day.
 */
export function createBookingsHandler(icsUrls: string | undefined, roomIds: string[], whereToSet: string) {
  const urls = parseFeedUrls(icsUrls);
  type Feed = { bookings: RoomBooking[]; ranges: Coverage[] };
  let cache: { at: number; feed: Feed } | null = null;

  async function fetchOne(url: string) {
    const res = await fetch(url, { headers: { 'User-Agent': 'StudySpace' } });
    if (!res.ok) throw new Error(`TimeEdit feed responded ${res.status}`);
    const events = parseIcs(await res.text());
    return { bookings: toRoomBookings(events, roomIds), coverage: feedCoverage(events) };
  }

  async function load(): Promise<Feed> {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.feed;
    const results = await Promise.allSettled(urls.map(fetchOne));
    const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const failed = results.filter((r) => r.status === 'rejected');
    if (ok.length === 0) throw (failed[0] as PromiseRejectedResult).reason;
    if (failed.length > 0) console.warn(`[bookings] ${failed.length} of ${urls.length} TimeEdit feeds failed`);
    const feed = {
      bookings: mergeBookings(ok.map((f) => f.bookings)),
      ranges: ok.flatMap((f) => (f.coverage ? [f.coverage] : [])),
    };
    cache = { at: Date.now(), feed };
    return feed;
  }

  return async function handle(date: string | null): Promise<ApiResponse> {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { status: 400, body: { error: 'date must be YYYY-MM-DD' } };
    if (urls.length === 0) return { status: 503, body: { error: `TIMEEDIT_ICS_URL is not set in ${whereToSet}` } };
    try {
      const { bookings, ranges } = await load();
      return {
        status: 200,
        body: {
          bookings: overlapping(bookings, startOfDay(date), startOfDay(date, 1)),
          coverage: spanOf(ranges),
          // Per-feed check, so a gap between two feeds isn't shown as "free".
          covered: ranges.length === 0 || isDayCovered(date, ranges),
        },
      };
    } catch (error) {
      // Never echo the URLs: they are secrets.
      return { status: 502, body: { error: error instanceof Error ? error.message : 'Feed failed' } };
    }
  };
}
