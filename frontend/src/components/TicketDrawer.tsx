import { Clock, ListOrdered, RefreshCw, Send, Store } from 'lucide-react';
import { Modal } from './Modal';
import { usePos } from '../store';
import { money, timeOnly } from '../lib/format';

interface TicketDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function TicketDrawer({ open, onClose }: TicketDrawerProps) {
  const tickets = usePos((state) => state.tickets);
  const loading = usePos((state) => state.ticketsLoading);
  const refresh = usePos((state) => state.refreshTickets);
  const startTicket = usePos((state) => state.startTicket);
  const toast = usePos((state) => state.toast);

  const load = async (ticketId: string) => {
    const ticket = tickets.find((candidate) => candidate.id === ticketId);
    if (!ticket) return;
    const result = await startTicket(ticket);
    if (result.ok) {
      onClose();
    } else {
      toast(result.message || 'Ticket tidak dapat diambil.', 'warn');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Order Masuk"
      subtitle="Order dari order station di outlet ini. Ambil ticket untuk melanjutkan ke pembayaran."
      size="lg"
    >
      <div className="ticket-toolbar">
        <span className="badge badge-amber"><ListOrdered size={15} /> {tickets.length} ticket terbuka</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refresh()}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} /> Muat ulang
        </button>
      </div>

      <div className="ticket-list">
        {tickets.map((ticket) => (
          <article key={ticket.id} className="ticket-card">
            <div className="ticket-head">
              <div>
                <span className="ticket-no">{ticket.ticket_no}</span>
                <span className="ticket-time"><Clock size={14} /> {timeOnly(ticket.created_at)}</span>
              </div>
              <strong>{money(ticket.subtotal_cents)}</strong>
            </div>
            <div className="ticket-meta">
              <span><Store size={15} /> {ticket.table_name || 'Tanpa meja'}</span>
              <span>{ticket.sales_mode_name || 'Order'}</span>
              <span>{ticket.created_by_name || 'Order station'}</span>
            </div>
            {ticket.customer_name || ticket.note ? (
              <div className="ticket-note">
                {ticket.customer_name ? <strong>{ticket.customer_name}</strong> : null}
                {ticket.note ? <span>{ticket.note}</span> : null}
              </div>
            ) : null}
            <div className="ticket-items">
              {ticket.items.map((item) => (
                <div key={item.id} className="ticket-item">
                  <span>{item.qty}× {item.name}</span>
                  <small>{money(item.total_cents)}</small>
                </div>
              ))}
            </div>
            <button type="button" className="btn btn-primary btn-block" onClick={() => void load(ticket.id)}>
              <Send size={17} /> Ambil & lanjut
            </button>
          </article>
        ))}
        {tickets.length === 0 ? (
          <div className="empty-state compact">
            <ListOrdered size={38} />
            <h3>Belum ada order masuk</h3>
            <p>Order dari terminal order station akan muncul di sini secara otomatis.</p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
