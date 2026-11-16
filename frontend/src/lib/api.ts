import type {
  Bootstrap,
  CompletedSale,
  DisplayAsset,
  OpenTicket,
  PosClient,
  PosUser,
  Product,
  Promotion,
} from '../types';

export interface PosSettings {
  baseUrl: string;
  clientToken: string;
  mysqlUrl: string;
  autoPrint: boolean;
  openDisplayOnStart: boolean;
}

const SETTINGS_KEY = 'workapos.settings.v1';

const defaultSettings: PosSettings = {
  baseUrl: (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, '') || 'http://127.0.0.1:8080',
  clientToken: (import.meta.env.VITE_CLIENT_TOKEN as string | undefined) || '',
  mysqlUrl: (import.meta.env.VITE_MYSQL_URL as string | undefined) || 'mysql://root:root@127.0.0.1:3306/workapos_pos',
  autoPrint: true,
  openDisplayOnStart: true,
};

export function loadSettings(): PosSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...defaultSettings };
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<PosSettings>) };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(patch: Partial<PosSettings>): PosSettings {
  const next = { ...loadSettings(), ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export function apiBase(): string {
  return loadSettings().baseUrl.replace(/\/+$/, '');
}

export function absoluteUrl(path?: string | null): string {
  if (!path) return '';
  if (/^https?:\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:')) return path;
  return `${apiBase()}${path.startsWith('/') ? '' : '/'}${path}`;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string;
  baseUrl?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const settings = loadSettings();
  const base = (options.baseUrl || settings.baseUrl).replace(/\/+$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);
  try {
    const response = await fetch(`${base}${path}`, {
      method: options.method || 'GET',
      headers: {
        'content-type': 'application/json',
        'x-client-token': options.token || settings.clientToken,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { error: text };
    }
    if (!response.ok) {
      const message = (payload as { error?: string } | null)?.error || `Server menolak permintaan (${response.status}).`;
      throw new ApiError(message, response.status);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('Server tidak merespons. Periksa koneksi.');
    }
    throw new ApiError(error instanceof Error ? error.message : 'Koneksi ke server gagal.');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

function asNumber(value: unknown, fallback = 0): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function asBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeProduct(raw: Product): Product {
  return {
    ...raw,
    price_cents: asNumber(raw.price_cents),
    sort_order: asNumber(raw.sort_order),
  };
}

function normalizePromotion(raw: Promotion): Promotion {
  return {
    ...raw,
    value: asNumber(raw.value),
    min_subtotal_cents: asNumber(raw.min_subtotal_cents),
    max_discount_cents: raw.max_discount_cents === null || raw.max_discount_cents === undefined
      ? null
      : asNumber(raw.max_discount_cents),
    target_ids: asStringArray(raw.target_ids),
    auto_apply: asBool(raw.auto_apply),
  };
}

export function normalizeUser(raw: PosUser): PosUser {
  return {
    ...raw,
    is_admin: asBool(raw.is_admin),
    permissions: asStringArray(raw.permissions),
  };
}

export function normalizeBootstrap(raw: Bootstrap): Bootstrap {
  return {
    ...raw,
    client: {
      ...raw.client,
      second_display: asBool(raw.client.second_display),
      slideshow_interval_seconds: asNumber(raw.client.slideshow_interval_seconds, 8),
      settings: asObject(raw.client.settings),
    } as PosClient,
    brand: {
      ...raw.brand,
      tax_rate: asNumber(raw.brand.tax_rate),
      service_charge_rate: asNumber(raw.brand.service_charge_rate),
    },
    products: (raw.products || []).map(normalizeProduct),
    promotions: (raw.promotions || []).map(normalizePromotion),
    users: (raw.users || []).map(normalizeUser),
    payment_types: (raw.payment_types || []).map((type) => ({
      ...type,
      requires_reference: asBool(type.requires_reference),
      open_drawer: asBool(type.open_drawer),
      surcharge_rate: asNumber(type.surcharge_rate),
      sort_order: asNumber(type.sort_order),
    })),
    printers: (raw.printers || []).map((printer) => ({
      ...printer,
      port: asNumber(printer.port, 9100),
      paper_width: asNumber(printer.paper_width, 80),
    })),
    display_assets: (raw.display_assets || []).map((asset: DisplayAsset) => ({
      ...asset,
      size_bytes: asNumber(asset.size_bytes),
      sort_order: asNumber(asset.sort_order),
      url: absoluteUrl(asset.url || asset.file_path),
    })),
  };
}

export async function fetchBootstrap(): Promise<Bootstrap> {
  const raw = await apiRequest<Bootstrap>('/api/pos/bootstrap');
  return normalizeBootstrap(raw);
}

export async function fetchAssets(): Promise<DisplayAsset[]> {
  const raw = await apiRequest<{ data: DisplayAsset[] }>('/api/pos/assets');
  return (raw.data || []).map((asset) => ({
    ...asset,
    url: absoluteUrl(asset.url || asset.file_path),
  }));
}

export async function posLogin(nik: string, pin: string): Promise<{ user: PosUser; client: PosClient }> {
  const raw = await apiRequest<{ user: PosUser; client: PosClient }>('/api/pos/login', {
    method: 'POST',
    body: { nik, pin },
  });
  return {
    user: normalizeUser(raw.user),
    client: {
      ...raw.client,
      second_display: asBool(raw.client.second_display),
      slideshow_interval_seconds: asNumber(raw.client.slideshow_interval_seconds, 8),
    },
  };
}

export async function heartbeat(appVersion = '0.1.0'): Promise<void> {
  await apiRequest('/api/pos/heartbeat', {
    method: 'POST',
    body: { app_version: appVersion },
    timeoutMs: 5000,
  });
}

export async function submitSale(sale: CompletedSale): Promise<{ ok: boolean; duplicate?: boolean; id?: string; bill_no?: string }> {
  return apiRequest('/api/pos/sales', { method: 'POST', body: { sale } });
}

export async function syncSales(sales: CompletedSale[]): Promise<{ data: Array<{ client_bill_id?: string; bill_no: string; ok: boolean; result?: unknown; error?: string }> }> {
  return apiRequest('/api/pos/sales/sync', { method: 'POST', body: { sales } });
}

export async function fetchTickets(status = 'open'): Promise<OpenTicket[]> {
  const raw = await apiRequest<{ data: OpenTicket[] }>(`/api/pos/tickets?status=${encodeURIComponent(status)}`);
  return (raw.data || []).map((ticket) => ({
    ...ticket,
    subtotal_cents: asNumber(ticket.subtotal_cents),
    items: (ticket.items || []).map((item) => ({
      ...item,
      qty: asNumber(item.qty, 1),
      unit_price_cents: asNumber(item.unit_price_cents),
      total_cents: asNumber(item.total_cents),
    })),
  }));
}

export async function createTicket(payload: {
  ticket_no?: string;
  user_id?: string;
  user_name: string;
  table_id?: string | null;
  table_name: string;
  sales_mode_id?: string | null;
  sales_mode_name: string;
  customer_name: string;
  note: string;
  items: Array<{
    product_id?: string | null;
    sku: string;
    name: string;
    qty: number;
    unit_price_cents: number;
    total_cents: number;
    note: string;
  }>;
}): Promise<{ ok: boolean; id: string; ticket_no: string }> {
  return apiRequest('/api/pos/tickets', { method: 'POST', body: payload });
}

export async function claimTicket(id: string, user: PosUser): Promise<void> {
  await apiRequest(`/api/pos/tickets/${id}/claim`, {
    method: 'POST',
    body: { user_id: user.id, user_name: user.name },
  });
}

export async function cancelTicket(id: string): Promise<void> {
  await apiRequest(`/api/pos/tickets/${id}/cancel`, { method: 'POST', body: {} });
}

export async function ackCommand(commandId: string, ok: boolean): Promise<void> {
  await apiRequest(`/api/pos/commands/${commandId}/ack`, {
    method: 'POST',
    body: { ok },
    timeoutMs: 5000,
  });
}

export async function checkHealth(baseUrl?: string): Promise<{ ok: boolean; version?: string; time?: string }> {
  const raw = await apiRequest<{ ok: boolean; version?: string; time?: string }>('/health', {
    baseUrl,
    timeoutMs: 6000,
  });
  return raw;
}
