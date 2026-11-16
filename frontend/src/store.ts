import { create } from 'zustand';
import { compare } from 'bcryptjs';
import type {
  Bootstrap,
  CartLine,
  CompletedSale,
  FloorTable,
  OpenTicket,
  PaymentEntry,
  PaymentType,
  PosUser,
  Printer,
  Promotion,
  SalesMode,
  TicketReceipt,
  Totals,
} from './types';
import {
  ApiError,
  ackCommand,
  apiRequest,
  claimTicket as apiClaimTicket,
  createTicket,
  fetchBootstrap,
  fetchTickets,
  heartbeat,
  loadSettings,
  posLogin,
  saveSettings,
  submitSale,
  syncSales,
  type PosSettings as SettingsType,
} from './lib/api';
import { computeTotals, bestAutoPromo, subtotalOf, promotionDiscount } from './lib/pricing';
import { canDiscount, canPay, connectRealtime, disconnectRealtime, acknowledgeRealtimeCommand, type RealtimeEvent, type RealtimeStatus } from './lib/realtime';
import { openSecondDisplay, postDisplayState, closeSecondDisplay } from './lib/display';
import {
  cacheBootstrap,
  clearOfflineData,
  dequeueSale,
  dequeueTicket,
  lastSale,
  pendingCount,
  queueSale,
  queueTicket,
  queuedSales,
  queuedTickets,
  readBootstrapCache,
  setLastSale,
  type QueuedTicket,
} from './lib/storage';
import { initLocalDb, localDbInfo, isTauri } from './lib/localdb';
import { findPrinter, openCashDrawer, printKitchen, printReceipt, printTicket, printTestJob, type PrintResult } from './lib/printer';
import { dateTime, money, uid } from './lib/format';

export type Screen =
  | 'boot'
  | 'login'
  | 'mode'
  | 'table'
  | 'order'
  | 'payment'
  | 'receipt'
  | 'settings'
  | 'locked';

export interface Toast {
  id: string;
  text: string;
  tone: 'success' | 'error' | 'info' | 'warn';
}

interface LocalDbState {
  connected: boolean;
  url: string;
  error: string;
  pending?: number;
}

interface PosStore {
  screen: Screen;
  boot: Bootstrap | null;
  cacheAt: string | null;
  loading: boolean;
  bootError: string;
  online: boolean;
  realtime: RealtimeStatus;
  user: PosUser | null;
  mode: SalesMode | null;
  table: FloorTable | null;
  lines: CartLine[];
  customerName: string;
  note: string;
  promo: Promotion | null;
  manualDiscountCents: number;
  payments: PaymentEntry[];
  lastSale: CompletedSale | null;
  lastTicketReceipt: TicketReceipt | null;
  activeTicket: OpenTicket | null;
  tickets: OpenTicket[];
  ticketsLoading: boolean;
  pending: number;
  syncing: boolean;
  settings: SettingsType;
  localDb: LocalDbState;
  toasts: Toast[];
  displayOpened: boolean;

  init: () => Promise<void>;
  refreshBootstrap: (silent?: boolean) => Promise<void>;
  authenticate: (nik: string, pin: string, keepCart?: boolean) => Promise<{ ok: boolean; message?: string }>;
  unlock: (pin: string) => Promise<{ ok: boolean; message?: string }>;
  logout: () => void;
  lock: () => void;
  selectMode: (mode: SalesMode) => void;
  selectTable: (table: FloorTable | null) => void;
  goOrder: () => void;
  addProduct: (product: CartLine['product'], qty?: number) => void;
  changeQty: (lineId: string, delta: number) => void;
  setQty: (lineId: string, qty: number) => void;
  setLineNote: (lineId: string, note: string) => void;
  removeLine: (lineId: string) => void;
  clearCart: () => void;
  setCustomerName: (value: string) => void;
  setNote: (value: string) => void;
  applyPromotion: (promo: Promotion | null) => void;
  setManualDiscount: (cents: number) => void;
  totals: () => Totals;
  goPayment: () => void;
  backToOrder: () => void;
  addPayment: (type: PaymentType, amountCents: number, reference?: string) => void;
  removePayment: (id: string) => void;
  completePayment: () => Promise<{ ok: boolean; message?: string }>;
  sendOrder: () => Promise<{ ok: boolean; message?: string }>;
  newOrder: () => void;
  refreshTickets: () => Promise<void>;
  startTicket: (ticket: OpenTicket) => Promise<{ ok: boolean; message?: string }>;
  cancelActiveTicket: () => Promise<void>;
  syncNow: () => Promise<{ synced: number; failed: number }>;
  refreshPending: () => Promise<void>;
  broadcastPayment: (totals: Totals, paymentName?: string) => void;
  goSettings: () => void;
  leaveSettings: () => void;
  applySettings: (patch: Partial<SettingsType>) => Promise<void>;
  refreshLocalDb: () => Promise<void>;
  openDisplay: () => Promise<PrintResult>;
  dismissToast: (id: string) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
}

