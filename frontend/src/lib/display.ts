import type { DisplayAsset } from '../types';
import { isTauri } from './localdb';

const CHANNEL_NAME = 'workapos.display.v1';

export interface DisplayPaymentItem {
  name: string;
  qty: number;
  total_cents: number;
  note: string;
}

export interface DisplayState {
  type: 'payment' | 'slideshow';
  brand_name: string;
  outlet_name: string;
  customer_name: string;
  table_name: string;
  items: DisplayPaymentItem[];
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  change_cents: number;
  payment_name: string;
  updated_at: string;
}

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

export function postDisplayState(state: DisplayState): void {
  getChannel()?.postMessage(state);
}

export function subscribeDisplay(listener: (state: DisplayState) => void): () => void {
  const bus = getChannel();
  if (!bus) return () => undefined;
  const handler = (event: MessageEvent<DisplayState>) => listener(event.data);
  bus.addEventListener('message', handler);
  return () => bus.removeEventListener('message', handler);
}

export function isSecondDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('display') === '1';
}

export async function openSecondDisplay(): Promise<{ ok: boolean; message: string }> {
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_second_display');
      return { ok: true, message: 'Layar kedua dibuka.' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }
  const url = `${window.location.origin}${window.location.pathname}?display=1`;
  const popup = window.open(url, 'workapos-second-display', 'popup=yes,width=1280,height=720');
  return popup
    ? { ok: true, message: 'Layar kedua dibuka di jendela baru.' }
    : { ok: false, message: 'Popup diblokir browser. Izinkan popup untuk layar kedua.' };
}

export async function closeSecondDisplay(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('close_second_display');
  } catch {
    /* no window open */
  }
}

export interface CachedMedia {
  id: string;
  name: string;
  objectUrl: string;
}

const CACHE_NAME = 'workapos-media-v1';

export async function resolveDisplayMedia(assets: DisplayAsset[]): Promise<{ media: CachedMedia[]; revoke: () => void }> {
  const created: string[] = [];
  const media: CachedMedia[] = [];
  const liveUrls = new Set(assets.map((asset) => asset.url));

  if (!('caches' in window)) {
    return {
      media: assets.map((asset) => ({ id: asset.id, name: asset.name, objectUrl: asset.url })),
      revoke: () => undefined,
    };
  }

  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE_NAME);
  } catch {
    cache = null;
  }

  for (const asset of assets) {
    try {
      let response = cache ? await cache.match(asset.url) : undefined;
      if (!response) {
        const fetched = await fetch(asset.url, { cache: 'no-cache' });
        if (!fetched.ok) continue;
        response = fetched.clone();
        if (cache) await cache.put(asset.url, fetched.clone()).catch(() => undefined);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      created.push(objectUrl);
      media.push({ id: asset.id, name: asset.name, objectUrl });
    } catch {
      // Offline and not cached yet: skip this asset, keep the rest running.
    }
  }

  // Purge images removed in HQ so a deactivated banner disappears locally.
  if (cache) {
    try {
      const keys = await cache.keys();
      await Promise.all(keys.map(async (request) => {
        if (!liveUrls.has(request.url)) await cache!.delete(request);
      }));
    } catch {
      /* best-effort cleanup */
    }
  }

  return {
    media,
    revoke: () => created.forEach((url) => URL.revokeObjectURL(url)),
  };
}
