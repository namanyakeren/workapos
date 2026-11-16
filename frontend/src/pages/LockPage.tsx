import { useEffect, useState } from 'react';
import { ArrowRight, LockKeyhole, LogOut, ShieldCheck } from 'lucide-react';
import { usePos } from '../store';
import { Keypad, PinDots } from '../components/Keypad';
import { initials } from '../lib/format';

export function LockPage() {
  const user = usePos((state) => state.user);
  const boot = usePos((state) => state.boot);
  const unlock = usePos((state) => state.unlock);
  const logout = usePos((state) => state.logout);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!user) return null;

  const submit = async () => {
    if (!pin || busy) return;
    setBusy(true);
    setError('');
    const result = await unlock(pin);
    setBusy(false);
    if (!result.ok) {
      setError(result.message || 'PIN tidak sesuai.');
      setPin('');
    }
  };

  return (
    <div className="lock-screen">
      <div className="lock-visual" style={{ '--brand': boot?.brand.color || '#f59e0b' } as React.CSSProperties}>
        <div className="lock-clock">
          <strong>{new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(now)}</strong>
          <span>{new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long' }).format(now)}</span>
        </div>
        <div className="lock-brand">
          <LockKeyhole size={22} />
          <strong>{boot?.brand.name || 'WORKAPOS'}</strong>
          <small>{boot?.outlet.name}</small>
        </div>
      </div>

      <div className="lock-panel">
        <span className="avatar avatar-xl" style={{ background: user.avatar_color }}>{initials(user.name)}</span>
        <h1>{user.name}</h1>
        <p>{user.role_name} · Layar terkunci</p>
        {user.is_admin ? <span className="badge badge-amber"><ShieldCheck size={14} /> Administrator</span> : null}

        <div className="pin-display centered">
          <PinDots length={pin.length} />
        </div>

        <Keypad
          value={pin}
          onChange={(value) => { setPin(value); setError(''); }}
          maxLength={8}
          disabled={busy}
          onSubmit={() => void submit()}
        />

        {error ? <div className="form-error">{error}</div> : null}

        <button type="button" className="btn btn-primary btn-block btn-xl" disabled={busy || !pin} onClick={() => void submit()}>
          {busy ? 'Membuka…' : 'Buka Layar'} <ArrowRight size={20} />
        </button>
        <button type="button" className="btn btn-ghost btn-block" onClick={logout}>
          <LogOut size={17} /> Keluar terminal
        </button>
      </div>
    </div>
  );
}
