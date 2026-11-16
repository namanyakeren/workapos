import { get, set, update } from 'idb-keyval';
import type { Bootstrap, CompletedSale } from '../types';
import { mirrorBootstrap, mirrorSale, mirrorSaleSynced, mirrorTicket, mirrorTicketSynced } from './localdb';

const KEY_BOOTSTRAP = 'workapos.bootstrap.v1';
const KEY_SALES = 'workapos.sales.queue.v1';
const KEY_HISTORY = 'workapos.sales.history.v1';
const KEY_TICKETS = 'workapos.tickets.queue.v1';
const KEY_LAST_SALE = 'workapos.last_sale.v1';
const KEY_LAST_TICKET = 'workapos.last_ticket.v1';

export interface QueuedTicket {
  ticket_no: string;
  user_id?: string;
  user_name: string;
  table_id?: string | null;
  table_name: string;
  sales_mode_id?: string | null;
  sales_mode_name: string;
  customer_name: string;
  note: string;
  created_at: string;
  items: Array<{
    product_id?: string | null;
    sku: string;
    name: string;
    qty: number;
    unit_price_cents: number;
    total_cents: number;
    note: string;
  }>;
}

export async function cacheBootstrap(bootstrap: Bootstrap): Promise<void> {
  await set(KEY_BOOTSTRAP, { bootstrap, at: new Date().toISOString() });
  await mirrorBootstrap(bootstrap);
}

export async function readBootstrapCache(): Promise<{ bootstrap: Bootstrap; at: string } | null> {
  const cached = await get<{ bootstrap: Bootstrap; at: string }>(KEY_BOOTSTRAP);
  return cached || null;
}

export async function queueSale(sale: CompletedSale): Promise<void> {
  await update<CompletedSale[]>(KEY_SALES, (current) => {
    const list = (current || []).filter((item) => item.client_bill_id !== sale.client_bill_id);
    return [...list, sale];
  });
  await update<CompletedSale[]>(KEY_HISTORY, (current) => [sale, ...(current || [])].slice(0, 120));
  await set(KEY_LAST_SALE, sale);
  await mirrorSale(sale);
}

export async function queuedSales(): Promise<CompletedSale[]> {
  return (await get<CompletedSale[]>(KEY_SALES)) || [];
}

export async function dequeueSale(clientBillId: string): Promise<void> {
  await update<CompletedSale[]>(KEY_SALES, (current) =>
    (current || []).filter((item) => item.client_bill_id !== clientBillId));
  await mirrorSaleSynced(clientBillId);
}

export async function saleHistory(): Promise<CompletedSale[]> {
  return (await get<CompletedSale[]>(KEY_HISTORY)) || [];
}

export async function lastSale(): Promise<CompletedSale | null> {
  return (await get<CompletedSale>(KEY_LAST_SALE)) || null;
}

export async function setLastSale(sale: CompletedSale | null): Promise<void> {
  if (sale) await set(KEY_LAST_SALE, sale);
}

export async function queueTicket(ticket: QueuedTicket): Promise<void> {
  await update<QueuedTicket[]>(KEY_TICKETS, (current) => {
    const list = (current || []).filter((item) => item.ticket_no !== ticket.ticket_no);
    return [...list, ticket];
  });
  await set(KEY_LAST_TICKET, ticket);
  await mirrorTicket(JSON.stringify(ticket));
}

export async function queuedTickets(): Promise<QueuedTicket[]> {
  return (await get<QueuedTicket[]>(KEY_TICKETS)) || [];
}

export async function dequeueTicket(ticketNo: string): Promise<void> {
  await update<QueuedTicket[]>(KEY_TICKETS, (current) =>
    (current || []).filter((item) => item.ticket_no !== ticketNo));
  await mirrorTicketSynced(ticketNo);
}

export async function lastTicket(): Promise<QueuedTicket | null> {
  return (await get<QueuedTicket>(KEY_LAST_TICKET)) || null;
}

export async function pendingCount(): Promise<number> {
  const [sales, tickets] = await Promise.all([queuedSales(), queuedTickets()]);
  return sales.length + tickets.length;
}

export async function clearOfflineData(): Promise<void> {
  await set(KEY_SALES, []);
  await set(KEY_TICKETS, []);
  await set(KEY_HISTORY, []);
  await set(KEY_BOOTSTRAP, null);
  await set(KEY_LAST_SALE, null);
  await set(KEY_LAST_TICKET, null);
  try {
    if ('caches' in window) {
      await caches.delete('workapos-media-v1');
    }
  } catch {
    /* optional */
  }
}
