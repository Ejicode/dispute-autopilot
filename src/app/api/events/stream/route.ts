import { NextRequest } from 'next/server';
import { realtimeHub, SystemEvent } from '@/lib/realtime/hub';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection packet
      const initMessage = `data: ${JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() })}\n\n`;
      controller.enqueue(encoder.encode(initMessage));

      const listener = (event: SystemEvent) => {
        try {
          const payload = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch (err) {
          console.error('Error streaming event:', err);
        }
      };

      realtimeHub.on('system_event', listener);

      // Heartbeat every 20 seconds to prevent proxy timeout
      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          clearInterval(interval);
        }
      }, 20000);

      req.signal.addEventListener('abort', () => {
        realtimeHub.off('system_event', listener);
        clearInterval(interval);
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
