import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  CloudOff,
  Database,
  HardDrive,
  Monitor,
  Printer,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Trash2,
  UserRound,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { usePos, selectPrinter } from '../store';
import { checkHealth, loadSettings } from '../lib/api';
import { isTauri } from '../lib/localdb';
import { openCashDrawer, printTestJob } from '../lib/printer';
import { closeSecondDisplay } from '../lib/display';
import { AuthModal } from '../components/AuthModal';
import { dateTime } from '../lib/format';

export function SettingsPage() {
  const boot = usePos((state) => state.boot);
  const user = usePos((state) => state.user);
  const online = usePos((state) => state.online);
  const settings = usePos((state) => state.settings);
  const localDb = usePos((state) => state.localDb);
  const pending = usePos((state) => state.pending);
  const syncing = usePos((state) => state.syncing);
  const cacheAt = usePos((state) => state.cacheAt);
  const applySettings = usePos((state) => state.applySettings);
  const leaveSettings = usePos((state) => state.leaveSettings);
  const syncNow = usePos((state) => state.syncNow);
  const toast = usePos((state) => state.toast);
  const openDisplay = usePos((state) => state.openDisplay);
  const lock = usePos((state) => state.lock);
  const logout = usePos((state) => state.logout);

  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [clientToken, setClientToken] = useState(settings.clientToken);
  const [mysqlUrl, setMysqlUrl] = useState(settings.mysqlUrl);
  const [autoPrint, setAutoPrint] = useState(settings.autoPrint);
  const [openDisplayOnStart, setOpenDisplayOnStart] = useState(settings.openDisplayOnStart);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);

  useEffect(() => {
    setBaseUrl(settings.baseUrl);
    setClientToken(settings.clientToken);
    setMysqlUrl(settings.mysqlUrl);
    setAutoPrint(settings.autoPrint);
    setOpenDisplayOnStart(settings.openDisplayOnStart);
  }, [settings]);

  const save = async () => {
    setSaving(true);
    try {
      await applySettings({ baseUrl, clientToken, mysqlUrl, autoPrint, openDisplayOnStart });
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const result = await checkHealth(baseUrl);
      toast(`Server merespons · v${result.version || '?'} · ${dateTime(result.time)}`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Koneksi gagal.', 'warn');
    } finally {
      setTesting(false);
    }
  };

  const testPrinter = async (purpose: 'receipt' | 'kitchen') => {
    if (!boot) return;
    const printer = selectPrinter(purpose);
    if (!printer) {
      toast('Printer belum dikonfigurasi di HQ.', 'warn');
      return;
    }
    const result = await printTestJob(printer, boot.brand, boot.outlet);
    toast(result.message, result.ok ? 'success' : 'warn');
  };

  const drawer = async () => {
    const printer = selectPrinter('receipt');
    if (!printer) {
      toast('Printer penerima belum dikonfigurasi.', 'warn');
      return;
    }
    const result = await openCashDrawer(printer);
    toast(result.message, result.ok ? 'success' : 'warn');
  };

  const clearMediaCache = async () => {
    try {
      if ('caches' in window) await caches.delete('workapos-media-v1');
      toast('Cache media layar kedua dibersihkan.', 'success');
    } catch {
      toast('Cache media tidak dapat dibersihkan.', 'warn');
    }
  };

  const savedSettings = loadSettings();
  const dirty = baseUrl !== savedSettings.baseUrl
    || clientToken !== savedSettings.clientToken
    || mysqlUrl !== savedSettings.mysqlUrl
    || autoPrint !== savedSettings.autoPrint
    || openDisplayOnStart !== savedSettings.openDisplayOnStart;

  return (
    <div className="settings-screen">
      <div className="settings-head">
        <button type="button" className="btn btn-ghost btn-sm" onClick={leaveSettings}>
          <ArrowLeft size={18} /> Kembali
        </button>
        <div>
          <span className="eyebrow"><ShieldCheck size={14} /> Administrator</span>
          <h1>Pengaturan Terminal</h1>
          <p>Koneksi, perangkat, cache lokal, dan perdagangan.</p>
        </div>
        <span className={`badge ${online ? 'badge-green' : 'badge-red'}`}>
          {online ? <Wifi size={15} /> : <WifiOff size={15} />} {online ? 'Online' : 'Offline'}
        </span>
      </div>

      <div className="settings-grid">
        <section className="settings-card span-2">
          <div className="settings-card-head">
            <span className="settings-icon"><Server size={21} /></span>
            <div>
              <h2>Koneksi HQ</h2>
              <p>Alamat server pusat dan identitas terminal.</p>
            </div>
            {dirty ? <span className="badge badge-amber">Belum disimpan</span> : null}
          </div>
          <div className="form-grid">
            <label className="field span-2">
              <span>Alamat server (API)</span>
              <input className="input" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://server-hq:8080" />
              <small>Contoh: http://192.168.1.10:8080</small>
            </label>
            <label className="field span-2">
              <span>Client token</span>
              <input className="input mono" value={clientToken} onChange={(event) => setClientToken(event.target.value)} placeholder="wpos_…" />
              <small>Token ini mengikat terminal ke brand dan outlet.</small>
            </label>
            <label className="field span-2">
              <span>MySQL lokal (cache offline)</span>
              <input className="input mono" value={mysqlUrl} onChange={(event) => setMysqlUrl(event.target.value)} placeholder="mysql://root:password@127.0.0.1:3307/workapos_pos" />
              <small>Dipakai aplikasi Tauri di Linux. Port dapat diubah bebas.</small>
            </label>
          </div>
          <div className="settings-actions">
            <button type="button" className="btn btn-ghost" onClick={() => void testConnection()} disabled={testing}>
              <RefreshCw size={17} className={testing ? 'spin' : ''} /> Tes koneksi
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
              <Save size={17} /> {saving ? 'Menyimpan…' : 'Simpan & hubungkan'}
            </button>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-head">
            <span className="settings-icon"><HardDrive size={21} /></span>
            <div>
              <h2>Terminal</h2>
              <p>Identitas perangkat saat ini.</p>
            </div>
          </div>
          <dl className="info-list">
            <div><dt>Brand</dt><dd>{boot?.brand.name || '—'}</dd></div>
            <div><dt>Outlet</dt><dd>{boot?.outlet.name || '—'}</dd></div>
            <div><dt>Client</dt><dd>{boot ? `${boot.client.name} · ${boot.client.code}` : '—'}</dd></div>
            <div><dt>Jenis</dt><dd>{boot?.client.kind === 'order_station' ? 'Order station' : 'Kasir'}</dd></div>
            <div><dt>Tipe aplikasi</dt><dd>{isTauri() ? 'Tauri desktop' : 'Browser'}</dd></div>
            <div><dt>Data terakhir</dt><dd>{cacheAt ? dateTime(cacheAt) : '—'}</dd></div>
          </dl>
        </section>

        <section className="settings-card">
          <div className="settings-card-head">
            <span className="settings-icon"><Database size={21} /></span>
            <div>
              <h2>Cache offline</h2>
              <p>Antrean transaksi yang belum terkirim.</p>
            </div>
          </div>
          <div className="local-db-status">
            <span className={`status-dot ${localDb.connected ? 'on' : 'off'}`} />
            <div>
              <strong>{localDb.connected ? 'MySQL lokal terhubung' : 'IndexedDB browser'}</strong>
              <small>{localDb.error || localDb.url}</small>
            </div>
          </div>
          <div className="stat-row">
            <div><strong>{pending}</strong><span>antrean</span></div>
            <div><strong>{syncing ? '…' : 'OK'}</strong><span>sinkronisasi</span></div>
          </div>
          <div className="settings-actions">
            <button type="button" className="btn btn-ghost" onClick={() => void syncNow()} disabled={syncing}>
              <RefreshCw size={17} className={syncing ? 'spin' : ''} /> Sinkron sekarang
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void clearMediaCache()}>
              <Trash2 size={17} /> Cache media
            </button>
          </div>
          {pending > 0 ? (
            <div className="inline-note"><CloudOff size={16} /> Data aman di perangkat sampai berhasil dikirim.</div>
          ) : null}
        </section>

        <section className="settings-card span-2">
          <div className="settings-card-head">
            <span className="settings-icon"><Printer size={21} /></span>
            <div>
              <h2>Printer & laci</h2>
              <p>Printer jaringan ESC/POS dikelola dari HQ.</p>
            </div>
          </div>
          <div className="printer-list">
            {(boot?.printers || []).map((printer) => (
              <div key={printer.id} className="printer-row">
                <span className={`printer-purpose ${printer.purpose}`}>{printer.purpose === 'kitchen' ? 'Dapur' : 'Struk'}</span>
                <div>
                  <strong>{printer.name}</strong>
                  <small>{printer.ip}:{printer.port} · {printer.paper_width}mm · {printer.model || 'ESC/POS'}</small>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void testPrinter(printer.purpose === 'kitchen' ? 'kitchen' : 'receipt')}>
                  Tes cetak
                </button>
              </div>
            ))}
            {(!boot?.printers || boot.printers.length === 0) ? (
              <div className="empty-mini">Belum ada printer. Tambahkan dari HQ.</div>
            ) : null}
          </div>
          <div className="settings-actions">
            <button type="button" className="btn btn-ghost" onClick={() => void drawer()}>
              Buka laci kasir
            </button>
            <label className="toggle-row">
              <input type="checkbox" checked={autoPrint} onChange={(event) => setAutoPrint(event.target.checked)} />
              <span>Cetak struk & tiket otomatis</span>
            </label>
          </div>
        </section>

        <section className="settings-card span-2">
          <div className="settings-card-head">
            <span className="settings-icon"><Monitor size={21} /></span>
            <div>
              <h2>Layar kedua</h2>
              <p>Slideshow media caching lokal, berubah menjadi ringkasan saat pembayaran.</p>
            </div>
          </div>
          <div className="display-settings">
            <div className="display-preview">
              <div className="display-preview-left">
                <span>Order</span>
                <strong>2 item</strong>
                <small>Rp 98.000</small>
              </div>
              <div className="display-preview-right">
                <span>{boot?.brand.name || 'WORKAPOS'}</span>
                <small>{boot?.display_assets.length || 0} media aktif</small>
              </div>
            </div>
            <div className="display-copy">
              <p>Media dari HQ disimpan di cache perangkat. Jika HQ menghapus media, cache lokal ikut dibersihkan.</p>
              <label className="toggle-row">
                <input type="checkbox" checked={openDisplayOnStart} onChange={(event) => setOpenDisplayOnStart(event.target.checked)} />
                <span>Buka layar kedua saat aplikasi mulai (Tauri)</span>
              </label>
            </div>
          </div>
          <div className="settings-actions">
            <button type="button" className="btn btn-primary" onClick={() => void openDisplay()}>
              <Monitor size={17} /> Buka layar kedua
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void closeSecondDisplay()}>
              Tutup layar kedua
            </button>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-head">
            <span className="settings-icon"><UserRound size={21} /></span>
            <div>
              <h2>Akun</h2>
              <p>Hak akses yang berlaku sekarang.</p>
            </div>
          </div>
          <div className="account-card">
            <span className="avatar large" style={{ background: user?.avatar_color || '#f59e0b' }}>
              {user?.name?.slice(0, 2).toUpperCase() || '?'}
            </span>
            <div>
              <strong>{user?.name || 'Belum ada pengguna'}</strong>
              <small>{user?.role_name || '—'} · NIK {user?.nik || '—'}</small>
            </div>
            {user?.is_admin ? <ShieldCheck size={20} className="admin-mark" /> : null}
          </div>
          <div className="permission-chips">
            {(user?.permissions || []).map((permission) => <span key={permission}>{permission}</span>)}
            {user?.is_admin ? <span className="admin-chip">semua akses</span> : null}
          </div>
          <div className="settings-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setSwitchOpen(true)} disabled={!boot}>
              Ganti pengguna
            </button>
            <button type="button" className="btn btn-ghost" onClick={lock} disabled={!user}>Kunci</button>
            <button type="button" className="btn btn-danger-ghost" onClick={logout}>Keluar</button>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-head">
            <span className="settings-icon"><CheckCircle2 size={21} /></span>
            <div>
              <h2>Kesiapan</h2>
              <p>Pemeriksaan cepat sebelum jam sibuk.</p>
            </div>
          </div>
          <ul className="check-list">
            <li className={online ? 'ok' : 'bad'}>{online ? 'Terhubung ke HQ' : 'HQ tidak terjangkau'}</li>
            <li className={pending === 0 ? 'ok' : 'warn'}>{pending === 0 ? 'Semua transaksi tersinkron' : `${pending} transaksi menunggu`}</li>
            <li className={boot?.printers.length ? 'ok' : 'warn'}>{boot?.printers.length ? `${boot.printers.length} printer terdaftar` : 'Printer belum dikonfigurasi'}</li>
            <li className={boot?.client.second_display ? 'ok' : 'warn'}>{boot?.client.second_display ? 'Layar kedua diaktifkan' : 'Layar kedua nonaktif'}</li>
            <li className={boot?.display_assets.length ? 'ok' : 'warn'}>{boot?.display_assets.length || 0} media slideshow</li>
          </ul>
        </section>
      </div>

      <AuthModal open={switchOpen} mode="switch" onClose={() => setSwitchOpen(false)} />
    </div>
  );
}
