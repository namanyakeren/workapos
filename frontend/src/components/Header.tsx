import { useState } from 'react';
import {
  ListOrdered,
  Lock,
  LogOut,
  Monitor,
  RefreshCw,
  Settings,
  ShieldCheck,
  UserRound,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { usePos } from '../store';
import { initials } from '../lib/format';
import { AuthModal } from './AuthModal';
import { TicketDrawer } from './TicketDrawer';

export function Header() {
  const boot = usePos((state) => state.boot);
  const user = usePos((state) => state.user);
  const mode = usePos((state) => state.mode);
  const table = usePos((state) => state.table);
  const screen = usePos((state) => state.screen);
  const online = usePos((state) => state.online);
  const realtime = usePos((state) => state.realtime);
  const pending = usePos((state) => state.pending);
  const syncing = usePos((state) => state.syncing);
  const tickets = usePos((state) => state.tickets);
  const activeTicket = usePos((state) => state.activeTicket);
  const switchOpen = useState(false);
  const [switching, setSwitching] = switchOpen;
  const [adminGate, setAdminGate] = useState(false);
  const [ticketsOpen, setTicketsOpen] = useState(false);
  const goSettings = usePos((state) => state.goSettings);
  const lock = usePos((state) => state.lock);
  const logout = usePos((state) => state.logout);
  const syncNow = usePos((state) => state.syncNow);
  const openDisplay = usePos((state) => state.openDisplay);
  const toast = usePos((state) => state.toast);
  const selectTable = usePos((state) => state.selectTable);

  if (!boot || !user) return null;
  const orderStation = boot.client.kind === 'order_station';

  const openSettings = () => {
    if (user.is_admin) {
      goSettings();
    } else {
      setAdminGate(true);
    }
  };

  const handleDisplay = async () => {
    const result = await openDisplay();
    toast(result.message, result.ok ? 'success' : 'warn');
  };

  return (
    <>
      <header className="app-header">
        <div className="header-brand">
          <div className="brand-mark" style={{ '--brand': boot.brand.color } as React.CSSProperties}>
            <span>{boot.brand.code.slice(0, 2)}</span>
          </div>
          <div className="header-brand-copy">
            <strong>{boot.brand.name}</strong>
            <small>{boot.outlet.name} · {boot.client.code}</small>
          </div>
          {orderStation ? <span className="badge badge-orange">Order Station</span> : null}
        </div>

        <div className="header-context">
          {mode ? (
            <button
              type="button"
              className="context-chip"
              onClick={() => usePos.setState({ screen: 'mode' })}
              title="Ganti jenis penjualan"
            >
              {mode.name}
            </button>
          ) : null}
          {mode?.template === 'table_service' ? (
            <button
              type="button"
              className="context-chip"
              onClick={() => usePos.setState({ screen: 'table' })}
              title="Ganti meja"
            >
              {table ? table.name : 'Tanpa meja'}
            </button>
          ) : null}
          {activeTicket ? (
            <span className="badge badge-teal">Ticket {activeTicket.ticket_no}</span>
          ) : null}
        </div>

        <div className="header-actions">
          {pending > 0 ? (
            <button type="button" className="sync-pill" onClick={() => void syncNow()} title="Sinkronkan sekarang">
              <RefreshCw size={15} className={syncing ? 'spin' : ''} />
              {pending} antre
            </button>
          ) : null}

          <span className={`connection-pill compact ${online ? 'online' : 'offline'}`} title={realtime === 'online' ? 'Realtime tersambung' : 'Realtime terputus'}>
            {online ? <Wifi size={15} /> : <WifiOff size={15} />}
            {online ? 'Online' : 'Offline'}
          </span>

          {!orderStation && screen === 'order' ? (
            <button type="button" className="icon-btn with-count" onClick={() => setTicketsOpen(true)} title="Order masuk">
              <ListOrdered size={20} />
              {tickets.length > 0 ? <span className="count-badge">{tickets.length}</span> : null}
            </button>
          ) : null}

          <button type="button" className="icon-btn" onClick={() => void handleDisplay()} title="Layar kedua">
            <Monitor size={20} />
          </button>

          <button type="button" className="user-chip" onClick={() => setSwitching(true)} title="Ganti pengguna">
            <span className="avatar small" style={{ background: user.avatar_color }}>{initials(user.name)}</span>
            <span className="user-chip-copy">
              <strong>{user.name}</strong>
              <small>{user.role_name}</small>
            </span>
            {user.is_admin ? <ShieldCheck size={15} className="admin-mark" /> : <UserRound size={15} className="muted-icon" />}
          </button>

          <button type="button" className="icon-btn" onClick={openSettings} title="Pengaturan (admin)">
            <Settings size={20} />
          </button>
          <button type="button" className="icon-btn" onClick={lock} title="Kunci layar">
            <Lock size={20} />
          </button>
          <button type="button" className="icon-btn danger-hover" onClick={logout} title="Keluar">
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <AuthModal
        open={switching}
        mode="switch"
        onClose={() => setSwitching(false)}
      />
      <AuthModal
        open={adminGate}
        mode="admin"
        onClose={() => setAdminGate(false)}
        onSuccess={goSettings}
      />
      <TicketDrawer open={ticketsOpen} onClose={() => setTicketsOpen(false)} />
    </>
  );
}
