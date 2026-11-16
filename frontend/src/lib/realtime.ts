import type { PosUser } from '../types';
import { apiBase, loadSettings } from './api';

export type RealtimeStatus = 'offline' | 'connecting' | 'online';

export interface RealtimeEvent {
  kind: string;
  client_id?: string | null;
  data?: Record<string, unknown>;
  at?: string;
}

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let heartbeatTimer: number | null = null;
let manualClose = false;

export function connectRealtime(
  handlers: {
    onEvent: (event: RealtimeEvent) => void;
    onStatus: (status: RealtimeStatus) => void;
  },
): () => void {
  disconnectRealtime();
  manualClose = false;

  const open = () => {
    const settings = loadSettings();
    if (!settings.clientToken) {
      handlers.onStatus('offline');
      return;
    }
    handlers.onStatus('connecting');
    const wsBase = apiBase().replace(/^http/i, 'ws').replace(/\/+$/, '');
    try {
      socket = new WebSocket(`${wsBase}/ws/pos?token=${encodeURIComponent(settings.clientToken)}`);
    } catch {
      handlers.onStatus('offline');
      scheduleReconnect(open, handlers);
      return;
    }

    socket.onopen = () => {
      handlers.onStatus('online');
      if (heartbeatTimer) window.clearInterval(heartbeatTimer);
      heartbeatTimer = window.setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ kind: 'heartbeat', at: new Date().toISOString() }));
        }
      }, 20_000);
    };

    socket.onmessage = (message) => {
      try {
        const parsed = JSON.parse(String(message.data)) as RealtimeEvent;
        if (parsed.kind) handlers.onEvent(parsed);
      } catch {
        /* ignore malformed frames */
      }
    };

    socket.onerror = () => {
      handlers.onStatus('offline');
    };

    socket.onclose = () => {
      handlers.onStatus('offline');
      if (heartbeatTimer) window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      socket = null;
      if (!manualClose) scheduleReconnect(open, handlers);
    };
  };

  open();
  return disconnectRealtime;
}

function scheduleReconnect(
  open: () => void,
  handlers: { onStatus: (status: RealtimeStatus) => void },
): void {
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  handlers.onStatus('connecting');
  reconnectTimer = window.setTimeout(open, 4500);
}

export function disconnectRealtime(): void {
  manualClose = true;
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  if (heartbeatTimer) window.clearInterval(heartbeatTimer);
  reconnectTimer = null;
  heartbeatTimer = null;
  try {
    socket?.close();
  } catch {
    /* ignore */
  }
  socket = null;
}

export function sendRealtime(payload: Record<string, unknown>): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

export function acknowledgeRealtimeCommand(commandId: string, ok: boolean): void {
  sendRealtime({ kind: 'command_ack', command_id: commandId, ok });
}

export function canPay(user: PosUser | null, orderStation: boolean): boolean {
  if (!user || orderStation) return false;
  return user.is_admin || user.permissions.includes('pos.payment');
}

export function canDiscount(user: PosUser | null, orderStation: boolean): boolean {
  if (!user || orderStation) return false;
  return user.is_admin || user.permissions.includes('pos.discount');
}

export function canVoid(user: PosUser | null, orderStation: boolean): boolean {
  if (!user) return false;
  return user.is_admin || user.permissions.includes('pos.void');
}
