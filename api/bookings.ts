// Vercel serverless function: the production version of /api/bookings.
// Set TIMEEDIT_ICS_URL under Project → Settings → Environment Variables.
import rooms from '../src/data/rooms.json' with { type: 'json' };
import { createBookingsHandler } from '../server/bookingsApi.js';

const handle = createBookingsHandler(
  process.env.TIMEEDIT_ICS_URL,
  rooms.map((r) => r.id),
  'the Vercel project settings',
);

export async function GET(request: Request): Promise<Response> {
  const { status, body } = await handle(new URL(request.url).searchParams.get('date'));
  return Response.json(body, {
    status,
    // Let Vercel's CDN reuse an answer for 5 min; bookings change rarely.
    headers: status === 200 ? { 'Cache-Control': 's-maxage=300, stale-while-revalidate=900' } : {},
  });
}
