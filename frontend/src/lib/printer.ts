import type { Brand, CompletedSale, Outlet, Printer, TicketReceipt } from '../types';
import { money } from './format';
import { isTauri } from './localdb';

export type PrintJob =
  | {
      kind: 'receipt';
      title: string;
      paper_width: number;
      brand: string;
      outlet: string;
      address: string;
      phone: string;
      bill_no: string;
      table_name: string;
      sales_mode: string;
      customer_name: string;
      cashier: string;
      created_at: string;
      items: Array<{ name: string; qty: number; price: string; total: string; note: string }>;
      subtotal: string;
      discount: string;
      service: string;
      tax: string;
      rounding: string;
      total: string;
      paid: string;
      change: string;
      payments: string[];
      note: string;
      footer: string;
    }
  | {
      kind: 'kitchen';
      paper_width: number;
      title: string;
      brand: string;
      outlet: string;
      reference: string;
      table_name: string;
      sales_mode: string;
      customer_name: string;
      created_at: string;
      items: Array<{ name: string; qty: number; note: string }>;
      note: string;
    }
  | { kind: 'test'; paper_width: number; brand: string; outlet: string; printer: string; time: string }
  | { kind: 'drawer' };

export interface PrintResult {
  ok: boolean;
  message: string;
}

export function findPrinter(printers: Printer[], purpose: 'receipt' | 'kitchen'): Printer | null {
  return printers.find((printer) => printer.purpose === purpose)
    || (purpose === 'receipt' ? printers[0] || null : null);
}

export async function sendPrintJob(printer: Printer, job: PrintJob): Promise<PrintResult> {
  if (!isTauri()) {
    if (job.kind === 'receipt' || job.kind === 'kitchen') {
      return browserPrint(job);
    }
    return { ok: false, message: 'Laci hanya dapat dibuka dari aplikasi Tauri.' };
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<{ ok: boolean; message?: string }>('print_escpos', {
      printer: { ip: printer.ip, port: printer.port },
      job,
    });
    return { ok: Boolean(result.ok), message: result.message || 'Perintah cetak terkirim.' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function receiptJob(sale: CompletedSale, footer = 'Terima kasih atas kunjungan Anda'): Extract<PrintJob, { kind: 'receipt' }> {
  return {
    kind: 'receipt',
    title: 'STRUK PEMBAYARAN',
    paper_width: 80,
    brand: sale.brand.name,
    outlet: sale.outlet.name,
    address: sale.outlet.address,
    phone: sale.outlet.phone,
    bill_no: sale.bill_no,
    table_name: sale.table_name,
    sales_mode: sale.sales_mode_name,
    customer_name: sale.customer_name,
    cashier: sale.user.name,
    created_at: sale.paid_at,
    items: sale.items.map((item) => ({
      name: item.name,
      qty: item.qty,
      price: money(item.unit_price_cents),
      total: money(item.total_cents),
      note: item.note,
    })),
    subtotal: money(sale.subtotal_cents),
    discount: money(sale.discount_cents),
    service: money(sale.service_cents),
    tax: money(sale.tax_cents),
    rounding: money(sale.rounding_cents),
    total: money(sale.total_cents),
    paid: money(sale.paid_cents),
    change: money(sale.change_cents),
    payments: sale.payments.map((payment) =>
      `${payment.name}${payment.reference ? ` · ${payment.reference}` : ''}: ${money(payment.amount_cents)}`),
    note: sale.note,
    footer,
  };
}

export function kitchenJob(
  reference: string,
  brand: Brand,
  outlet: Outlet,
  data: {
    table_name: string;
    sales_mode: string;
    customer_name: string;
    items: Array<{ name: string; qty: number; note: string }>;
    note: string;
  },
): Extract<PrintJob, { kind: 'kitchen' }> {
  return {
    kind: 'kitchen',
    paper_width: 80,
    title: 'TIKET DAPUR',
    brand: brand.name,
    outlet: outlet.name,
    reference,
    table_name: data.table_name,
    sales_mode: data.sales_mode,
    customer_name: data.customer_name,
    created_at: new Date().toISOString(),
    items: data.items,
    note: data.note,
  };
}

export function ticketKitchenJob(ticket: TicketReceipt): Extract<PrintJob, { kind: 'kitchen' }> {
  return kitchenJob(
    ticket.ticket_no,
    ticket.brand,
    ticket.outlet,
    {
      table_name: ticket.table_name,
      sales_mode: ticket.sales_mode_name,
      customer_name: ticket.customer_name,
      items: ticket.items.map((item) => ({ name: item.name, qty: item.qty, note: item.note })),
      note: ticket.note,
    },
  );
}

export async function printTestJob(printer: Printer, brand: Brand, outlet: Outlet): Promise<PrintResult> {
  return sendPrintJob(printer, testJob(printer, brand, outlet));
}

export function testJob(printer: Printer, brand: Brand, outlet: Outlet): Extract<PrintJob, { kind: 'test' }> {
  return {
    kind: 'test',
    paper_width: printer.paper_width || 80,
    brand: brand.name,
    outlet: outlet.name,
    printer: printer.name,
    time: new Date().toISOString(),
  };
}

export async function printReceipt(
  sale: CompletedSale,
  printer: Printer,
  footer?: string,
): Promise<PrintResult> {
  const job = receiptJob(sale, footer);
  job.paper_width = printer.paper_width || 80;
  return sendPrintJob(printer, job);
}

export async function printKitchen(
  reference: string,
  brand: Brand,
  outlet: Outlet,
  data: Parameters<typeof kitchenJob>[3],
  printer: Printer,
): Promise<PrintResult> {
  const job = kitchenJob(reference, brand, outlet, data);
  job.paper_width = printer.paper_width || 80;
  return sendPrintJob(printer, job);
}

export async function printTicket(ticket: TicketReceipt, printer: Printer): Promise<PrintResult> {
  const job = ticketKitchenJob(ticket);
  job.paper_width = printer.paper_width || 80;
  return sendPrintJob(printer, job);
}

export async function openCashDrawer(printer: Printer): Promise<PrintResult> {
  return sendPrintJob(printer, { kind: 'drawer' });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character] || character));
}

