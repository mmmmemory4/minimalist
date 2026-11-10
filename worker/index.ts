// Cloudflare Worker：静的ファイル（ゲーム画面）は assets から配信し，/api/room/:code/ws だけを部屋（Durable Object）へ渡す

import { ROOM_CODE_RE } from '../src/net/protocol';
export { Room } from './room';
export { SlideRoom } from './slideRoom';
export { OverlayRoom } from './overlayRoom';

export interface Env {
  ROOMS: DurableObjectNamespace;
  SLIDE_ROOMS: DurableObjectNamespace;
  OVERLAY_ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // /api/room/:code/ws は元のゲーム，/api/slide/:code/ws はスライド版，/api/overlay/:code/ws はオーバーレイ版の部屋
    const m = url.pathname.match(/^\/api\/(room|slide|overlay)\/([^/]+)\/ws$/);
    if (m) {
      const code = m[2].toUpperCase();
      if (!ROOM_CODE_RE.test(code)) return new Response('bad room code', { status: 400 });
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      const ns = m[1] === 'overlay' ? env.OVERLAY_ROOMS : m[1] === 'slide' ? env.SLIDE_ROOMS : env.ROOMS;
      return ns.get(ns.idFromName(code)).fetch(request);
    }
    if (url.pathname.startsWith('/api/')) return new Response('not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
