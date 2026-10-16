import { merchantScope } from '@/lib/auth/context';
import { realtimeHub, type SystemEvent } from '@/lib/realtime/hub';
import { sessionUser, withMerchant } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const GET = withMerchant(async (req, _context, user) => {
  const encoder = new TextEncoder();
  const channel = `system_event:${merchantScope().mode}:${user.id}`;
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval>;
      const close = () => {
        if (closed) return;
        closed = true;
        realtimeHub.off(channel, listener);
        clearInterval(heartbeat);
        req.signal.removeEventListener('abort', close);
        try { controller.close(); } catch {}
      };
      const send = (text: string) => {
        // Revocation and expiry apply to open streams as well as new requests.
        if (closed) return;
        if (sessionUser(req)?.id !== user.id) { close(); return; }
        try { controller.enqueue(encoder.encode(text)); } catch { close(); }
      };
      const listener = (event: SystemEvent) => send(`data: ${JSON.stringify(event)}\n\n`);
      realtimeHub.on(channel, listener);
      heartbeat = setInterval(() => send(': ping\n\n'), 20000);
      cleanup = close;
      req.signal.addEventListener('abort', close, { once: true });
      if (req.signal.aborted) close();
      else send(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() })}\n\n`);
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' } });
});
