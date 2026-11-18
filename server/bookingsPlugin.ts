import type { Plugin } from 'vite';
import { createBookingsHandler } from './bookingsApi.js';

export { parseFeedUrls } from './bookingsApi.js';

/** Serves /api/bookings from the Vite dev server (and `vite preview`). */
export function bookingsPlugin(icsUrls: string | undefined, roomIds: string[]): Plugin {
  const handle = createBookingsHandler(icsUrls, roomIds, '.env.local');
  const middleware = async (req: { url?: string }, res: import('node:http').ServerResponse) => {
    const { status, body } = await handle(new URL(req.url ?? '', 'http://x').searchParams.get('date'));
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };
  return {
    name: 'studyspace-bookings',
    configureServer(server) {
      server.middlewares.use('/api/bookings', middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/bookings', middleware);
    },
  };
}
