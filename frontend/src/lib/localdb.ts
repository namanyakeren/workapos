import type { Bootstrap, CompletedSale } from '../types';

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && Boolean((window as TauriWindow).__TAURI_INTERNALS__);
}

let lastError = '';
let connected = false;
let currentUrl = '';

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('Bukan aplikasi Tauri.');
  const api = await import('@tauri-apps/api/core');
  return api.invoke<T>(command, args);
}

export async function initLocalDb(url: string): Promise<{ ok: boolean; message: string }> {
  currentUrl = url;
  if (!isTauri()) {
    lastError = 'Mode browser: cache memakai IndexedDB.';
    return { ok: false, message: lastError };
  }
  try {
    const result = await invoke<{ ok: boolean; message: string }>('local_db_init', { url });
    connected = result.ok;
    lastError = result.ok ? '' : result.message;
    return result;
  } catch (error) {
    connected = false;
    lastError = error instanceof Error ? error.message : String(error);
    return { ok: false, message: lastError };
  }
}

export async function mirrorBootstrap(bootstrap: Bootstrap): Promise<void> {
  if (!isTauri() || !connected) return;
  try {
    await invoke('local_db_save_bootstrap', { payload: JSON.stringify(bootstrap) });
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
}

export async function mirrorSale(sale: CompletedSale): Promise<void> {
  if (!isTauri() || !connected) return;
  try {
    await invoke('local_db_upsert_sale', { payload: JSON.stringify(sale) });
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
}

export async function mirrorSaleSynced(clientBillId: string): Promise<void> {
  if (!isTauri() || !connected) return;
  try {
    await invoke('local_db_mark_synced', { clientBillId });
  } catch {
    /* offline mirror is best-effort */
  }
}

export async function mirrorTicket(payload: string): Promise<void> {
  if (!isTauri() || !connected) return;
  try {
    await invoke('local_db_upsert_ticket', { payload });
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
}

export async function mirrorTicketSynced(ticketNo: string): Promise<void> {
  if (!isTauri() || !connected) return;
  try {
    await invoke('local_db_mark_ticket_synced', { ticketNo });
  } catch {
    /* best-effort */
  }
}

export async function localDbInfo(): Promise<{ connected: boolean; url: string; error: string; pending?: number }> {
  if (!isTauri()) {
    return { connected: false, url: currentUrl, error: 'Mode browser (IndexedDB)' };
  }
  try {
    const info = await invoke<{ ok: boolean; error?: string; pending?: number }>('local_db_info');
    return {
      connected: Boolean(info.ok),
      url: currentUrl,
      error: info.error || '',
      pending: info.pending,
    };
  } catch (error) {
    return {
      connected: false,
      url: currentUrl,
      error: error instanceof Error ? error.message : String(error),
      lastError,
    } as { connected: boolean; url: string; error: string };
  }
}

export function localDbLastError(): string {
  return lastError;
}
