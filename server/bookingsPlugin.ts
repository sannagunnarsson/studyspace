import type { Plugin } from 'vite';
import {
  feedCoverage,
  isDayCovered,
  mergeBookings,
  overlapping,
  parseIcs,
  spanOf,
  toRoomBookings,
  type Coverage,
  type RoomBooking,
} from './ics.ts';

const CACHE_MS = 15 * 60 * 1000; // TimeEdit itself says X-PUBLISHED-TTL:PT20M

/** TIMEEDIT_ICS_URL may hold several links, separated by spaces, commas or new lines. */
export function parseFeedUrls(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((u) => u.replace(/^webcal:/i, 'https:'));
}

/**
 * Dev-server endpoint: GET /api/bookings?date=YYYY-MM-DD
 * Fetches the TimeEdit subscription feeds server-side (the URLs are personal
 * access links and must never reach the browser), merges and caches them, and
 * returns only { roomId, start, end } for that day.
 */
export function bookingsPlugin(icsUrls: string | undefined, roomIds: string[]): Plugin {
  const urls = parseFeedUrls(icsUrls);
  type Feed = { bookings: RoomBooking[]; ranges: Coverage[] };
  let cache: { at: number; feed: Feed } | null = null;

  async function fetchOne(url: string) {
    const res = await fetch(url, { headers: { 'User-Agent': 'StudySpace (dev)' } });
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

  return {
    name: 'studyspace-bookings',
    configureServer(server) {
      server.middlewares.use('/api/bookings', async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };

        const date = new URL(req.url ?? '', 'http://x').searchParams.get('date') ?? '';
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
        if (!m) return send(400, { error: 'date must be YYYY-MM-DD' });
        if (urls.length === 0) return send(503, { error: 'TIMEEDIT_ICS_URL is not set in .env.local' });

        try {
          // Day boundaries in the server's local time (Europe/Stockholm in practice).
          const from = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
          const to = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1);
          const { bookings, ranges } = await load();
          send(200, {
            bookings: overlapping(bookings, from, to),
            coverage: spanOf(ranges),
            // Per-feed check, so a gap between two feeds isn't shown as "free".
            covered: ranges.length === 0 || isDayCovered(date, ranges),
          });
        } catch (error) {
          // Never echo the URLs: they are secrets.
          send(502, { error: error instanceof Error ? error.message : 'Feed failed' });
        }
      });
    },
  };
}