let initialized = false;
let refreshTimer: number | null = null;
let ticketTimer: number | null = null;
let heartbeatTimer: number | null = null;
let wakeLock: { release: () => Promise<void> } | null = null;
let previousScreen: Screen = 'order';

function nowMysql(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function ticketNumber(code: string): string {
  const d = new Date();
  const stamp = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${code}-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function billNumber(code: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${code}-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}

function userAllowedForClient(user: PosUser, boot: Bootstrap): boolean {
  if (user.is_admin) return true;
  if (!user.brand_id && !user.outlet_id) return true;
  if (user.outlet_id) return user.outlet_id === boot.outlet.id;
  return user.brand_id === boot.brand.id;
}

function synthProduct(ticketItem: OpenTicket['items'][number], boot: Bootstrap) {
  const existing = boot.products.find((product) => product.id === ticketItem.product_id);
  if (existing) return { ...existing, price_cents: ticketItem.unit_price_cents };
  return {
    id: ticketItem.product_id || `ticket_${ticketItem.id}`,
    group_id: boot.product_groups[0]?.id || '',
    sku: ticketItem.sku,
    name: ticketItem.name,
    description: '',
    price_cents: ticketItem.unit_price_cents,
    image_url: null,
    color: boot.brand.color,
    emoji: '🍽️',
    sort_order: 0,
  };
}

function receiptFromTicket(ticket: QueuedTicket, boot: Bootstrap, user: PosUser): TicketReceipt {
  return {
    ticket_no: ticket.ticket_no,
    brand: boot.brand,
    outlet: boot.outlet,
    client: boot.client,
    user,
    table_name: ticket.table_name,
    sales_mode_name: ticket.sales_mode_name,
    customer_name: ticket.customer_name,
    note: ticket.note,
    items: ticket.items.map((item, index) => ({
      id: `item_${index}`,
      product_id: item.product_id || null,
      sku: item.sku,
      name: item.name,
      qty: item.qty,
      unit_price_cents: item.unit_price_cents,
      total_cents: item.total_cents,
      note: item.note,
    })),
    subtotal_cents: ticket.items.reduce((sum, item) => sum + item.total_cents, 0),
    created_at: ticket.created_at,
  };
}

function success(message: string): PrintResult {
  return { ok: true, message };
}

export const usePos = create<PosStore>((set, get) => {
  const builtinToast = (text: string, tone: Toast['tone'] = 'info') => {
    const id = uid('toast');
    set((state) => ({ toasts: [...state.toasts, { id, text, tone }] }));
    window.setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    }, 4200);
  };

  const goForUser = (user: PosUser, keepCart: boolean) => {
    const state = get();
    const boot = state.boot;
    if (!boot) return;
    const modes = boot.sales_modes || [];
    if (keepCart && state.lines.length > 0) {
      set({ user, screen: 'order' });
      return;
    }
    if (modes.length > 1) {
      set({ user, screen: 'mode', mode: null, table: null, lines: [], promo: null, manualDiscountCents: 0, payments: [], activeTicket: null });
      return;
    }
    if (modes.length === 1) {
      const mode = modes[0];
      if (mode.template === 'table_service') {
        set({ user, mode, screen: 'table', lines: [], promo: null, manualDiscountCents: 0, payments: [], activeTicket: null });
      } else {
        set({ user, mode, table: null, screen: 'order', lines: [], promo: null, manualDiscountCents: 0, payments: [], activeTicket: null });
      }
      return;
    }
    set({ user, screen: 'order' });
  };

  const offlineVerify = async (nik: string, pin: string): Promise<PosUser> => {
    const boot = get().boot;
    if (!boot) throw new ApiError('Data terminal belum tersedia.');
    const user = boot.users.find((candidate) => candidate.nik === nik.trim());
    if (!user) throw new ApiError('NIK atau PIN tidak sesuai.');
    if (!userAllowedForClient(user, boot)) throw new ApiError('User ini tidak ditempatkan di outlet ini.', 403);
    if (!user.pin_hash) throw new ApiError('PIN belum tersedia offline. Hubungkan ke server.');
    const valid = await compare(pin, user.pin_hash);
    if (!valid) throw new ApiError('PIN tidak sesuai.');
    return user;
  };

  const printAfterPayment = async (sale: CompletedSale) => {
    const state = get();
    if (!state.boot) return;
    const printer = findPrinter(state.boot.printers, 'receipt');
    const kitchen = findPrinter(state.boot.printers, 'kitchen');
    const footer = typeof state.boot.client.settings.receipt_footer === 'string'
      ? state.boot.client.settings.receipt_footer as string
      : 'Terima kasih atas kunjungan Anda';
    if (printer && state.settings.autoPrint) {
      const result = await printReceipt(sale, printer, footer);
      if (!result.ok) state.toast(result.message, 'warn');
    }
    if (kitchen) {
      await printKitchen(sale.bill_no, sale.brand, sale.outlet, {
        table_name: sale.table_name,
        sales_mode: sale.sales_mode_name,
        customer_name: sale.customer_name,
        items: sale.items.map((item) => ({ name: item.name, qty: item.qty, note: item.note })),
        note: sale.note,
      }, kitchen);
    }
    const cash = sale.payments.some((payment) => payment.method === 'cash');
    if (printer && cash) {
      await openCashDrawer(printer);
    }
  };

  const printOrderTicket = async (ticket: TicketReceipt) => {
    const state = get();
    if (!state.boot || !state.settings.autoPrint) return;
    const kitchen = findPrinter(state.boot.printers, 'kitchen');
    if (kitchen) {
      const result = await printTicket(ticket, kitchen);
      if (!result.ok) state.toast(result.message, 'warn');
    }
  };

  const broadcastSlideshow = () => {
    const state = get();
    if (!state.boot) return;
    postDisplayState({
      type: 'slideshow',
      brand_name: state.boot.brand.name,
      outlet_name: state.boot.outlet.name,
      customer_name: '',
      table_name: '',
      items: [],
      subtotal_cents: 0,
      discount_cents: 0,
      total_cents: 0,
      change_cents: 0,
      payment_name: '',
      updated_at: new Date().toISOString(),
    });
  };

  const handleRealtime = async (event: RealtimeEvent) => {
    const state = get();
    if (event.kind === 'hello') {
      set({ realtime: 'online', online: true });
      return;
    }
    if (event.kind === 'ticket.created' || event.kind === 'ticket.paid' || event.kind === 'ticket.cancelled') {
      if (event.kind === 'ticket.created' && state.boot?.client.kind !== 'order_station') {
        state.toast('Order baru masuk dari order station.', 'info');
      }
      void get().refreshTickets();
      return;
    }
    if (event.kind !== 'command') return;
    const data = (event.data || {}) as {
      command_id?: string;
      action?: string;
      payload?: Record<string, unknown>;
    };
    const commandId = data.command_id || '';
    const action = data.action || '';
    const payload = data.payload || {};
    let ok = true;
    let message = 'Perintah dijalankan.';
    try {
      if (action === 'sync') {
        const result = await get().syncNow();
        message = `${result.synced} transaksi tersinkron.`;
      } else if (action === 'reload') {
        await get().refreshBootstrap();
      } else if (action === 'show_message') {
        const text = String(payload.message || payload.text || 'Pesan dari HQ');
        state.toast(text, 'info');
      } else if (action === 'lock') {
        get().lock();
      } else if (action === 'unlock') {
        set({ screen: previousScreen === 'locked' ? 'order' : previousScreen });
      } else if (action === 'test_print') {
        const printer = state.boot ? findPrinter(state.boot.printers, 'receipt') : null;
        if (state.boot && printer) {
          const result = await printTestJob(printer, state.boot.brand, state.boot.outlet);
          ok = result.ok;
          message = result.message;
        } else {
          ok = false;
          message = 'Tidak ada printer penerima.';
        }
      } else if (action === 'open_drawer') {
        const printer = state.boot ? findPrinter(state.boot.printers, 'receipt') : null;
        if (printer) {
          const result = await openCashDrawer(printer);
          ok = result.ok;
          message = result.message;
        }
      } else if (action === 'update_display') {
        broadcastSlideshow();
        if (state.boot?.client.second_display) {
          await openSecondDisplay();
        }
      } else if (action === 'clear_cache') {
        if ('caches' in window) {
          await caches.delete('workapos-media-v1');
        }
        message = 'Cache media dibersihkan.';
      } else if (action === 'shutdown' || action === 'restart_app') {
        ok = false;
        message = 'Aksi daya hanya tersedia di terminal Tauri.';
      }
    } catch (error) {
      ok = false;
      message = error instanceof Error ? error.message : String(error);
    }
    if (commandId) {
      acknowledgeRealtimeCommand(commandId, ok);
    }
    state.toast(message, ok ? 'success' : 'warn');
  };

  const startPolling = () => {
    if (refreshTimer) window.clearInterval(refreshTimer);
    if (ticketTimer) window.clearInterval(ticketTimer);
    if (heartbeatTimer) window.clearInterval(heartbeatTimer);

    refreshTimer = window.setInterval(() => {
      if (navigator.onLine) void get().refreshBootstrap(true);
    }, 5 * 60_000);
    ticketTimer = window.setInterval(() => {
      if (get().boot && get().screen !== 'boot') void get().refreshTickets();
    }, 20_000);
    heartbeatTimer = window.setInterval(() => {
      void heartbeat().then(() => set({ online: true })).catch(() => set({ online: false }));
      void get().refreshPending();
    }, 60_000);
  };

  return {
    screen: 'boot',
    boot: null,
    cacheAt: null,
    loading: true,
    bootError: '',
    online: navigator.onLine,
    realtime: 'offline',
    user: null,
    mode: null,
    table: null,
    lines: [],
    customerName: '',
    note: '',
    promo: null,
    manualDiscountCents: 0,
    payments: [],
    lastSale: null,
    lastTicketReceipt: null,
    activeTicket: null,
    tickets: [],
    ticketsLoading: false,
    pending: 0,
    syncing: false,
    settings: loadSettings(),
    localDb: { connected: false, url: loadSettings().mysqlUrl, error: 'Belum diinisialisasi' },
    toasts: [],
    displayOpened: false,

    toast: builtinToast,
    dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

    init: async () => {
      if (initialized) return;
      initialized = true;
      const settings = loadSettings();
      set({ settings, localDb: { connected: false, url: settings.mysqlUrl, error: 'Menghubungkan…' } });

      // Connect the local MySQL replica before the first bootstrap is cached so
      // the initial catalog + users are mirrored immediately, not only after a
      // settings change or the next refresh cycle.
      await get().refreshLocalDb();

      try {
        const cached = await readBootstrapCache();
        if (cached) {
          set({ boot: cached.bootstrap, cacheAt: cached.at, screen: 'login', loading: false });
          await cacheBootstrap(cached.bootstrap);
        }
      } catch {
        /* no cache yet */
      }

      try {
        const boot = await fetchBootstrap();
        set((state) => ({
          boot,
          cacheAt: new Date().toISOString(),
          online: true,
          bootError: '',
          loading: false,
          screen: state.screen === 'boot' ? 'login' : state.screen,
        }));
        await cacheBootstrap(boot);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Tidak dapat memuat data terminal.';
        set({ bootError: message, online: false, loading: false, screen: get().boot ? get().screen : 'login' });
        builtinToast(message, 'warn');
      }

      const storedLast = await lastSale().catch(() => null);
      if (storedLast) set({ lastSale: storedLast });
      await get().refreshPending();
      void get().refreshTickets();

      connectRealtime({
        onEvent: (event) => void handleRealtime(event),
        onStatus: (status) => set({ realtime: status, online: status === 'online' ? true : get().online }),
      });

      startPolling();
      window.addEventListener('online', () => {
        set({ online: true });
        void get().syncNow();
      });
      window.addEventListener('offline', () => set({ online: false, realtime: 'offline' }));

      if ('wakeLock' in navigator) {
        try {
          const sentinel = await (navigator as Navigator & {
            wakeLock: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
          }).wakeLock.request('screen');
          wakeLock = sentinel;
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !wakeLock) {
              void (navigator as Navigator & {
                wakeLock: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
              }).wakeLock.request('screen').then((next) => { wakeLock = next; }).catch(() => undefined);
            }
          });
        } catch {
          /* not supported */
        }
      }

      if (isTauri() && get().boot?.client.second_display && settings.openDisplayOnStart) {
        const result = await openSecondDisplay();
        set({ displayOpened: result.ok });
      }

      window.setTimeout(() => { void get().syncNow(); }, 1500);
    },

    refreshBootstrap: async (silent = false) => {
      try {
        const boot = await fetchBootstrap();
        const currentUser = get().user;
        let user = currentUser;
        if (user) {
          const userId = user.id;
          const fresh = boot.users.find((candidate) => candidate.id === userId);
          if (fresh) {
            user = fresh;
          } else {
            user = null;
          }
        }
        set({ boot, online: true, bootError: '', cacheAt: new Date().toISOString(), user });
        await cacheBootstrap(boot);
        if (currentUser && !user) {
          set({ screen: 'login', lines: [], mode: null, table: null });
          builtinToast('Akun Anda dinonaktifkan oleh HQ.', 'warn');
        }
      } catch (error) {
        set({ online: false });
        if (!silent) {
          builtinToast(error instanceof Error ? error.message : 'Gagal memuat data HQ.', 'warn');
        }
      }
    },

    authenticate: async (nik, pin, keepCart = false) => {
      try {
        const result = await posLogin(nik, pin);
        const boot = get().boot;
        if (boot) {
          const merged = { ...boot, client: { ...boot.client, ...result.client } };
          set({ boot: merged });
          await cacheBootstrap(merged);
        }
        set({ online: true, user: result.user });
        goForUser(result.user, keepCart);
        builtinToast(`Selamat datang, ${result.user.name}.`, 'success');
        return { ok: true };
      } catch (error) {
        if (isNetworkError(error)) {
          try {
            const user = await offlineVerify(nik, pin);
            set({ online: false, user });
            goForUser(user, keepCart);
            builtinToast(`Mode offline · login ${user.name}.`, 'warn');
            return { ok: true };
          } catch (offlineError) {
            return { ok: false, message: offlineError instanceof Error ? offlineError.message : 'Login gagal.' };
          }
        }
        return { ok: false, message: error instanceof Error ? error.message : 'Login gagal.' };
      }
    },

    unlock: async (pin) => {
      const state = get();
      if (!state.user) return { ok: false, message: 'Tidak ada pengguna aktif.' };
      const result = await get().authenticate(state.user.nik, pin, true);
      if (result.ok) {
        const next = state.lines.length > 0 ? 'order' : 'mode';
        set({ screen: next });
      }
      return result;
    },

    logout: () => {
      if (get().activeTicket) {
        // Release a claimed ticket so another cashier can pick it up.
        void get().cancelActiveTicket();
      }
      set({
        user: null,
        screen: 'login',
        mode: null,
        table: null,
        lines: [],
        customerName: '',
        note: '',
        promo: null,
        manualDiscountCents: 0,
        payments: [],
        lastSale: null,
        lastTicketReceipt: null,
        activeTicket: null,
      });
      broadcastSlideshow();
    },

    lock: () => {
      if (!get().user) return;
      set({ screen: 'locked', lines: get().lines });
    },

    selectMode: (mode) => {
      if (mode.template === 'table_service') {
        set({ mode, screen: 'table', table: null });
      } else {
        set({ mode, table: null, screen: 'order' });
      }
      broadcastSlideshow();
    },

    selectTable: (table) => {
      set({ table });
      if (table) set({ screen: 'order' });
      broadcastSlideshow();
    },

    goOrder: () => {
      set({ screen: 'order' });
      broadcastSlideshow();
    },

    addProduct: (product, qty = 1) => {
      set((state) => {
        const existing = state.lines.find((line) => line.product.id === product.id && !line.note);
        if (existing) {
          return {
            lines: state.lines.map((line) =>
              line.id === existing.id ? { ...line, qty: Math.max(1, line.qty + qty) } : line),
          };
        }
        return {
          lines: [...state.lines, { id: uid('line'), product, qty: Math.max(1, qty), note: '' }],
        };
      });
      const state = get();
      if (state.screen !== 'order') {
        set({ screen: 'order' });
      }
    },

    changeQty: (lineId, delta) => {
      set((state) => ({
        lines: state.lines
          .map((line) => line.id === lineId ? { ...line, qty: line.qty + delta } : line)
          .filter((line) => line.qty > 0),
      }));
    },

    setQty: (lineId, qty) => {
      const safe = Math.max(0, Math.floor(qty));
      set((state) => ({
        lines: state.lines
          .map((line) => line.id === lineId ? { ...line, qty: safe } : line)
          .filter((line) => line.qty > 0),
      }));
    },

    setLineNote: (lineId, note) => {
      set((state) => ({
        lines: state.lines.map((line) => line.id === lineId ? { ...line, note } : line),
      }));
    },

    removeLine: (lineId) => set((state) => ({ lines: state.lines.filter((line) => line.id !== lineId) })),

    clearCart: () => set({
      lines: [],
      customerName: '',
      note: '',
      promo: null,
      manualDiscountCents: 0,
      payments: [],
      activeTicket: null,
    }),

    setCustomerName: (value) => set({ customerName: value }),
    setNote: (value) => set({ note: value }),
    applyPromotion: (promo) => set({ promo }),
    setManualDiscount: (cents) => set({ manualDiscountCents: Math.max(0, Math.round(cents)) }),

    totals: () => {
      const state = get();
      if (!state.boot) {
        return {
          subtotal_cents: 0, promo_discount_cents: 0, manual_discount_cents: 0,
          discount_cents: 0, service_cents: 0, tax_cents: 0, surcharge_cents: 0,
          rounding_cents: 0, total_cents: 0,
        };
      }
      const effectivePromo = state.promo || bestAutoPromo(state.boot.promotions, state.lines);
      return computeTotals({
        lines: state.lines,
        brand: state.boot.brand,
        promo: effectivePromo,
        manualDiscountCents: state.manualDiscountCents,
        paymentType: state.payments[0]?.paymentType || null,
        allowManualDiscount: canDiscount(state.user, state.boot.client.kind === 'order_station'),
      });
    },

    goPayment: () => {
      const state = get();
      if (!state.user || !state.boot) return;
      if (state.boot.client.kind === 'order_station') {
        builtinToast('Order station tidak dapat melakukan pembayaran.', 'warn');
        return;
      }
      if (!canPay(state.user, false)) {
        builtinToast('Pengguna ini tidak memiliki izin pembayaran.', 'warn');
        return;
      }
      if (state.lines.length === 0) {
        builtinToast('Tambahkan item terlebih dahulu.', 'warn');
        return;
      }
      previousScreen = 'order';
      set({ screen: 'payment', payments: [] });
      get().broadcastPayment(get().totals(), '');
    },

    backToOrder: () => {
      previousScreen = 'order';
      set({ screen: 'order' });
      broadcastSlideshow();
    },

    addPayment: (type, amountCents, reference = '') => {
      const amount = Math.max(0, Math.round(amountCents));
      if (amount <= 0) return;
      set((state) => ({
        payments: [...state.payments, { id: uid('pay'), paymentType: type, amount_cents: amount, reference }],
      }));
      const state = get();
      state.broadcastPayment(state.totals(), state.payments.map((payment) => payment.paymentType.name).join(', '));
    },

    removePayment: (id) => {
      set((state) => ({ payments: state.payments.filter((payment) => payment.id !== id) }));
      const state = get();
      state.broadcastPayment(state.totals(), state.payments.map((payment) => payment.paymentType.name).join(', '));
    },

    completePayment: async () => {
      const state = get();
      if (!state.user || !state.boot) return { ok: false, message: 'Terminal belum siap.' };
      if (!canPay(state.user, state.boot.client.kind === 'order_station')) {
        return { ok: false, message: 'Pembayaran tidak diizinkan untuk peran ini.' };
      }
      if (state.lines.length === 0) return { ok: false, message: 'Keranjang kosong.' };
      const totals = state.totals();
      const paid = state.payments.reduce((sum, payment) => sum + payment.amount_cents, 0);
      if (paid < totals.total_cents) {
        return { ok: false, message: 'Nominal pembayaran belum mencukupi.' };
      }
      if (state.payments.length === 0) {
        return { ok: false, message: 'Pilih metode pembayaran.' };
      }

      const createdAt = nowMysql();
      const sale: CompletedSale = {
        client_bill_id: uid('bill'),
        bill_no: billNumber(state.boot.brand.code),
        brand: state.boot.brand,
        outlet: state.boot.outlet,
        client: state.boot.client,
        user: state.user,
        ticket_id: state.activeTicket?.id,
        ticket_no: state.activeTicket?.ticket_no,
        table_id: state.table?.id || null,
        table_name: state.table?.name || '',
        sales_mode_id: state.mode?.id || null,
        sales_mode_name: state.mode?.name || '',
        customer_name: state.customerName,
        note: state.note,
        created_at: createdAt,
        paid_at: createdAt,
        items: state.lines.map((line) => ({
          product_id: line.product.id,
          sku: line.product.sku,
          name: line.product.name,
          qty: line.qty,
          unit_price_cents: line.product.price_cents,
          discount_cents: 0,
          total_cents: line.product.price_cents * line.qty,
          note: line.note,
        })),
        payments: state.payments.map((payment) => ({
          payment_type_id: payment.paymentType.id,
          method: payment.paymentType.method,
          name: payment.paymentType.name,
          amount_cents: payment.amount_cents,
          reference: payment.reference,
        })),
        subtotal_cents: totals.subtotal_cents,
        discount_cents: totals.discount_cents,
        service_cents: totals.service_cents,
        tax_cents: totals.tax_cents,
        rounding_cents: totals.rounding_cents,
        total_cents: totals.total_cents,
        paid_cents: paid,
        change_cents: Math.max(0, paid - totals.total_cents),
        payment_summary: state.payments
          .map((payment) => `${payment.paymentType.name}${payment.reference ? ` (${payment.reference})` : ''}`)
          .join(', '),
        synced: false,
      };

      // Local-first: IDB + optional MySQL mirror before the network call.
      await queueSale(sale).catch(() => undefined);
      set({ lastSale: sale, lastTicketReceipt: null, screen: 'receipt' });

      let synced = false;
      try {
        await submitSale(sale);
        synced = true;
        await dequeueSale(sale.client_bill_id);
        set({ online: true });
      } catch (error) {
        set({ online: false });
        if (!isNetworkError(error)) {
          builtinToast(error instanceof Error ? error.message : 'Sinkronisasi tertunda.', 'warn');
        }
      }

      const finalSale = { ...sale, synced };
      set({ lastSale: finalSale });
      await setLastSale(finalSale).catch(() => undefined);
      await get().refreshPending();

      if (state.activeTicket) {
        set({ activeTicket: null });
        void get().refreshTickets();
      }
      void printAfterPayment(finalSale);
      get().broadcastPayment(totals, finalSale.payment_summary);
      if (!synced) {
        builtinToast('Transaksi tersimpan lokal dan akan dikirim otomatis.', 'warn');
      } else {
        builtinToast('Pembayaran berhasil.', 'success');
      }
      return { ok: true };
    },

    sendOrder: async () => {
      const state = get();
      if (!state.user || !state.boot) return { ok: false, message: 'Terminal belum siap.' };
      if (state.lines.length === 0) return { ok: false, message: 'Keranjang kosong.' };

      const ticketNo = ticketNumber(state.boot.brand.code);
      const payload: QueuedTicket = {
        ticket_no: ticketNo,
        user_id: state.user.id,
        user_name: state.user.name,
        table_id: state.table?.id || null,
        table_name: state.table?.name || '',
        sales_mode_id: state.mode?.id || null,
        sales_mode_name: state.mode?.name || '',
        customer_name: state.customerName,
        note: state.note,
        created_at: nowMysql(),
        items: state.lines.map((line) => ({
          product_id: line.product.id,
          sku: line.product.sku,
          name: line.product.name,
          qty: line.qty,
          unit_price_cents: line.product.price_cents,
          total_cents: line.product.price_cents * line.qty,
          note: line.note,
        })),
      };

      const receipt = receiptFromTicket(payload, state.boot, state.user);
      await queueTicket(payload).catch(() => undefined);
      set({ lastTicketReceipt: receipt, lastSale: null, screen: 'receipt', activeTicket: null });

      let sent = false;
      try {
        const result = await createTicket(payload);
        sent = true;
        await dequeueTicket(payload.ticket_no);
        set({ lastTicketReceipt: { ...receipt, ticket_no: result.ticket_no } });
        set({ online: true });
      } catch (error) {
        set({ online: false });
        if (!isNetworkError(error)) {
          builtinToast(error instanceof Error ? error.message : 'Order tersimpan lokal.', 'warn');
        }
      }
      void printOrderTicket(receipt);
      await get().refreshPending();
      builtinToast(sent ? 'Order berhasil dikirim ke kasir.' : 'Order tersimpan lokal dan akan dikirim otomatis.', sent ? 'success' : 'warn');
      return { ok: true };
    },

    newOrder: () => {
      const state = get();
      const boot = state.boot;
      set({
        lines: [],
        customerName: '',
        note: '',
        promo: null,
        manualDiscountCents: 0,
        payments: [],
        lastSale: null,
        lastTicketReceipt: null,
        activeTicket: null,
        table: null,
      });
      if (!boot) {
        set({ screen: 'login' });
        return;
      }
      if (boot.sales_modes.length > 1) {
        set({ screen: 'mode', mode: null });
      } else if (boot.sales_modes.length === 1) {
        const mode = boot.sales_modes[0];
        set({ mode, screen: mode.template === 'table_service' ? 'table' : 'order' });
      } else {
        set({ screen: 'order' });
      }
      broadcastSlideshow();
    },

    refreshTickets: async () => {
      const state = get();
      if (!state.boot) return;
      if (state.ticketsLoading) return;
      set({ ticketsLoading: true });
      try {
        const tickets = await fetchTickets('open');
        set({ tickets, online: true });
      } catch {
        /* offline; keep last known tickets */
      } finally {
        set({ ticketsLoading: false });
      }
    },

    startTicket: async (ticket) => {
      const state = get();
      if (!state.boot || !state.user) return { ok: false, message: 'Terminal belum siap.' };
      if (state.boot.client.kind === 'order_station') {
        return { ok: false, message: 'Order station tidak dapat mengambil ticket.' };
      }
      const alreadyMine = ticket.status === 'claimed' && ticket.claimed_by_name === state.user.name;
      if (!alreadyMine) {
        try {
          await apiClaimTicket(ticket.id, state.user);
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : 'Ticket sudah diambil kasir lain.' };
        }
      }
      const lines: CartLine[] = ticket.items.map((item) => ({
        id: uid('line'),
        product: synthProduct(item, state.boot!),
        qty: item.qty,
        note: item.note,
      }));
      const mode = state.boot.sales_modes.find((candidate) => candidate.id === ticket.sales_mode_id) || state.mode;
      const table = state.boot.tables.find((candidate) => candidate.id === ticket.table_id) || null;
      set({
        lines,
        mode,
        table,
        customerName: ticket.customer_name,
        note: ticket.note,
        promo: null,
        manualDiscountCents: 0,
        payments: [],
        activeTicket: ticket,
        screen: 'order',
      });
      set({ tickets: get().tickets.filter((candidate) => candidate.id !== ticket.id) });
      builtinToast(`Ticket ${ticket.ticket_no} dimuat.`, 'success');
      return { ok: true };
    },

    cancelActiveTicket: async () => {
      const ticket = get().activeTicket;
      if (!ticket) return;
      try {
        await apiRequest(`/api/pos/tickets/${ticket.id}/cancel`, { method: 'POST', body: {} });
      } catch {
        /* offline: local cancel only */
      }
      set({ activeTicket: null });
      void get().refreshTickets();
    },

    syncNow: async () => {
      if (get().syncing) return { synced: 0, failed: 0 };
      set({ syncing: true });
      let synced = 0;
      let failed = 0;

      try {
        const sales = await queuedSales();
        if (sales.length > 0) {
          try {
            const result = await syncSales(sales);
            const accepted = new Set(
              result.data
                .filter((row) => row.ok)
                .map((row) => row.client_bill_id || row.bill_no),
            );
            for (const sale of sales) {
              if (accepted.has(sale.client_bill_id) || accepted.has(sale.bill_no)) {
                await dequeueSale(sale.client_bill_id);
                synced += 1;
              } else {
                failed += 1;
              }
            }
            set({ online: true });
          } catch (error) {
            failed += sales.length;
            set({ online: false });
            if (!isNetworkError(error)) {
              builtinToast(error instanceof Error ? error.message : 'Sinkronisasi gagal.', 'warn');
            }
          }
        }

        const tickets = await queuedTickets();
        for (const ticket of tickets) {
          try {
            await createTicket(ticket);
            await dequeueTicket(ticket.ticket_no);
            synced += 1;
          } catch (error) {
            if (error instanceof ApiError && error.status === 409) {
              await dequeueTicket(ticket.ticket_no);
              synced += 1;
            } else {
              failed += 1;
            }
          }
        }
      } finally {
        const pending = await pendingCount().catch(() => 0);
        set({ syncing: false, pending });
      }
      return { synced, failed };
    },

    refreshPending: async () => {
      const pending = await pendingCount().catch(() => 0);
      set({ pending });
    },

    broadcastPayment: (totals, paymentName = '') => {
      const state = get();
      if (!state.boot) return;
      postDisplayState({
        type: 'payment',
        brand_name: state.boot.brand.name,
        outlet_name: state.boot.outlet.name,
        customer_name: state.customerName,
        table_name: state.table?.name || '',
        items: state.lines.map((line) => ({
          name: line.product.name,
          qty: line.qty,
          total_cents: line.product.price_cents * line.qty,
          note: line.note,
        })),
        subtotal_cents: totals.subtotal_cents,
        discount_cents: totals.discount_cents,
        total_cents: totals.total_cents,
        change_cents: Math.max(0, state.payments.reduce((sum, payment) => sum + payment.amount_cents, 0) - totals.total_cents),
        payment_name: paymentName,
        updated_at: new Date().toISOString(),
      });
    },

    goSettings: () => {
      previousScreen = get().screen;
      set({ screen: 'settings' });
      void get().refreshLocalDb();
    },

    leaveSettings: () => {
      if (!get().user) {
        set({ screen: 'login' });
        return;
      }
      set({ screen: previousScreen === 'settings' || previousScreen === 'boot' ? 'order' : previousScreen });
    },

    applySettings: async (patch) => {
      const next = saveSettings(patch);
      set({ settings: next });
      await get().refreshLocalDb();
      await get().refreshBootstrap();
      disconnectRealtime();
      connectRealtime({
        onEvent: (event) => void handleRealtime(event),
        onStatus: (status) => set({ realtime: status }),
      });
      builtinToast('Pengaturan tersimpan.', 'success');
    },

    refreshLocalDb: async () => {
      const settings = get().settings;
      await initLocalDb(settings.mysqlUrl);
      const info = await localDbInfo();
      set({ localDb: info });
    },

    openDisplay: async () => {
      const result = await openSecondDisplay();
      set({ displayOpened: result.ok });
      return { ok: result.ok, message: result.message };
    },
  };
});

export function selectPrinter(purpose: 'receipt' | 'kitchen'): Printer | null {
  const boot = usePos.getState().boot;
  return boot ? findPrinter(boot.printers, purpose) : null;
}

export function currentTotals(): Totals {
  return usePos.getState().totals();
}

export function currentAutoPromo(): Promotion | null {
  const state = usePos.getState();
  if (!state.boot || state.promo) return null;
  return bestAutoPromo(state.boot.promotions, state.lines);
}

export function applyAutoPromo(): void {
  const state = usePos.getState();
  if (!state.boot) return;
  const best = bestAutoPromo(state.boot.promotions, state.lines);
  if (best) state.applyPromotion(best);
}

export function promoPreview(promo: Promotion): number {
  return promotionDiscount(promo, usePos.getState().lines);
}

export function cartSubtotal(): number {
  return subtotalOf(usePos.getState().lines);
}

export function displayMoney(cents: number): string {
  return money(cents);
}

export function displayDate(value: string): string {
  return dateTime(value);
}

export { closeSecondDisplay };
