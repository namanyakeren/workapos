import {
  CheckCircle2,
  CloudOff,
  Printer,
  ReceiptText,
  RotateCw,
  Send,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { usePos, selectPrinter } from '../store';
import { dateTime, money } from '../lib/format';
import { printKitchen, printReceipt, printTicket } from '../lib/printer';

export function ReceiptPage() {
  const lastSale = usePos((state) => state.lastSale);
  const ticket = usePos((state) => state.lastTicketReceipt);
  const newOrder = usePos((state) => state.newOrder);
  const toast = usePos((state) => state.toast);
  const pending = usePos((state) => state.pending);
  const syncing = usePos((state) => state.syncing);
  const syncNow = usePos((state) => state.syncNow);
  const [printing, setPrinting] = useState(false);

  const isTicket = !lastSale && Boolean(ticket);

  const doPrint = async (kind: 'receipt' | 'kitchen') => {
    if (printing) return;
    setPrinting(true);
    try {
      if (lastSale) {
        const printer = selectPrinter(kind === 'receipt' ? 'receipt' : 'kitchen');
        if (!printer) {
          toast('Printer belum dikonfigurasi di HQ.', 'warn');
          return;
        }
        const result = kind === 'receipt'
          ? await printReceipt(lastSale, printer)
          : await printKitchen(lastSale.bill_no, lastSale.brand, lastSale.outlet, {
              table_name: lastSale.table_name,
              sales_mode: lastSale.sales_mode_name,
              customer_name: lastSale.customer_name,
              items: lastSale.items.map((item) => ({ name: item.name, qty: item.qty, note: item.note })),
              note: lastSale.note,
            }, printer);
        toast(result.message, result.ok ? 'success' : 'warn');
      } else if (ticket) {
        const printer = selectPrinter('kitchen') || selectPrinter('receipt');
        if (!printer) {
          toast('Printer belum dikonfigurasi di HQ.', 'warn');
          return;
        }
        const result = await printTicket(ticket, printer);
        toast(result.message, result.ok ? 'success' : 'warn');
      }
    } finally {
      setPrinting(false);
    }
  };

  if (!lastSale && !ticket) {
    return (
      <div className="empty-state full">
        <ReceiptText size={48} />
        <h3>Tidak ada struk terakhir</h3>
        <p>Mulai order baru untuk melihat struk di sini.</p>
        <button type="button" className="btn btn-primary" onClick={newOrder}>Order Baru</button>
      </div>
    );
  }

  const billNo = lastSale?.bill_no || ticket?.ticket_no || '';
  const createdAt = lastSale?.paid_at || ticket?.created_at || new Date().toISOString();
  const brand = lastSale?.brand || ticket?.brand;
  const outlet = lastSale?.outlet || ticket?.outlet;
  const cashier = lastSale?.user || ticket?.user;
  const items = lastSale?.items || ticket?.items || [];
  const subtotal = lastSale?.subtotal_cents || ticket?.subtotal_cents || 0;

  return (
    <div className="receipt-screen">
      <div className="receipt-success">
        <div className="success-ring">
          {isTicket ? <Send size={42} /> : <CheckCircle2 size={46} />}
        </div>
        <div>
          <span className="eyebrow">{isTicket ? 'Order terkirim ke kasir' : 'Pembayaran selesai'}</span>
          <h1>{isTicket ? 'Order berhasil dibuat' : 'Terima kasih'}</h1>
          <p>
            {isTicket
              ? 'Ticket masuk ke daftar order kasir. Dapur menerima tiket jika printer dikonfigurasi.'
              : `Kembalian ${money(lastSale?.change_cents || 0)} · ${lastSale?.payment_summary || ''}`}
          </p>
        </div>
        {!isTicket && lastSale ? (
          lastSale.synced ? (
            <span className="badge badge-green"><CheckCircle2 size={15} /> Tersinkron</span>
          ) : (
            <button type="button" className="badge badge-amber as-button" onClick={() => void syncNow()}>
              <CloudOff size={15} /> {syncing ? 'Mengirim…' : 'Menunggu sinkronisasi'}
            </button>
          )
        ) : null}
      </div>

      <div className="receipt-layout">
        <div className="receipt-paper">
          <div className="paper-brand">
            <div className="paper-mark" style={{ background: brand?.color || '#f59e0b' }}>{brand?.code?.slice(0, 2)}</div>
            <h2>{brand?.name}</h2>
            <p>{outlet?.name}</p>
            {outlet?.address ? <small>{outlet.address}</small> : null}
            {outlet?.phone ? <small>{outlet.phone}</small> : null}
          </div>
          <div className="paper-divider" />
          <div className="paper-meta">
            <div><span>{isTicket ? 'Ticket' : 'No. bill'}</span><strong>{billNo}</strong></div>
            <div><span>Waktu</span><strong>{dateTime(createdAt)}</strong></div>
            <div><span>{isTicket ? 'Order oleh' : 'Kasir'}</span><strong>{cashier?.name}</strong></div>
            <div><span>Meja / mode</span><strong>{lastSale?.table_name || ticket?.table_name || '—'} · {lastSale?.sales_mode_name || ticket?.sales_mode_name || '—'}</strong></div>
            {(lastSale?.customer_name || ticket?.customer_name) ? (
              <div><span>Pelanggan</span><strong>{lastSale?.customer_name || ticket?.customer_name}</strong></div>
            ) : null}
          </div>
          <div className="paper-divider" />
          <div className="paper-items">
            {items.map((item, index) => (
              <div key={`${item.name}-${index}`} className="paper-item">
                <div>
                  <strong>{item.qty}× {item.name}</strong>
                  {item.note ? <small>{item.note}</small> : null}
                </div>
                <span>{money(item.total_cents)}</span>
              </div>
            ))}
          </div>
          <div className="paper-divider" />
          <div className="paper-totals">
            <div><span>Subtotal</span><span>{money(subtotal)}</span></div>
            {lastSale && lastSale.discount_cents > 0 ? <div><span>Diskon</span><span>−{money(lastSale.discount_cents)}</span></div> : null}
            {lastSale && lastSale.service_cents > 0 ? <div><span>Service</span><span>{money(lastSale.service_cents)}</span></div> : null}
            {lastSale && lastSale.tax_cents > 0 ? <div><span>Pajak</span><span>{money(lastSale.tax_cents)}</span></div> : null}
            {lastSale && lastSale.rounding_cents !== 0 ? <div><span>Pembulatan</span><span>{money(lastSale.rounding_cents)}</span></div> : null}
            <div className="paper-total"><span>{isTicket ? 'Total order' : 'Total'}</span><span>{money(lastSale?.total_cents || subtotal)}</span></div>
            {lastSale ? (
              <>
                <div><span>Dibayar</span><span>{money(lastSale.paid_cents)}</span></div>
                <div><span>Kembali</span><span>{money(lastSale.change_cents)}</span></div>
              </>
            ) : null}
          </div>
          {lastSale ? (
            <div className="paper-payments">
              {lastSale.payments.map((payment, index) => (
                <div key={`${payment.name}-${index}`}>
                  <span>{payment.name}{payment.reference ? ` · ${payment.reference}` : ''}</span>
                  <span>{money(payment.amount_cents)}</span>
                </div>
              ))}
            </div>
          ) : null}
          {(lastSale?.note || ticket?.note) ? <div className="paper-note">Catatan: {lastSale?.note || ticket?.note}</div> : null}
          <div className="paper-footer">
            <Sparkles size={15} />
            <span>Terima kasih · WORKAPOS</span>
          </div>
        </div>

        <div className="receipt-actions">
          <div className="receipt-action-card">
            <h3>Langkah berikutnya</h3>
            <p>Cetak ulang kapan saja, lalu mulai order baru untuk pelanggan berikutnya.</p>
            <button type="button" className="btn btn-primary btn-block btn-xl" onClick={newOrder}>
              <RotateCw size={20} /> Order Baru
            </button>
            <button type="button" className="btn btn-ghost btn-block" disabled={printing} onClick={() => void doPrint('receipt')}>
              <Printer size={18} /> {isTicket ? 'Cetak tiket' : 'Cetak struk'}
            </button>
            {!isTicket ? (
              <button type="button" className="btn btn-ghost btn-block" disabled={printing} onClick={() => void doPrint('kitchen')}>
                <Printer size={18} /> Cetak tiket dapur
              </button>
            ) : null}
          </div>
          {pending > 0 ? (
            <div className="receipt-note-card">
              <CloudOff size={20} />
              <div>
                <strong>{pending} transaksi menunggu sinkronisasi</strong>
                <p>Data aman di perangkat. Terminal akan mengirim otomatis saat koneksi pulih.</p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
