import { useEffect, useMemo, useState } from 'react';
import {
  Clock,
  MapPin,
  RefreshCw,
  Settings,
  ShieldCheck,
  Store,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { usePos } from '../store';
import { Keypad, PinDots } from '../components/Keypad';
import { AuthModal } from '../components/AuthModal';
import { initials } from '../lib/format';

export function LoginPage() {
  const boot = usePos((state) => state.boot);
  const loading = usePos((state) => state.loading);
  const bootError = usePos((state) => state.bootError);
  const online = usePos((state) => state.online);
  const realtime = usePos((state) => state.realtime);
  const authenticate = usePos((state) => state.authenticate);
  const refreshBootstrap = usePos((state) => state.refreshBootstrap);
  const goSettings = usePos((state) => state.goSettings);

  const [nik, setNik] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [adminGate, setAdminGate] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const users = useMemo(() => {
    if (!boot) return [];
    return [...boot.users].sort((a, b) => Number(b.is_admin) - Number(a.is_admin));
  }, [boot]);

  const selected = users.find((user) => user.nik === nik);

  const submit = async () => {
    if (busy) return;
    if (!nik.trim()) {
      setError('Pilih nama Anda atau masukkan NIK.');
      return;
    }
    if (!pin) {
      setError('Masukkan PIN.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await authenticate(nik, pin);
    setBusy(false);
    if (!result.ok) {
      setError(result.message || 'Login gagal.');
      setPin('');
    }
  };

  const openSettings = () => {
    if (boot) {
      setAdminGate(true);
    } else {
      goSettings();
    }
  };

  const time = new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit', minute: '2-digit',
  }).format(now);

  return (
    <div className="login-screen">
      <div className="login-visual">
        <div className="login-glow one" />
        <div className="login-glow two" />
        <div className="login-brand-block">
          <div className="brand-mark big" style={{ '--brand': boot?.brand.color || '#f59e0b' } as React.CSSProperties}>
            <span>W</span>
          </div>
          <div>
            <div className="wordmark">WORKAPOS</div>
            <div className="wordmark-sub">Point of Sale · Terminal</div>
          </div>
        </div>

        <div className="login-hero">
          <div className="hero-kicker">{loading ? 'Menyiapkan terminal' : 'Siap melayani'}</div>
          <h1>{boot?.brand.name || 'Satu sistem untuk semua outlet.'}</h1>
          <p>
            {boot
              ? `Kelola order, pembayaran, dapur, dan layar pelanggan dari satu layar sentuh.`
              : 'Hubungkan terminal ke server HQ untuk memuat katalog, meja, dan pengguna.'}
          </p>
        </div>

        <div className="login-meta">
          {boot ? (
            <>
              <div className="meta-card">
                <Store size={19} />
                <div>
                  <small>Outlet</small>
                  <strong>{boot.outlet.name}</strong>
                </div>
              </div>
              <div className="meta-card">
                <MapPin size={19} />
                <div>
                  <small>Terminal</small>
                  <strong>{boot.client.name}</strong>
                </div>
              </div>
              <div className="meta-card">
                <Clock size={19} />
                <div>
                  <small>Waktu</small>
                  <strong>{time}</strong>
                </div>
              </div>
            </>
          ) : (
            <div className="meta-card wide">
              <WifiOff size={19} />
              <div>
                <small>Terminal belum terhubung</small>
                <strong>{bootError || 'Periksa alamat server di pengaturan.'}</strong>
              </div>
            </div>
          )}
        </div>

        <div className="login-footer">
          <span className={`connection-pill ${online ? 'online' : 'offline'}`}>
            {online ? <Wifi size={15} /> : <WifiOff size={15} />}
            {online ? 'HQ tersambung' : 'Mode offline'}
            <i />
            {realtime === 'online' ? 'Realtime' : realtime === 'connecting' ? 'Menyambung' : 'Realtime off'}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={openSettings}>
            <Settings size={17} /> Pengaturan
          </button>
        </div>
      </div>

      <div className="login-panel">
        <div className="login-panel-head">
          <div>
            <span className="eyebrow">Masuk terminal</span>
            <h2>Selamat datang</h2>
            <p>Pilih nama Anda, lalu masukkan PIN.</p>
          </div>
          <button type="button" className="icon-btn" onClick={() => void refreshBootstrap()} title="Muat ulang data HQ">
            <RefreshCw size={20} className={loading ? 'spin' : ''} />
          </button>
        </div>

        <div className="user-grid">
          {users.map((user) => (
            <button
              key={user.id}
              type="button"
              className={`user-tile ${nik === user.nik ? 'active' : ''}`}
              onClick={() => {
                setNik(user.nik);
                setPin('');
                setError('');
              }}
            >
              <span className="avatar" style={{ background: user.avatar_color }}>{initials(user.name)}</span>
              <span>
                <strong>{user.name}</strong>
                <small>{user.role_name}</small>
              </span>
              {user.is_admin ? <ShieldCheck size={17} className="admin-mark" /> : null}
            </button>
          ))}
          {users.length === 0 ? (
            <div className="empty-mini wide">
              {loading ? 'Memuat pengguna…' : 'Pengguna belum tersedia. Periksa koneksi HQ.'}
            </div>
          ) : null}
        </div>

        <div className="login-form">
          <label className="field">
            <span>NIK</span>
            <input
              className="input input-lg"
              value={nik}
              inputMode="numeric"
              autoComplete="off"
              placeholder="Masukkan NIK"
              onChange={(event) => {
                setNik(event.target.value.replace(/[^\d]/g, ''));
                setPin('');
                setError('');
              }}
            />
          </label>

          <div className="pin-display">
            <span className="pin-label">PIN {selected ? `· ${selected.name}` : ''}</span>
            <PinDots length={pin.length} />
          </div>

          <Keypad
            value={pin}
            onChange={(value) => { setPin(value); setError(''); }}
            maxLength={8}
            disabled={busy}
          />

          {error ? <div className="form-error">{error}</div> : null}

          <button type="button" className="btn btn-primary btn-block btn-xl" disabled={busy || !boot} onClick={() => void submit()}>
            {busy ? 'Memeriksa…' : 'Masuk'}
          </button>
        </div>
      </div>

      <AuthModal
        open={adminGate}
        mode="admin"
        onClose={() => setAdminGate(false)}
        onSuccess={() => goSettings()}
      />
    </div>
  );
}
