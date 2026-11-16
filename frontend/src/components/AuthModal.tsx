import { useEffect, useMemo, useState } from 'react';
import { compare } from 'bcryptjs';
import { ShieldCheck, UserRound } from 'lucide-react';
import { Modal } from './Modal';
import { Keypad, PinDots } from './Keypad';
import { usePos } from '../store';
import { posLogin } from '../lib/api';
import { initials } from '../lib/format';

type AuthMode = 'switch' | 'admin' | 'unlock';

interface AuthModalProps {
  open: boolean;
  mode: AuthMode;
  onClose: () => void;
  onSuccess?: () => void;
}

export function AuthModal({ open, mode, onClose, onSuccess }: AuthModalProps) {
  const boot = usePos((state) => state.boot);
  const currentUser = usePos((state) => state.user);
  const authenticate = usePos((state) => state.authenticate);
  const unlock = usePos((state) => state.unlock);
  const toast = usePos((state) => state.toast);

  const candidates = useMemo(() => {
    if (!boot) return [];
    if (mode === 'unlock' && currentUser) return [currentUser];
    if (mode === 'admin') return boot.users.filter((user) => user.is_admin);
    return boot.users;
  }, [boot, mode, currentUser]);

  const [nik, setNik] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setPin('');
    setError('');
    if (mode === 'unlock' && currentUser) {
      setNik(currentUser.nik);
    } else {
      setNik('');
    }
  }, [open, mode, currentUser]);

  const selected = candidates.find((user) => user.nik === nik);

  const submit = async () => {
    if (busy) return;
    if (!nik.trim()) {
      setError('Pilih pengguna atau masukkan NIK.');
      return;
    }
    if (!pin) {
      setError('Masukkan PIN.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (mode === 'unlock') {
        const result = await unlock(pin);
        if (!result.ok) {
          setError(result.message || 'PIN tidak sesuai.');
          setPin('');
          return;
        }
        toast('Layar dibuka.', 'success');
        onSuccess?.();
        onClose();
        return;
      }

      if (mode === 'switch') {
        const result = await authenticate(nik, pin, true);
        if (!result.ok) {
          setError(result.message || 'Login gagal.');
          setPin('');
          return;
        }
        onSuccess?.();
        onClose();
        return;
      }

      // Admin verification: never replace the active cashier session.
      try {
        const result = await posLogin(nik, pin);
        if (!result.user.is_admin) {
          setError('Akun ini bukan administrator.');
          setPin('');
          return;
        }
      } catch (networkError) {
        const user = boot?.users.find((candidate) => candidate.nik === nik);
        if (!user?.is_admin || !user.pin_hash) {
          setError('Verifikasi admin gagal.');
          setPin('');
          return;
        }
        const valid = await compare(pin, user.pin_hash);
        if (!valid) {
          setError(networkError instanceof Error ? 'PIN admin tidak sesuai.' : 'Verifikasi admin gagal.');
          setPin('');
          return;
        }
      }
      toast('Akses administrator diberikan.', 'success');
      onSuccess?.();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<AuthMode, { title: string; subtitle: string }> = {
    switch: {
      title: 'Ganti Pengguna',
      subtitle: 'Keranjang tetap tersimpan. Izin langsung mengikuti pengguna baru.',
    },
    admin: {
      title: 'Verifikasi Administrator',
      subtitle: 'Pengaturan terminal hanya dapat dibuka oleh administrator.',
    },
    unlock: {
      title: 'Layar Terkunci',
      subtitle: currentUser ? `Masukkan PIN ${currentUser.name} untuk melanjutkan.` : 'Masukkan PIN.',
    },
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={titles[mode].title}
      subtitle={titles[mode].subtitle}
      size="md"
    >
      <div className="auth-modal">
        {mode !== 'unlock' ? (
          <div className="auth-users">
            {candidates.map((user) => (
              <button
                key={user.id}
                type="button"
                className={`auth-user ${nik === user.nik ? 'active' : ''}`}
                onClick={() => {
                  setNik(user.nik);
                  setPin('');
                  setError('');
                }}
              >
                <span className="avatar" style={{ background: user.avatar_color }}>
                  {initials(user.name)}
                </span>
                <span className="auth-user-copy">
                  <strong>{user.name}</strong>
                  <small>{user.role_name}{user.is_admin ? ' · Admin' : ''}</small>
                </span>
                {user.is_admin ? <ShieldCheck size={18} className="admin-mark" /> : <UserRound size={18} className="muted-icon" />}
              </button>
            ))}
            {candidates.length === 0 ? (
              <div className="empty-mini">Tidak ada pengguna yang sesuai.</div>
            ) : null}
          </div>
        ) : (
          <div className="unlock-user">
            <span className="avatar avatar-xl" style={{ background: currentUser?.avatar_color || '#f59e0b' }}>
              {initials(currentUser?.name || '?')}
            </span>
            <strong>{currentUser?.name}</strong>
            <small>{currentUser?.role_name}</small>
          </div>
        )}

        <div className="auth-entry">
          {mode !== 'unlock' ? (
            <label className="field">
              <span>NIK</span>
              <input
                className="input"
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
          ) : null}

          <div className="pin-display">
            <span className="pin-label">PIN {selected ? `· ${selected.name}` : ''}</span>
            <PinDots length={pin.length} />
          </div>

          <Keypad value={pin} onChange={(value) => { setPin(value); setError(''); }} maxLength={8} disabled={busy} />

          {error ? <div className="form-error">{error}</div> : null}

          <button
            type="button"
            className="btn btn-primary btn-block btn-lg"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? 'Memeriksa…' : mode === 'admin' ? 'Buka Pengaturan' : mode === 'unlock' ? 'Buka Layar' : 'Masuk'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