function jobToText(job: Extract<PrintJob, { kind: 'receipt' | 'kitchen' | 'test' }>): string {
  const width = job.kind === 'test' ? 42 : job.paper_width >= 80 ? 42 : 32;
  const center = (text: string) => {
    const spaces = Math.max(0, Math.floor((width - text.length) / 2));
    return `${' '.repeat(spaces)}${text}`;
  };
  const line = (left: string, right = '') => {
    const gap = Math.max(1, width - left.length - right.length);
    return `${left}${' '.repeat(gap)}${right}`;
  };
  const wrap = (text: string) => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      if (!current) current = word;
      else if (current.length + word.length + 1 <= width) current += ` ${word}`;
      else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines;
  };
  const out: string[] = [];
  if (job.kind === 'test') {
    out.push(center('WORKAPOS PRINT TEST'));
    out.push(center(job.brand));
    out.push(center(job.outlet));
    out.push('');
    out.push(line('Printer', job.printer));
    out.push(line('Waktu', new Date(job.time).toLocaleString('id-ID')));
    out.push('');
    out.push(center('Printer siap digunakan.'));
    return out.join('\n');
  }
  if (job.kind === 'kitchen') {
    out.push(center(job.title));
    out.push(center(job.brand.toUpperCase()));
    out.push(center(job.outlet));
    out.push('');
    out.push(line('Ref', job.reference));
    out.push(line('Meja', job.table_name || '-'));
    out.push(line('Mode', job.sales_mode || '-'));
    out.push(line('Waktu', new Date(job.created_at).toLocaleTimeString('id-ID')));
    out.push('-'.repeat(width));
    for (const item of job.items) {
      out.push(line(`${item.qty}x ${item.name}`));
      if (item.note) out.push(...wrap(`  * ${item.note}`));
    }
    out.push('-'.repeat(width));
    if (job.note) out.push(...wrap(`Catatan: ${job.note}`));
    out.push(center('-- DAPUR --'));
    return out.join('\n');
  }
  out.push(center(job.brand.toUpperCase()));
  out.push(center(job.outlet));
  if (job.address) out.push(...wrap(job.address).map(center));
  if (job.phone) out.push(center(job.phone));
  out.push('');
  out.push(center(job.title));
  out.push('-'.repeat(width));
  out.push(line('No', job.bill_no));
  out.push(line('Meja', job.table_name || '-'));
  out.push(line('Mode', job.sales_mode || '-'));
  out.push(line('Kasir', job.cashier));
  out.push(line('Waktu', new Date(job.created_at).toLocaleString('id-ID')));
  if (job.customer_name) out.push(line('Pelanggan', job.customer_name));
  out.push('-'.repeat(width));
  for (const item of job.items) {
    out.push(line(`${item.qty}x ${item.name}`, item.total));
    out.push(`   @ ${item.price}`);
    if (item.note) out.push(...wrap(`   * ${item.note}`));
  }
  out.push('-'.repeat(width));
  out.push(line('Subtotal', job.subtotal));
  if (job.discount !== money(0)) out.push(line('Diskon', `-${job.discount}`));
  if (job.service !== money(0)) out.push(line('Service', job.service));
  if (job.tax !== money(0)) out.push(line('Pajak', job.tax));
  if (job.rounding !== money(0)) out.push(line('Pembulatan', job.rounding));
  out.push(line('TOTAL', job.total));
  out.push(line('Dibayar', job.paid));
  out.push(line('Kembali', job.change));
  for (const payment of job.payments) out.push(...wrap(payment));
  if (job.note) out.push(...wrap(`Catatan: ${job.note}`));
  out.push('');
  out.push(center(job.footer));
  out.push('');
  out.push('');
  return out.join('\n');
}

function browserPrint(job: Extract<PrintJob, { kind: 'receipt' | 'kitchen' | 'test' }>): PrintResult {
  const text = jobToText(job);
  const popup = window.open('', '_blank', 'width=420,height=720');
  if (!popup) {
    return { ok: false, message: 'Popup cetak diblokir. Gunakan aplikasi Tauri untuk cetak jaringan.' };
  }
  popup.document.write(`<!doctype html><html><head><title>WORKAPOS Print</title>
    <style>
      @page { margin: 4mm; }
      body { margin: 0; background: #fff; color: #000; }
      pre { font: 12px/1.45 'Courier New', monospace; white-space: pre-wrap; margin: 0; }
    </style></head><body><pre>${escapeHtml(text)}</pre></body></html>`);
  popup.document.close();
  popup.focus();
  setTimeout(() => {
    try {
      popup.print();
    } catch {
      /* ignore */
    }
  }, 220);
  return { ok: true, message: 'Dialog cetak dibuka.' };
}
