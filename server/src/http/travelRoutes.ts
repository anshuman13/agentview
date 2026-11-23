import { addReceipt, deleteReceipt, deleteTrip, receiptFile, saveTrip, scanCalendar, setCheck, setHome, travelData, updateReceipt } from '../integrations/travel.js';
import { receiptsCsv } from '../../../shared/travel.js';
import { entry, type Ctx, type Entry } from './routeTypes.js';

// Work trips and receipts (Travel page on web and phone).
export function travelRoutes(): Record<string, Entry<Ctx>> {
  return {
    'GET /api/travel': entry(() => travelData()),
    'POST /api/travel/trip': entry(({ body }) => saveTrip(body), true),
    'POST /api/travel/check': entry(({ body }) => setCheck(body), true),
    'POST /api/travel/home': entry(({ body }) => setHome(body.home), true),
    'POST /api/travel/scan': entry(() => scanCalendar(), true),
    'POST /api/travel/trip/delete': entry(({ body }) => deleteTrip(String(body.id ?? '')), true),
    'POST /api/travel/receipt': entry(({ req, url }) => addReceipt(req, url.searchParams.get('trip') ?? '', url.searchParams.get('name') ?? '')),
    'POST /api/travel/receipt/update': entry(({ body }) => updateReceipt(body), true),
    'POST /api/travel/receipt/delete': entry(({ body }) => deleteReceipt(String(body.id ?? '')), true),
    'GET /api/travel/file': entry(async ({ url }) => {
      const f = await receiptFile(url.searchParams.get('id') ?? '');
      return new Response(f.body, { headers: {
        'content-type': f.mime, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
        'content-disposition': `inline; filename="${f.name}"`,
      } });
    }),
    'GET /api/travel/export': entry(async ({ url }) => {
      const trip = url.searchParams.get('trip') ?? '';
      const d = await travelData();
      const name = (d.trips.find((t) => t.id === trip)?.name ?? 'trip').replace(/[^\w-]+/g, '-');
      return new Response(receiptsCsv(d.receipts.filter((r) => r.tripId === trip)), { headers: {
        'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}-receipts.csv"`,
      } });
    }),
  };
}
