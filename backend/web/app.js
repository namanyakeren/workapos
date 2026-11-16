/* WORKAPOS HQ — browser command center */
(() => {
  'use strict';

  const SESSION_KEY = 'wpos_hq_session_v1';
  const PERMISSIONS = [
    ['pos.order', 'Create order'],
    ['pos.payment', 'Take payment'],
    ['pos.discount', 'Apply discount'],
    ['pos.void', 'Void item / bill'],
    ['pos.refund', 'Refund'],
    ['pos.reprint', 'Reprint receipt'],
    ['pos.cash_drawer', 'Open cash drawer'],
    ['pos.price_override', 'Price override'],
    ['report.view', 'View reports'],
  ];

  const NAV = [
    {
      label: 'Workspace',
      items: [
        { id: 'dashboard', label: 'Command Center', icon: 'grid' },
        { id: 'live', label: 'Live Sales', icon: 'receipt' },
        { id: 'reports', label: 'Sales Reports', icon: 'chart' },
        { id: 'presence', label: 'Remote Terminals', icon: 'command' },
      ],
    },
    {
      label: 'Network',
      items: [
        { id: 'brands', label: 'Brands', icon: 'briefcase' },
        { id: 'outlets', label: 'Outlets', icon: 'store' },
        { id: 'clients', label: 'Clients', icon: 'monitor' },
        { id: 'printers', label: 'Printers', icon: 'printer' },
        { id: 'assets', label: 'Display Media', icon: 'image' },
      ],
    },
    {
      label: 'Catalog',
      items: [
        { id: 'sales-modes', label: 'Sales Modes', icon: 'utensils' },
        { id: 'tables', label: 'Tables', icon: 'table' },
        { id: 'product-groups', label: 'Product Groups', icon: 'package' },
        { id: 'products', label: 'Products', icon: 'coffee' },
        { id: 'payment-groups', label: 'Payment Groups', icon: 'wallet' },
        { id: 'payment-types', label: 'Payment Types', icon: 'card' },
        { id: 'promotions', label: 'Promotions', icon: 'gift' },
      ],
    },
    {
      label: 'Access',
      items: [
        { id: 'roles', label: 'Roles', icon: 'shield' },
        { id: 'users', label: 'Users', icon: 'users' },
      ],
    },
  ];

  const VIEW_META = {
    dashboard: ['Overview', 'Command Center', 'Ringkasan performa seluruh brand dan outlet secara real-time.'],
    live: ['Overview', 'Live Sales', 'Pantau transaksi yang masuk dari setiap terminal detik ini.'],
    reports: ['Overview', 'Sales Reports', 'Analisis penjualan per jam, brand, outlet, produk, dan bill.'],
    presence: ['Network', 'Remote Terminals', 'Lihat dan kendalikan client POS yang tersebar di semua outlet.'],
    brands: ['Network', 'Brands', 'Identitas dan kebijakan pajak setiap brand.'],
    outlets: ['Network', 'Outlets', 'Jaringan outlet yang berada di bawah setiap brand.'],
    clients: ['Network', 'Clients', 'Terminal kasir, master, dan order station di seluruh outlet.'],
    printers: ['Network', 'Printers', 'Printer jaringan yang dideploy ke outlet tertentu.'],
    assets: ['Network', 'Display Media', 'Slideshow untuk second display, otomatis disinkronkan ke client.'],
    'sales-modes': ['Catalog', 'Sales Modes', 'Tombol mode penjualan yang tampil di POS fast food.'],
    tables: ['Catalog', 'Tables', 'Denah meja untuk operasional table service.'],
    'product-groups': ['Catalog', 'Product Groups', 'Kategori produk yang dideploy per brand dan outlet.'],
    products: ['Catalog', 'Products', 'Menu, harga, dan ketersediaan produk di setiap outlet.'],
    'payment-groups': ['Catalog', 'Payment Groups', 'Pengelompokan metode pembayaran.'],
    'payment-types': ['Catalog', 'Payment Types', 'Metode pembayaran yang boleh dipakai kasir.'],
    promotions: ['Catalog', 'Promotions', 'Diskon otomatis dan promo yang berlaku di outlet.'],
    roles: ['Access', 'Roles', 'Izin operasional yang dapat diberikan ke setiap user.'],
    users: ['Access', 'Users', 'Karyawan, PIN, role, dan penempatan brand/outlet.'],
  };

  const state = {
    view: 'dashboard',
    refs: { brands: [], outlets: [], groups: [], paymentGroups: [], roles: [] },
    filters: {},
    entityData: {},
    users: [],
    assets: [],
    liveEvents: [],
    lastDashboard: null,
    eventSource: null,
    refreshTimer: null,
    authExpired: false,
  };

  let session = null;
  try {
    session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch { session = null; }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const icon = (name, cls = '') => `<svg class="icon ${cls}"><use href="#i-${name}"></use></svg>`;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const rupiah = new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  });
  const numberFmt = new Intl.NumberFormat('id-ID');
  const money = (cents) => rupiah.format(Number(cents || 0) / 100);
  const compactMoney = (cents) => {
    const value = Number(cents || 0) / 100;
    if (Math.abs(value) >= 1_000_000_000) return `Rp ${(value / 1_000_000_000).toFixed(1).replace('.', ',')} M`;
    if (Math.abs(value) >= 1_000_000) return `Rp ${(value / 1_000_000).toFixed(1).replace('.', ',')} jt`;
    if (Math.abs(value) >= 1_000) return `Rp ${(value / 1_000).toFixed(0)} rb`;
    return `Rp ${Math.round(value)}`;
  };
  const dt = (value, withTime = true) => {
    if (!value) return '—';
    const date = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('id-ID', withTime
      ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
  };
  const relTime = (value) => {
    if (!value) return 'belum pernah';
    const date = new Date(String(value).replace(' ', 'T'));
    const diff = Math.max(0, Date.now() - date.getTime());
    if (diff < 60_000) return 'baru saja';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} menit lalu`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} jam lalu`;
    return `${Math.floor(diff / 86_400_000)} hari lalu`;
  };
  const initials = (name) => String(name || '?').split(/\s+/).slice(0, 2).map((v) => v[0]).join('').toUpperCase();
  const todayStr = () => new Date().toLocaleDateString('en-CA');

  function toast(title, message = '', type = 'success') {
    const root = $('#toast-root');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const iconName = type === 'error' ? 'x' : type === 'info' ? 'bell' : 'check';
    el.innerHTML = `<div class="t-icon">${icon(iconName, 'sm')}</div><div><strong>${esc(title)}</strong>${message ? `<p>${esc(message)}</p>` : ''}</div>`;
    root.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 260);
    }, 4200);
  }

  async function api(path, options = {}) {
    const { method = 'GET', body, auth = true, headers = {} } = options;
    const requestHeaders = { ...headers };
    if (auth && session?.token) requestHeaders.Authorization = `Bearer ${session.token}`;
    let payload = body;
    if (body !== undefined && !(body instanceof FormData)) {
      requestHeaders['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const response = await fetch(path, { method, headers: requestHeaders, body: payload });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
    if (response.status === 401 && auth) {
      expireSession();
      throw new Error('Sesi berakhir. Silakan login kembali.');
    }
    if (!response.ok) {
      throw new Error(data?.error || `Permintaan gagal (${response.status}).`);
    }
    return data;
  }

  function saveSession(payload) {
    session = payload;
    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  }

  function expireSession() {
    if (state.authExpired) return;
    state.authExpired = true;
    session = null;
    localStorage.removeItem(SESSION_KEY);
    closeEvents();
    renderLogin('Sesi Anda sudah berakhir. Silakan login kembali.');
    setTimeout(() => { state.authExpired = false; }, 1500);
  }

  function logout() {
    session = null;
    localStorage.removeItem(SESSION_KEY);
    closeEvents();
    location.hash = '';
    renderLogin();
  }

  async function boot() {
    await sleep(360);
    const bootEl = $('#boot');
    if (session?.token) {
      try {
        const me = await api('/api/auth/me');
        session.user = me.user;
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        await startApp();
      } catch {
        renderLogin();
      }
    } else {
      renderLogin();
    }
    bootEl.classList.add('hide');
  }

  function renderLogin(message = '') {
    document.title = 'Login — WORKAPOS HQ';
    $('#app').innerHTML = `
      <main class="login-screen">
        <section class="login-panel-wrap">
          <div class="login-brand">
            <div class="brand-mark">W</div>
            <div>
              <div class="brand-type">WORKAPOS <span>HQ</span></div>
              <div class="brand-sub">Command center</div>
            </div>
          </div>
          <div class="login-panel">
            <h2>Selamat datang kembali</h2>
            <p>Masuk dengan NIK dan PIN administrator yang terdaftar.</p>
            <div class="login-error ${message ? 'show' : ''}" id="login-error">${esc(message)}</div>
            <form id="login-form">
              <div class="field">
                <label for="login-nik">NIK</label>
                <div class="field-icon">${icon('users', 'sm')}<input class="input with-icon" id="login-nik" name="nik" inputmode="numeric" autocomplete="username" placeholder="Contoh: 1000" required></div>
              </div>
              <div class="field">
                <label for="login-pin">PIN</label>
                <div class="field-icon">${icon('shield', 'sm')}<input class="input with-icon" id="login-pin" name="pin" type="password" inputmode="numeric" maxlength="12" autocomplete="current-password" placeholder="••••" required></div>
              </div>
              <button class="btn primary block" id="login-submit" type="submit">${icon('power', 'sm')} Masuk ke HQ</button>
            </form>
            <div class="login-demo">
              <div class="login-demo-title">Demo access</div>
              <div class="demo-row">
                <button class="demo-pill" data-demo="1000|1234"><b>Administrator</b>NIK 1000 · PIN 1234</button>
                <button class="demo-pill" data-demo="2000|2222"><b>Manager</b>NIK 2000 · PIN 2222</button>
              </div>
            </div>
            <div class="login-foot"><span>WORKAPOS HQ v1.0</span><span>Secure session · 16 jam</span></div>
          </div>
        </section>
      </main>`;

    $('#login-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = $('#login-submit');
      const errorEl = $('#login-error');
      const nik = $('#login-nik').value.trim();
      const pin = $('#login-pin').value.trim();
      errorEl.classList.remove('show');
      button.disabled = true;
      button.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px"></span> Memverifikasi…';
      try {
        const result = await api('/api/auth/login', { method: 'POST', auth: false, body: { nik, pin } });
        saveSession({ token: result.token, user: result.user });
        await startApp();
      } catch (error) {
        errorEl.textContent = error.message;
        errorEl.classList.add('show');
        button.disabled = false;
        button.innerHTML = `${icon('power', 'sm')} Masuk ke HQ`;
      }
    });

    $$('.demo-pill').forEach((button) => {
      button.addEventListener('click', () => {
        const [nik, pin] = button.dataset.demo.split('|');
        $('#login-nik').value = nik;
        $('#login-pin').value = pin;
        $('#login-pin').focus();
      });
    });

    setTimeout(() => $('#login-nik')?.focus(), 50);
  }

  function renderShell() {
    const user = session.user;
    document.title = 'WORKAPOS HQ — Command Center';
    $('#app').innerHTML = `
      <div class="app-shell">
        <aside class="sidebar">
          <div class="sidebar-brand">
            <div class="brand-mark">W</div>
            <div>
              <div class="brand-type">WORKAPOS <span>HQ</span></div>
              <div class="brand-sub">Command center</div>
            </div>
          </div>
          <div class="nav-scroll">
            ${NAV.map((group) => `
              <div class="nav-group">
                <div class="nav-label">${group.label}</div>
                ${group.items.map((item) => `
                  <a class="nav-item" href="#${item.id}" data-nav="${item.id}" title="${item.label}">
                    ${icon(item.icon)}<span>${item.label}</span>
                  </a>`).join('')}
              </div>`).join('')}
          </div>
          <div class="sidebar-foot">
            <div class="live-chip">
              <span class="live-dot pulse" id="live-dot"></span>
              <span id="live-label">Realtime connecting…</span>
            </div>
          </div>
        </aside>
        <div class="workspace">
          <header class="topbar">
            <div class="crumb">WORKAPOS HQ <b id="crumb-current">/ Overview</b></div>
            <div class="topbar-spacer"></div>
            <div class="top-search">
              ${icon('search')}
              <input class="input" id="global-search" placeholder="Cari halaman atau data…" aria-label="Pencarian global">
            </div>
            <button class="icon-btn" id="notif-button" title="Realtime activity">${icon('bell')}<span class="notif-dot"></span></button>
            <button class="top-user" id="account-button" style="border:0;background:transparent;text-align:left">
              <div class="avatar" style="background:${esc(user.avatar_color || '#F59E0B')}">${esc(initials(user.name))}</div>
              <div class="top-user-meta"><strong>${esc(user.name)}</strong><span>${esc(user.role_name)}</span></div>
            </button>
          </header>
          <main class="view" id="view"></main>
        </div>
      </div>`;
    $('#account-button').addEventListener('click', openAccountModal);
    $('#notif-button').addEventListener('click', () => {
      toast('Realtime aktif', `${state.liveEvents.length} event diterima pada sesi ini.`, 'info');
    });
    $('#global-search').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const query = event.target.value.trim();
      if (!query) return;
      const entity = ['brands', 'outlets', 'clients', 'printers', 'products', 'users'].find((key) => key.includes(query.toLowerCase()));
      if (entity) { location.hash = entity; setTimeout(() => { const input = $('#entity-search'); if (input) { input.value = query; input.dispatchEvent(new Event('input', { bubbles: true })); } }, 350); }
      else toast('Pencarian', 'Gunakan pencarian di halaman data untuk hasil yang lebih spesifik.', 'info');
    });
  }

  async function startApp() {
    renderShell();
    try { await loadRefs(true); } catch (error) { toast('Gagal memuat referensi', error.message, 'error'); }
    connectEvents();
    if (!location.hash) history.replaceState(null, '', '#dashboard');
    await route();
  }

  async function loadRefs(force = false) {
    if (!force && state.refs.brands.length) return state.refs;
    const [brands, outlets, groups, paymentGroups, roles] = await Promise.all([
      api('/api/admin/entities/brands'),
      api('/api/admin/entities/outlets'),
      api('/api/admin/entities/product-groups'),
      api('/api/admin/entities/payment-groups'),
      api('/api/admin/entities/roles'),
    ]);
    state.refs = {
      brands: brands.data || [], outlets: outlets.data || [], groups: groups.data || [],
      paymentGroups: paymentGroups.data || [], roles: roles.data || [],
    };
    return state.refs;
  }

  async function route() {
    if (!session) return;
    const hash = (location.hash || '#dashboard').replace('#', '');
    const viewName = VIEW_META[hash] ? hash : (hash === 'users' || hash === 'assets' || hash === 'presence' ? hash : 'dashboard');
    state.view = viewName;
    $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.nav === viewName));
    const meta = VIEW_META[viewName] || VIEW_META.dashboard;
    const crumb = $('#crumb-current');
    if (crumb) crumb.textContent = `/ ${meta[1]}`;
    document.title = `${meta[1]} — WORKAPOS HQ`;
    try {
      if (ENTITIES[viewName]) return renderEntity(viewName);
      if (viewName === 'users') return renderUsers();
      if (viewName === 'assets') return renderAssets();
      if (viewName === 'reports') return renderReports();
      if (viewName === 'live') return renderLive();
      if (viewName === 'presence') return renderPresence();
      return renderDashboard();
    } catch (error) {
      toast('Gagal memuat halaman', error.message, 'error');
    }
  }

  function pageHead(kicker, title, subtitle, actions = '') {
    return `<div class="page-head">
      <div><div class="page-kicker">${esc(kicker)}</div><h1 class="page-title">${esc(title)}</h1><p class="page-sub">${esc(subtitle)}</p></div>
      ${actions ? `<div class="page-actions">${actions}</div>` : ''}
    </div>`;
  }

  function loadingView() {
    $('#view').innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  }

  function errorView(error) {
    $('#view').innerHTML = `<div class="card"><div class="empty-state">
      <div class="empty-icon">${icon('x')}</div><h3>Data belum bisa dimuat</h3><p>${esc(error.message || error)}</p>
      <button class="btn primary" onclick="location.reload()">${icon('refresh', 'sm')} Coba lagi</button>
    </div></div>`;
  }

  function openModal({ title, subtitle = '', body = '', footer = '', wide = false, narrow = false, onMount }) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-overlay" id="modal-overlay">
      <div class="modal ${wide ? 'wide' : narrow ? 'narrow' : ''}" role="dialog" aria-modal="true">
        <div class="modal-head"><div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
          <button class="icon-btn" data-close-modal aria-label="Tutup">${icon('x')}</button></div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div></div>`;
    const overlay = $('#modal-overlay');
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) closeModal(); });
    $$('[data-close-modal]', overlay).forEach((button) => button.addEventListener('click', closeModal));
    if (onMount) onMount(overlay);
    return overlay;
  }

  function closeModal() { $('#modal-root').innerHTML = ''; }

  function confirmDialog(title, message, actionLabel = 'Lanjutkan', danger = true) {
    return new Promise((resolve) => {
      openModal({
        title, subtitle: 'Konfirmasi tindakan', narrow: true,
        body: `<div class="confirm-text">${message}</div>`,
        footer: `<button class="btn ghost" data-cancel>Batal</button><button class="btn ${danger ? 'danger' : 'primary'}" data-confirm>${esc(actionLabel)}</button>`,
        onMount(overlay) {
          $('[data-cancel]', overlay).addEventListener('click', () => { closeModal(); resolve(false); });
          $('[data-confirm]', overlay).addEventListener('click', () => { closeModal(); resolve(true); });
          overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) resolve(false); });
        },
      });
    });
  }

  const ENTITIES = {
    brands: {
      key: 'brands', label: 'Brand', plural: 'Brands', icon: 'briefcase', hasBrand: false,
      search: ['name', 'code'],
      fields: [
        { key: 'name', label: 'Brand name', type: 'text', required: true, table: true },
        { key: 'code', label: 'Code', type: 'text', required: true, table: true },
        { key: 'color', label: 'Accent color', type: 'color', default: '#F59E0B' },
        { key: 'logo_url', label: 'Logo URL', type: 'text', placeholder: 'https://…' },
        { key: 'currency', label: 'Currency', type: 'text', default: 'IDR' },
        { key: 'timezone', label: 'Timezone', type: 'text', default: 'Asia/Jakarta' },
        { key: 'tax_rate', label: 'Tax rate', type: 'number', step: '0.01', default: 0, help: '0.1 = 10%' },
        { key: 'service_charge_rate', label: 'Service charge', type: 'number', step: '0.01', default: 0, help: '0.05 = 5%' },
        { key: 'active', label: 'Active', type: 'checkbox', default: true, table: true },
      ],
      tableFields: ['name', 'code', 'active'],
    },
    outlets: {
      key: 'outlets', label: 'Outlet', plural: 'Outlets', icon: 'store', hasBrand: true, hasOutlet: false,
      search: ['name', 'code', 'address'],
      fields: [
        { key: 'brand_id', label: 'Brand', type: 'select', ref: 'brands', required: true },
        { key: 'name', label: 'Outlet name', type: 'text', required: true, table: true },
        { key: 'code', label: 'Code', type: 'text', required: true, table: true },
        { key: 'address', label: 'Address', type: 'textarea', span: 2 },
        { key: 'phone', label: 'Phone', type: 'text' },
        { key: 'timezone', label: 'Timezone', type: 'text', default: 'Asia/Jakarta' },
        { key: 'active', label: 'Active', type: 'checkbox', default: true, table: true },
      ],
      tableFields: ['name', 'brand_id', 'code', 'active'],
    },
    clients: {
      key: 'clients', label: 'Client', plural: 'Clients', icon: 'monitor', hasBrand: true, hasOutlet: true,
      search: ['name', 'code', 'kind'],
      fields: [
        { key: 'outlet_id', label: 'Outlet', type: 'select', ref: 'outlets', required: true },
        { key: 'name', label: 'Terminal name', type: 'text', required: true, table: true },
        { key: 'code', label: 'Terminal code', type: 'text', required: true, help: 'Contoh: KASIR-SNP-01' },
        { key: 'kind', label: 'Terminal type', type: 'select', required: true, default: 'cashier', options: [['cashier', 'Cashier'], ['master', 'Master POS'], ['order_station', 'Order Station']] },
        { key: 'second_display', label: 'Second display', type: 'checkbox', default: false },
        { key: 'slideshow_interval_seconds', label: 'Slideshow interval (sec)', type: 'number', default: 8 },
        { key: 'settings', label: 'Settings JSON', type: 'textarea', span: 2, placeholder: '{"replica_client_id": "..."}', help: 'Konfigurasi tambahan client, termasuk replica order station.' },
        { key: 'active', label: 'Active', type: 'checkbox', default: true, table: true },
      ],
      tableFields: ['name', 'kind', 'scope', 'second_display', 'status', 'active'],
    },
    printers: {
      key: 'printers', label: 'Printer', plural: 'Printers', icon: 'printer', hasBrand: true, hasOutlet: false,
      search: ['name', 'ip', 'model'],
      fields: [
        { key: 'brand_id', label: 'Brand', type: 'select', ref: 'brands', required: true },
        { key: 'name', label: 'Printer name', type: 'text', required: true, table: true },
        { key: 'purpose', label: 'Purpose', type: 'select', default: 'receipt', options: [['receipt', 'Receipt'], ['kitchen', 'Kitchen'], ['label', 'Label']] },
        { key: 'ip', label: 'IP address', type: 'text', required: true, table: true },
        { key: 'port', label: 'Port', type: 'number', default: 9100 },
        { key: 'paper_width', label: 'Paper width (mm)', type: 'number', default: 80 },
        { key: 'model', label: 'Model', type: 'text' },
        { key: 'active', label: 'Active', type: 'checkbox', default: true, table: true },
      ],
      tableFields: ['name', 'purpose', 'ip', 'outlets_list', 'active'],
    },
    'sales-modes': {
      key: 'sales-modes', label: 'Sales Mode', plural: 'Sales Modes', icon: 'utensils', hasBrand: true, hasOutlet: true,
      search: ['name', 'code', 'template'],
      fields: [
        { key: 'brand_id', label: 'Brand', type: 'select', ref: 'brands', required: true },
        { key: 'outlet_id', label: 'Outlet', type: 'select', ref: 'outlets', optional: true },
        { key: 'name', label: 'Mode name', type: 'text', required: true, table: true },
        { key: 'code', label: 'Code', type: 'text' },
        { key: 'template', label: 'POS layout', type: 'select', required: true, default: 'fast_food', options: [['fast_food', 'Fast food'], ['table_service', 'Table service']] },
        { key: 'icon', label: 'Icon key', type: 'text', default: 'utensils' },
        { key: 'color', label: 'Color', type: 'color', default: '#F59E0B' },
        { key: 'sort_order', label: 'Sort order', type: 'number', default: 0 },
        { key: 'active', label: 'Active', type: 'checkbox', default: true, table: true },
      ],
      tableFields: ['name', 'template', 'scope', 'sort_order', 'active'],
    },
    tables: {
      key: 'tables', label: 'Table', plural: 'Tables', icon: 'table', hasBrand: true, hasOutlet: true,
      search: ['name', 'number', 'zone', 'table_type'],
      fields: [
        { key: 'brand_id', label: 'Brand', type: 'select', ref: 'brands', required: true },
        { key: 'outlet_id', label: 'Outlet', type: 'select', ref: 'outlets', required: true },
        { key: 'number', label: 'Table number', type: 'text', required: true, table: true },
        { key: 'name', label: 'Display name', type: 'text', required: true },
        { key: 'table_type', label: 'Table type', type: 'select', default: 'regular', options: [['regular', 'Regular'], ['vip', 'VIP'], ['bar', 'Bar'], ['outdoor', 'Outdoor']] },
        { key: 'seats', label: 'Seats', type: 'number', default: 4, table: true },
        { key: 'zone', label: 'Zone', type: 'text', default: 'Main' },
        { key: 'sort_order', label: 'Sort order', type: 'number', default: 0 },
        { key: 'active', label: 'Active', type: 'checkbox', default: true, table: true },
      ],
      tableFields: ['number', 'name', 'table_type', 'seats', 'scope', 'active'],
    },
    'product-groups': {
      key: 'product-groups', label: 'Product Group', plural: 'Product Groups', icon: 'package', hasBrand: true, hasOutlet: true,
      search: ['name'],
      fields: [
        { key: 'brand_id', label: 'Brand', type: 'select', ref: 'brands', required: true },
        { key: 'outlet_id', label: 'Outlet', type: 'select', ref: 'outlets', optional: true },
        { key: 'name', label: 'Group name', type: 'text', required: true, table: true },
        { key: 'icon', label: 'Icon key', type: 'text', default: 'package' },
        { key: 'color', label: 'Color', type: 'color', default: '#F59E0B' },
        { key: 'sort_order', label: 'Sort order', type: 'number', default: 0, table: true },
        { key: 'active', label: 'Active', type: 'checkbox', default: true, table: true },
      ],
      tableFields: ['name', 'scope', 'sort_order', 'active'],
    },
    products: {
      key: 'products', label: 'Product', plural: 'Products', icon: 'coffee', hasBrand: true, hasOutlet: true,
      search: ['name', 'sku', 'description'],
      fields: [
        { key: 'brand_id', label: 'Brand', type: 'select', ref: 'brands', required: true },
        { key: 'outlet_id', label: 'Outlet', type: 'select', ref: 'outlets', optional: true },
        { key: 'group_id', label: 'Product group', type: 'select', ref: 'groups', required: true },
        { key: 'name', label: 'Product name', type: 'text', required: true, table: true },
        { key: 'sku', label: 'SKU', type: 'text', required: true, table: true },
        { key: 'price_cents', label: 'Price (Rp)', type: 'money', required: true, table: true },
        { key: 'emoji', label: 'Emoji', type: 'text', default: '🍽️' },
        { key: 'color', label: 'Color', type: 'color', default: '#F59E0B' },
        { key: 'description', label: 'Description', type: 'textarea', span: 2 },
        { key: 'image_url', label: 'Image URL', type: 'text', span: 2 },
        { key: 'sort_order', label: 'Sort order', type: 'number', default: 0 },
        { key: 'active', label: 'Active', type: 'checkbox', default: true, table: true },
      ],
      tableFields: ['name', 'sku', 'group_id', 'price_cents', 'scope', 'active'],
    },
    'payment-groups': {
      key: 'payment-groups', label: 'Payment Group', plural: 'Payment Groups', icon: 'wallet', hasBrand: true, hasOutlet: true,
      search: ['name'],
      fields: [
        { key: 'brand_id', label: 'Brand', type: 'select', ref: 'brands', required: true },
        { key: 'outlet_id', label: 'Outlet', type: 'select', ref: 'outlets', optional: true },
        { key: 'name', label: 'Group name', type: 'text', required: true, table: true },
        { key: 'sort_order', label: 'Sort order', type: 'number', default: 0, table: true },
        { key: 'active', label: 'Active', type: 'checkbox', default: true, table: true },
      ],
      tableFields: ['name', 'scope', 'sort_order', 'active'],
    },
    'payment-types': {
      key: 'payment-types', label: 'Payment Type', plural: 'Payment Types', icon: 'card', hasBrand: true, hasOutlet: true,
      search: ['name', 'code', 'method'],
      fields: [
        { key: 'brand_id', label: 'Brand', type: 'select', ref: 'brands', required: true },
        { key: 'outlet_id', label: 'Outlet', type: 'select', ref: 'outlets', optional: true },
        { key: 'group_id', label: 'Payment group', type: 'select', ref: 'paymentGroups', required: true },
        { key: 'name', label: 'Name', type: 'text', required: true, table: true },
        { key: 'code', label: 'Code', type: 'text' },
        { key: 'method', label: 'Method', type: 'select', required: true, default: 'cash', options: [['cash', 'Cash'], ['card', 'Card'], ['qris', 'QRIS'], ['ewallet', 'E-Wallet'], ['other', 'Other']] },
        { key: 'icon', label: 'Icon key', type: 'text', default: 'banknote' },
        { key: 'requires_reference', label: 'Requires reference', type: 'checkbox', default: false },
        { key: 'open_drawer', label: 'Open cash drawer', type: 'checkbox', default: false },
        { key: 'surcharge_rate', label: 'Surcharge rate', type: 'number', step: '0.01', default: 0 },
        { key: 'sort_order', label: 'Sort order', type: 'number', default: 0 },
        { key: 'active', label: 'Active', type: 'checkbox', default: true, table: true },
      ],
      tableFields: ['name', 'method', 'group_id', 'scope', 'active'],
    },
    promotions: {
      key: 'promotions', label: 'Promotion', plural: 'Promotions', icon: 'gift', hasBrand: true, hasOutlet: true,
      search: ['name', 'code'],
      fields: [
        { key: 'brand_id', label: 'Brand', type: 'select', ref: 'brands', required: true },
        { key: 'outlet_id', label: 'Outlet', type: 'select', ref: 'outlets', optional: true },
        { key: 'name', label: 'Promotion name', type: 'text', required: true, table: true },
        { key: 'code', label: 'Promo code', type: 'text' },
        { key: 'type', label: 'Type', type: 'select', required: true, default: 'percentage', options: [['percentage', 'Percentage'], ['fixed', 'Fixed amount'], ['bogo', 'Buy 1 Get 1']] },
        { key: 'scope', label: 'Applies to', type: 'select', required: true, default: 'bill', options: [['bill', 'Whole bill'], ['product', 'Selected products'], ['group', 'Product group']] },
        { key: 'value', label: 'Value', type: 'number', default: 0, help: 'Percentage: 10 = 10%. Fixed: nominal Rupiah.' },
        { key: 'min_subtotal_cents', label: 'Minimum spend (Rp)', type: 'money', default: 0 },
        { key: 'max_discount_cents', label: 'Maximum discount (Rp)', type: 'money' },
        { key: 'target_ids', label: 'Target IDs (JSON)', type: 'textarea', span: 2, placeholder: '["product-id"]', help: 'Kosongkan untuk seluruh bill.' },
        { key: 'start_at', label: 'Start at', type: 'datetime' },
        { key: 'end_at', label: 'End at', type: 'datetime' },
        { key: 'auto_apply', label: 'Auto apply', type: 'checkbox', default: true },
        { key: 'active', label: 'Active', type: 'checkbox', default: true, table: true },
      ],
      tableFields: ['name', 'type', 'value', 'scope', 'active'],
    },
    roles: {
      key: 'roles', label: 'Role', plural: 'Roles', icon: 'shield', hasBrand: false,
      search: ['name', 'description'],
      fields: [
        { key: 'name', label: 'Role name', type: 'text', required: true, table: true },
        { key: 'description', label: 'Description', type: 'text', table: true },
        { key: 'is_admin', label: 'Administrator', type: 'checkbox', default: false, table: true },
        { key: 'permissions', label: 'Operational permissions', type: 'permissions', span: 2, table: true },
        { key: 'active', label: 'Active', type: 'checkbox', default: true, table: true },
      ],
      tableFields: ['name', 'description', 'is_admin', 'permissions', 'active'],
    },
  };

  const TABLE_LABELS = { outlets_list: 'Outlets' };

  function refRow(ref, id) {
    return (state.refs[ref] || []).find((row) => row.id === id);
  }

  function refName(ref, id) {
    if (!id) return '';
    const row = refRow(ref, id);
    return row?.name || id;
  }

  function outletLabel(id) {
    const row = refRow('outlets', id);
    if (!row) return id || '—';
    return `${row.name} · ${refName('brands', row.brand_id)}`;
  }

  function scopeText(row) {
    if (row.outlet_id) return { label: refName('outlets', row.outlet_id), sub: refName('brands', row.brand_id || refRow('outlets', row.outlet_id)?.brand_id), icon: 'store' };
    if (row.brand_id) return { label: `${refName('brands', row.brand_id)} · all outlets`, sub: 'Brand-wide deployment', icon: 'briefcase' };
    if (row.outlet_id === undefined && row.brand_id === undefined) {
      const outlet = refRow('outlets', row.outlet_id);
      return { label: outlet?.name || 'Global', sub: '', icon: 'grid' };
    }
    return { label: 'Global', sub: 'All brands', icon: 'grid' };
  }

  function statusPill(value, labels = {}) {
    const active = value === true || value === 1 || value === '1';
    return `<span class="badge ${active ? 'green' : 'gray'}"><span class="dot"></span>${active ? (labels.on || 'Active') : (labels.off || 'Inactive')}</span>`;
  }

  function kindPill(kind) {
    const map = {
      cashier: ['amber', 'Cashier'], master: ['violet', 'Master POS'],
      order_station: ['blue', 'Order Station'],
    };
    const [color, label] = map[kind] || ['gray', kind || '—'];
    return `<span class="badge ${color}">${esc(label)}</span>`;
  }

  function relationOptions(ref, optional = false, optionalLabel = 'All outlets') {
    const rows = state.refs[ref] || [];
    return `${optional ? `<option value="">${esc(optionalLabel)}</option>` : ''}` + rows.map((row) => {
      const brand = row.brand_id ? ` · ${refName('brands', row.brand_id)}` : '';
      return `<option value="${esc(row.id)}">${esc(row.name + (ref === 'outlets' ? brand : ''))}</option>`;
    }).join('');
  }

  function currentFilters(key) {
    if (!state.filters[key]) state.filters[key] = { q: '', brand_id: '', outlet_id: '', status: '' };
    return state.filters[key];
  }

  function filteredEntityRows(key) {
    const def = ENTITIES[key];
    const rows = state.entityData[key] || [];
    const filters = currentFilters(key);
    const query = filters.q.toLowerCase().trim();
    return rows.filter((row) => {
      if (query) {
        const blob = def.search.map((fieldName) => String(row[fieldName] ?? '')).join(' ').toLowerCase();
        if (!blob.includes(query)) return false;
      }
      if (filters.brand_id) {
        let brandId = row.brand_id;
        if (!brandId && row.outlet_id) brandId = refRow('outlets', row.outlet_id)?.brand_id;
        if (brandId !== filters.brand_id) return false;
      }
      if (filters.outlet_id && row.outlet_id !== filters.outlet_id) return false;
      if (filters.status === 'active' && !(row.active === true || row.active === 1)) return false;
      if (filters.status === 'inactive' && (row.active === true || row.active === 1)) return false;
      return true;
    });
  }

  async function renderEntity(key) {
    const def = ENTITIES[key];
    if (!def) return renderDashboard();
    loadingView();
    try {
      await loadRefs();
      const result = await api(`/api/admin/entities/${key}`);
      state.entityData[key] = result.data || [];
      paintEntity(key);
    } catch (error) {
      errorView(error);
    }
  }

  function paintEntity(key) {
    const def = ENTITIES[key];
    const meta = VIEW_META[key];
    const filters = currentFilters(key);
    const outlets = (state.refs.outlets || []).filter((outlet) => !filters.brand_id || outlet.brand_id === filters.brand_id);
    const records = filteredEntityRows(key);
    $('#view').innerHTML = `
      ${pageHead(meta[0], meta[1], meta[2], `<button class="btn primary" id="new-entity">${icon('plus', 'sm')} New ${esc(def.label)}</button>`)}
      <div class="toolbar">
        <div class="searchbox">${icon('search')}<input class="input" id="entity-search" value="${esc(filters.q)}" placeholder="Search ${esc(def.plural.toLowerCase())}…"></div>
        ${def.hasBrand ? `<select class="select filter-select" id="filter-brand"><option value="">All brands</option>${(state.refs.brands || []).map((brand) => `<option value="${esc(brand.id)}" ${filters.brand_id === brand.id ? 'selected' : ''}>${esc(brand.name)}</option>`).join('')}</select>` : ''}
        ${(def.hasBrand || def.hasOutlet) ? `<select class="select filter-select" id="filter-outlet"><option value="">All outlets</option>${outlets.map((outlet) => `<option value="${esc(outlet.id)}" ${filters.outlet_id === outlet.id ? 'selected' : ''}>${esc(outlet.name)}</option>`).join('')}</select>` : ''}
        <select class="select filter-select" id="filter-status"><option value="">All status</option><option value="active" ${filters.status === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${filters.status === 'inactive' ? 'selected' : ''}>Inactive</option></select>
        <span class="result-count" id="entity-count">${records.length} records</span>
      </div>
      <div class="table-card">
        <table class="data-table">
          <thead><tr>${def.tableFields.map((name) => {
            const field = def.fields.find((f) => f.key === name);
            const label = field?.label || TABLE_LABELS[name] || name;
            return `<th>${esc(label)}</th>`;
          }).join('')}<th class="text-right">Actions</th></tr></thead>
          <tbody id="entity-tbody">${entityRowsHtml(key, records)}</tbody>
        </table>
      </div>`;

    $('#new-entity').addEventListener('click', () => openEntityModal(key));
    $('#entity-search').addEventListener('input', (event) => {
      filters.q = event.target.value;
      refreshEntityRows(key);
    });
    $('#filter-status').addEventListener('change', (event) => {
      filters.status = event.target.value;
      refreshEntityRows(key);
    });
    if ($('#filter-brand')) {
      $('#filter-brand').addEventListener('change', (event) => {
        filters.brand_id = event.target.value;
        filters.outlet_id = '';
        paintEntity(key);
      });
    }
    if ($('#filter-outlet')) {
      $('#filter-outlet').addEventListener('change', (event) => {
        filters.outlet_id = event.target.value;
        refreshEntityRows(key);
      });
    }
    $('#entity-tbody').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const id = button.dataset.id;
      const row = (state.entityData[key] || []).find((item) => item.id === id);
      if (!row) return;
      if (button.dataset.action === 'edit') openEntityModal(key, row);
      else if (button.dataset.action === 'delete') deleteEntity(key, row);
      else if (button.dataset.action === 'token') copyText(row.token, 'Client token disalin');
      else if (button.dataset.action === 'command') openRemoteCommand(row);
      else if (button.dataset.action === 'outlets') openPrinterOutlets(row);
    });
  }

  function refreshEntityRows(key) {
    const records = filteredEntityRows(key);
    const tbody = $('#entity-tbody');
    if (tbody) tbody.innerHTML = entityRowsHtml(key, records);
    const count = $('#entity-count');
    if (count) count.textContent = `${records.length} records`;
  }

  function entityRowsHtml(key, rows) {
    if (!rows.length) {
      return `<tr><td colspan="14"><div class="empty-state" style="padding:55px 20px">
        <div class="empty-icon">${icon(ENTITIES[key].icon)}</div>
        <h3>Belum ada data</h3><p>Tambahkan ${esc(ENTITIES[key].label.toLowerCase())} pertama atau ubah filter pencarian.</p>
      </div></td></tr>`;
    }
    return rows.map((row) => `<tr>
      ${ENTITIES[key].tableFields.map((name) => `<td>${cellHtml(key, row, name)}</td>`).join('')}
      <td><div class="cell-actions">
        ${key === 'clients' ? `<button class="row-action" data-action="token" data-id="${esc(row.id)}" title="Copy token">${icon('copy', 'sm')}</button>` : ''}
        ${key === 'clients' ? `<button class="row-action" data-action="command" data-id="${esc(row.id)}" title="Remote command">${icon('command', 'sm')}</button>` : ''}
        ${key === 'printers' ? `<button class="btn sm ghost" data-action="outlets" data-id="${esc(row.id)}" title="Outlet Setting">${icon('store', 'sm')} Outlet Setting</button>` : ''}
        <button class="row-action" data-action="edit" data-id="${esc(row.id)}" title="Edit">${icon('edit', 'sm')}</button>
        <button class="row-action danger" data-action="delete" data-id="${esc(row.id)}" title="Deactivate">${icon('trash', 'sm')}</button>
      </div></td>
    </tr>`).join('');
  }

  function cellHtml(key, row, fieldName) {
    const def = ENTITIES[key];
    const field = def.fields.find((f) => f.key === fieldName) || { key: fieldName, label: fieldName };
    const value = row[fieldName];
    if (fieldName === 'outlets_list') {
      const outlets = Array.isArray(row.outlets) ? row.outlets : [];
      if (!outlets.length) return '<span class="badge gray">Belum diatur</span>';
      const shown = outlets.slice(0, 2).map((outlet) => `<span class="badge blue">${esc(outlet.name)}</span>`).join(' ');
      const extra = outlets.length > 2 ? ` <span class="badge gray">+${outlets.length - 2}</span>` : '';
      return `<div class="outlet-badges">${shown}${extra}</div>`;
    }
    if (fieldName === 'name') {
      const glyph = key === 'products' ? (row.emoji || '🍽️') : icon(def.icon, 'sm');
      const sub = row.code || row.sku || (key === 'tables' ? `Table ${row.number || ''}` : '') || (key === 'clients' ? row.code : '');
      return `<div class="cell-main"><div class="cell-icon">${glyph}</div><div><div class="cell-title">${esc(row.name || row.bill_no || '—')}</div>${sub ? `<div class="cell-sub">${esc(sub)}</div>` : ''}</div></div>`;
    }
    if (fieldName === 'scope') {
      const scope = scopeText(row);
      return `<span class="scope-pill">${icon(scope.icon, 'sm')}<span>${esc(scope.label)}${scope.sub ? `<span class="faint"> · ${esc(scope.sub)}</span>` : ''}</span></span>`;
    }
    if (fieldName === 'kind') return kindPill(value);
    if (fieldName === 'second_display') return `<span class="badge ${value ? 'green' : 'gray'}">${value ? 'Enabled' : 'Off'}</span>`;
    if (fieldName === 'status') return `<span class="badge ${value === 'online' ? 'green' : 'gray'}"><span class="dot"></span>${esc(value || 'offline')}</span>`;
    if (fieldName === 'active') return statusPill(value);
    if (fieldName === 'is_admin') return value ? '<span class="badge violet">Administrator</span>' : '<span class="badge gray">Standard</span>';
    if (fieldName === 'permissions') {
      const list = Array.isArray(value) ? value : [];
      return list.length ? list.slice(0, 3).map((p) => `<span class="badge gray" style="margin:1px">${esc(p.replace('pos.', '').replace('report.', ''))}</span>`).join('') + (list.length > 3 ? ` <span class="faint tiny">+${list.length - 3}</span>` : '') : '<span class="faint">No permission</span>';
    }
    if (fieldName === 'brand_id') return `<span class="scope-pill">${icon('briefcase', 'sm')} ${esc(refName('brands', value))}</span>`;
    if (fieldName === 'outlet_id') return `<span class="scope-pill">${icon('store', 'sm')} ${esc(refName('outlets', value))}</span>`;
    if (fieldName === 'group_id') {
      const ref = key === 'payment-types' ? 'paymentGroups' : 'groups';
      return `<span class="scope-pill">${icon('package', 'sm')} ${esc(refName(ref, value))}</span>`;
    }
    if (fieldName.endsWith('_cents')) {
      if (fieldName === 'value' && row.type === 'percentage') return `<b>${esc(value)}%</b>`;
      if (fieldName === 'value') return `<span class="money">${money(value)}</span>`;
      return `<span class="money">${money(value)}</span>`;
    }
    if (fieldName === 'price_cents') return `<span class="money">${money(value)}</span>`;
    if (fieldName === 'value' && row.type === 'percentage') return `<b>${esc(value)}%</b>`;
    if (fieldName === 'type' || fieldName === 'method' || fieldName === 'purpose' || fieldName === 'table_type') {
      return `<span class="badge blue">${esc(value || '—')}</span>`;
    }
    if (fieldName === 'template') return `<span class="badge ${value === 'table_service' ? 'violet' : 'amber'}">${value === 'table_service' ? 'Table service' : 'Fast food'}</span>`;
    if (fieldName === 'color' && value) return `<span style="display:inline-flex;align-items:center;gap:7px"><i style="width:14px;height:14px;border-radius:5px;background:${esc(value)};display:inline-block"></i><span class="mono tiny">${esc(value)}</span></span>`;
    return `<span>${value === null || value === undefined || value === '' ? '<span class="faint">—</span>' : esc(value)}</span>`;
  }

  function copyText(value, message = 'Disalin') {
    if (!value) return toast('Tidak ada data', 'Nilai kosong.', 'error');
    navigator.clipboard?.writeText(value).then(() => toast(message, value.length > 60 ? `${value.slice(0, 58)}…` : value)).catch(() => {
      const area = document.createElement('textarea');
      area.value = value; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
      toast(message);
    });
  }

  function formatFormValue(field, row) {
    const value = row?.[field.key];
    if (field.type === 'money') return value === null || value === undefined ? '' : Number(value) / 100;
    if (field.type === 'datetime') {
      if (!value) return '';
      const date = new Date(String(value).replace(' ', 'T'));
      if (Number.isNaN(date.getTime())) return '';
      const pad = (num) => String(num).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
    if (field.type === 'textarea' && (field.key === 'settings' || field.key === 'target_ids')) {
      if (value === null || value === undefined || value === '') return field.key === 'target_ids' ? '[]' : '';
      return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    }
    if (field.type === 'permissions') {
      if (Array.isArray(value)) return value;
      try { return JSON.parse(value || '[]'); } catch { return []; }
    }
    if (field.type === 'checkbox') return value === true || value === 1 || value === '1';
    return value ?? field.default ?? '';
  }

  function fieldControl(field, row, formBrand) {
    const value = formatFormValue(field, row);
    const required = field.required ? 'required' : '';
    const span = field.span === 2 ? ' span-2' : '';
    if (field.type === 'checkbox') {
      return `<div class="field${span}"><label>&nbsp;</label><label class="check-row"><span class="switch"><input type="checkbox" name="${field.key}" ${value ? 'checked' : ''}><span></span></span><span class="check-label">${esc(field.label)}</span></label></div>`;
    }
    if (field.type === 'permissions') {
      const selected = Array.isArray(value) ? value : [];
      return `<div class="field${span}"><label>${esc(field.label)}</label><div class="permissions-grid">${PERMISSIONS.map(([key, label]) => `<label class="perm-item"><input type="checkbox" name="permissions" value="${key}" ${selected.includes(key) ? 'checked' : ''}>${esc(label)}</label>`).join('')}</div><div class="help">Administrator selalu memiliki akses penuh di frontend dan HQ.</div></div>`;
    }
    if (field.type === 'select') {
      let options = '';
      if (field.ref) {
        const rows = state.refs[field.ref] || [];
        const filtered = field.ref === 'outlets' && formBrand ? rows.filter((item) => item.brand_id === formBrand) : field.ref === 'groups' && formBrand ? rows.filter((item) => !item.brand_id || item.brand_id === formBrand) : rows;
        options = `${field.optional ? `<option value="">${field.ref === 'outlets' ? 'All outlets' : 'Global'}</option>` : ''}` + filtered.map((item) => {
          const suffix = field.ref === 'outlets' ? ` · ${refName('brands', item.brand_id)}` : '';
          return `<option value="${esc(item.id)}" ${String(value) === String(item.id) ? 'selected' : ''}>${esc(item.name + suffix)}</option>`;
        }).join('');
      } else {
        options = (field.options || []).map(([key, label]) => `<option value="${esc(key)}" ${String(value) === String(key) ? 'selected' : ''}>${esc(label)}</option>`).join('');
      }
      return `<div class="field${span}"><label>${esc(field.label)}</label><select class="select" name="${field.key}" ${required}>${options}</select>${field.help ? `<div class="help">${esc(field.help)}</div>` : ''}</div>`;
    }
    if (field.type === 'textarea') {
      return `<div class="field${span}"><label>${esc(field.label)}</label><textarea class="textarea" name="${field.key}" ${required} placeholder="${esc(field.placeholder || '')}">${esc(value)}</textarea>${field.help ? `<div class="help">${esc(field.help)}</div>` : ''}</div>`;
    }
    if (field.type === 'color') {
      return `<div class="field${span}"><label>${esc(field.label)}</label><div style="display:flex;gap:9px;align-items:center"><input class="input" type="color" name="${field.key}" value="${esc(value || '#F59E0B')}" style="width:54px;padding:4px;height:42px"><input class="input" value="${esc(value || '#F59E0B')}" data-color-text="${field.key}" style="flex:1" aria-label="${esc(field.label)}"></div></div>`;
    }
    const inputType = field.type === 'money' ? 'number' : field.type === 'datetime' ? 'datetime-local' : field.type === 'number' ? 'number' : 'text';
    return `<div class="field${span}"><label>${esc(field.label)}</label><input class="input" type="${inputType}" name="${field.key}" value="${esc(value)}" ${required} ${field.step ? `step="${field.step}"` : ''} placeholder="${esc(field.placeholder || (field.type === 'money' ? '0' : ''))}">${field.help ? `<div class="help">${esc(field.help)}</div>` : ''}</div>`;
  }

  function openEntityModal(key, row = null) {
    const def = ENTITIES[key];
    const isEdit = Boolean(row);
    const formBrand = row?.brand_id || '';
    const body = `<form id="entity-form"><div class="form-grid">${def.fields.map((field) => fieldControl(field, row, formBrand)).join('')}</div></form>`;
    openModal({
      title: isEdit ? `Edit ${def.label}` : `New ${def.label}`,
      subtitle: isEdit ? 'Perubahan akan tersedia untuk client pada sinkronisasi berikutnya.' : 'Data baru langsung dapat dideploy ke brand atau outlet yang dipilih.',
      body,
      footer: `<button class="btn ghost" data-close-modal>Batal</button><button class="btn primary" id="save-entity">${icon('check', 'sm')} ${isEdit ? 'Save changes' : 'Create ' + def.label}</button>`,
      wide: ['products', 'roles', 'promotions', 'clients'].includes(key),
      onMount(overlay) {
        const form = $('#entity-form', overlay);
        $$('input[type=color]', form).forEach((colorInput) => {
          const textInput = form.querySelector(`[data-color-text="${colorInput.name}"]`);
          colorInput.addEventListener('input', () => { if (textInput) textInput.value = colorInput.value; });
          textInput?.addEventListener('input', () => { colorInput.value = textInput.value; });
        });
        const brandSelect = form.querySelector('[name="brand_id"]');
        const outletSelect = form.querySelector('[name="outlet_id"]');
        const syncOutlets = () => {
          if (!outletSelect) return;
          const brandId = brandSelect?.value || '';
          const current = outletSelect.value;
          let html = outletSelect.required ? '' : '<option value="">All outlets</option>';
          (state.refs.outlets || []).filter((outlet) => !brandId || outlet.brand_id === brandId).forEach((outlet) => {
            html += `<option value="${esc(outlet.id)}" ${current === outlet.id ? 'selected' : ''}>${esc(outlet.name)} · ${esc(refName('brands', outlet.brand_id))}</option>`;
          });
          outletSelect.innerHTML = html;
          if (!outletSelect.value && outletSelect.options.length) outletSelect.selectedIndex = 0;
        };
        brandSelect?.addEventListener('change', syncOutlets);
        outletSelect?.addEventListener('change', () => {
          if (brandSelect && !brandSelect.value) {
            const outlet = refRow('outlets', outletSelect.value);
            if (outlet) brandSelect.value = outlet.brand_id;
          }
        });
        syncOutlets();
        $('#save-entity', overlay).addEventListener('click', async () => {
          if (!form.reportValidity()) return;
          const button = $('#save-entity', overlay);
          button.disabled = true;
          button.innerHTML = '<span class="spinner" style="width:15px;height:15px;border-width:2px"></span> Saving…';
          try {
            const payload = {};
            for (const field of def.fields) {
              if (field.type === 'permissions') {
                payload[field.key] = $$('input[name="permissions"]:checked', form).map((input) => input.value);
                continue;
              }
              if (field.type === 'checkbox') {
                payload[field.key] = form.querySelector(`[name="${field.key}"]`).checked;
                continue;
              }
              const input = form.querySelector(`[name="${field.key}"]`);
              if (!input) continue;
              let value = input.value;
              if (field.type === 'money') value = value === '' ? null : Math.round(Number(value) * 100);
              else if (field.type === 'number') value = value === '' ? null : Number(value);
              else if (field.key.endsWith('_id') && value === '') value = null;
              else if (field.type === 'datetime' && value === '') value = null;
              if (['settings', 'target_ids'].includes(field.key) && value) {
                try { value = JSON.parse(value); } catch { throw new Error(`${field.label} harus berupa JSON yang valid.`); }
              }
              if (field.key === 'target_ids' && !value) value = [];
              payload[field.key] = value;
            }
            if (isEdit) await api(`/api/admin/entities/${key}/${row.id}`, { method: 'PUT', body: payload });
            else await api(`/api/admin/entities/${key}`, { method: 'POST', body: payload });
            closeModal();
            toast(isEdit ? `${def.label} diperbarui` : `${def.label} dibuat`, 'Data berhasil disimpan.');
            if (['brands', 'outlets', 'product-groups', 'payment-groups', 'roles'].includes(key)) await loadRefs(true);
            await renderEntity(key);
          } catch (error) {
            toast('Gagal menyimpan', error.message, 'error');
            button.disabled = false;
            button.innerHTML = `${icon('check', 'sm')} ${isEdit ? 'Save changes' : 'Create ' + def.label}`;
          }
        });
      },
    });
  }

  async function openPrinterOutlets(printer) {
    let result;
    try {
      result = await api(`/api/admin/printers/${printer.id}/outlets`);
    } catch (error) {
      toast('Gagal memuat outlet', error.message, 'error');
      return;
    }
    const current = new Set(result?.data?.outlet_ids || []);
    const outlets = (state.refs.outlets || [])
      .filter((outlet) => outlet.brand_id === printer.brand_id)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const options = outlets.map((outlet) => {
      const inactive = outlet.active === false || outlet.active === 0;
      return `<label class="outlet-option">
        <input type="checkbox" name="outlet" value="${esc(outlet.id)}" ${current.has(outlet.id) ? 'checked' : ''}>
        <span><strong>${esc(outlet.name)}</strong><small>${esc(outlet.code || '')}${inactive ? ' · Nonaktif' : ''}</small></span>
      </label>`;
    }).join('');
    const body = `
      <div class="confirm-text mb-16">Pilih outlet yang boleh memakai <b>${esc(printer.name)}</b>. Printer hanya dikirim ke terminal pada outlet yang dipilih.</div>
      <div class="outlet-picker">${options || '<div class="empty-state" style="padding:28px"><p>Belum ada outlet pada brand ini.</p></div>'}</div>`;
    openModal({
      title: 'Outlet Setting',
      subtitle: `Atur outlet untuk printer ${printer.name}.`,
      narrow: true,
      body,
      footer: `<button class="btn ghost" data-toggle-outlets>Pilih semua</button><button class="btn ghost" data-close-modal>Batal</button><button class="btn primary" id="save-printer-outlets">${icon('check', 'sm')} Simpan</button>`,
      onMount(overlay) {
        const toggle = $('[data-toggle-outlets]', overlay);
        toggle?.addEventListener('click', () => {
          const boxes = $$('input[name="outlet"]', overlay);
          const allChecked = boxes.length > 0 && boxes.every((box) => box.checked);
          boxes.forEach((box) => { box.checked = !allChecked; });
          toggle.textContent = allChecked ? 'Pilih semua' : 'Kosongkan';
        });
        $('#save-printer-outlets', overlay).addEventListener('click', async () => {
          const button = $('#save-printer-outlets', overlay);
          const outlet_ids = $$('input[name="outlet"]:checked', overlay).map((input) => input.value);
          button.disabled = true;
          button.innerHTML = '<span class="spinner" style="width:15px;height:15px;border-width:2px"></span> Menyimpan…';
          try {
            await api(`/api/admin/printers/${printer.id}/outlets`, { method: 'PUT', body: { outlet_ids } });
            closeModal();
            toast('Outlet printer disimpan', `${outlet_ids.length} outlet dipilih untuk ${printer.name}.`);
            await renderEntity('printers');
          } catch (error) {
            toast('Gagal menyimpan', error.message, 'error');
            button.disabled = false;
            button.innerHTML = `${icon('check', 'sm')} Simpan`;
          }
        });
      },
    });
  }

  async function deleteEntity(key, row) {
    const def = ENTITIES[key];
    const confirmed = await confirmDialog(
      `Deactivate ${def.label}?`,
      `Data <b>${esc(row.name)}</b> akan dinonaktifkan dan tidak lagi dideploy ke client. Riwayat transaksi tetap tersimpan.`,
      'Deactivate',
    );
    if (!confirmed) return;
    try {
      await api(`/api/admin/entities/${key}/${row.id}`, { method: 'DELETE' });
      toast(`${def.label} dinonaktifkan`, row.name);
      if (['brands', 'outlets', 'product-groups', 'payment-groups', 'roles'].includes(key)) await loadRefs(true);
      await renderEntity(key);
    } catch (error) {
      toast('Gagal menonaktifkan', error.message, 'error');
    }
  }

  async function renderUsers() {
    loadingView();
    try {
      await loadRefs();
      const result = await api('/api/admin/users');
      state.users = result.data || [];
      paintUsers();
    } catch (error) { errorView(error); }
  }

  function paintUsers() {
    const query = (state.userFilters?.q || '').toLowerCase();
    const roleFilter = state.userFilters?.role_id || '';
    const users = state.users.filter((user) => {
      if (roleFilter && user.role_id !== roleFilter) return false;
      if (!query) return true;
      return [user.name, user.nik, user.role_name].join(' ').toLowerCase().includes(query);
    });
    const meta = VIEW_META.users;
    $('#view').innerHTML = `
      ${pageHead(meta[0], meta[1], meta[2], `<button class="btn primary" id="new-user">${icon('plus', 'sm')} New User</button>`)}
      <div class="toolbar">
        <div class="searchbox">${icon('search')}<input class="input" id="user-search" value="${esc(state.userFilters?.q || '')}" placeholder="Cari nama, NIK, atau role…"></div>
        <select class="select filter-select" id="user-role-filter"><option value="">All roles</option>${(state.refs.roles || []).map((role) => `<option value="${esc(role.id)}" ${roleFilter === role.id ? 'selected' : ''}>${esc(role.name)}</option>`).join('')}</select>
        <span class="result-count">${users.length} users</span>
      </div>
      <div class="table-card"><table class="data-table">
        <thead><tr><th>User</th><th>NIK</th><th>Role</th><th>Deployment</th><th>Last login</th><th>Status</th><th class="text-right">Actions</th></tr></thead>
        <tbody id="user-tbody">${users.length ? users.map((user) => `<tr>
          <td><div class="cell-main"><div class="avatar square" style="background:${esc(user.avatar_color || '#F59E0B')}">${esc(initials(user.name))}</div><div><div class="cell-title">${esc(user.name)}</div><div class="cell-sub">${esc(user.role_name)}</div></div></div></td>
          <td><span class="code-chip">${esc(user.nik)}</span></td>
          <td>${user.is_admin ? '<span class="badge violet">Administrator</span>' : `<span class="badge gray">${esc(user.role_name)}</span>`}</td>
          <td>${user.outlet_name ? `<span class="scope-pill">${icon('store', 'sm')} ${esc(user.outlet_name)}<span class="faint"> · ${esc(user.brand_name || '')}</span></span>` : user.brand_name ? `<span class="scope-pill">${icon('briefcase', 'sm')} ${esc(user.brand_name)} · all outlets</span>` : '<span class="faint">Global</span>'}</td>
          <td><span class="faint">${esc(relTime(user.last_login_at))}</span></td>
          <td>${statusPill(user.active)}</td>
          <td><div class="cell-actions">
            <button class="row-action" data-user-edit="${esc(user.id)}" title="Edit">${icon('edit', 'sm')}</button>
            <button class="row-action danger" data-user-delete="${esc(user.id)}" title="Deactivate">${icon('trash', 'sm')}</button>
          </div></td>
        </tr>`).join('') : '<tr><td colspan="7"><div class="empty-state" style="padding:55px"><div class="empty-icon">' + icon('users') + '</div><h3>No users yet</h3><p>Buat user dan atur PIN serta role operasionalnya.</p></div></td></tr>'}</tbody>
      </table></div>`;
    $('#new-user').addEventListener('click', () => openUserModal());
    $('#user-search').addEventListener('input', (event) => {
      state.userFilters = { ...(state.userFilters || {}), q: event.target.value };
      paintUsers();
      $('#user-search')?.focus();
      const input = $('#user-search'); if (input) input.setSelectionRange(input.value.length, input.value.length);
    });
    $('#user-role-filter').addEventListener('change', (event) => {
      state.userFilters = { ...(state.userFilters || {}), role_id: event.target.value };
      paintUsers();
    });
    $('#user-tbody').addEventListener('click', async (event) => {
      const edit = event.target.closest('[data-user-edit]');
      const del = event.target.closest('[data-user-delete]');
      if (edit) {
        const user = state.users.find((item) => item.id === edit.dataset.userEdit);
        if (user) openUserModal(user);
      }
      if (del) {
        const user = state.users.find((item) => item.id === del.dataset.userDelete);
        if (!user) return;
        const confirmed = await confirmDialog('Deactivate user?', `Akun <b>${esc(user.name)}</b> tidak akan bisa login ke POS maupun HQ.`, 'Deactivate');
        if (!confirmed) return;
        try {
          await api(`/api/admin/users/${user.id}`, { method: 'DELETE' });
          toast('User dinonaktifkan', user.name);
          await renderUsers();
        } catch (error) { toast('Gagal menonaktifkan', error.message, 'error'); }
      }
    });
  }

  function openUserModal(user = null) {
    const isEdit = Boolean(user);
    const body = `<form id="user-form"><div class="form-grid">
      <div class="field"><label>Full name</label><input class="input" name="name" value="${esc(user?.name || '')}" required></div>
      <div class="field"><label>NIK</label><input class="input" name="nik" value="${esc(user?.nik || '')}" required inputmode="numeric"></div>
      <div class="field"><label>${isEdit ? 'New PIN (optional)' : 'PIN'}</label><input class="input" name="pin" type="password" inputmode="numeric" placeholder="${isEdit ? 'Leave blank to keep current PIN' : 'Minimal 4 digit'}" ${isEdit ? '' : 'required'}></div>
      <div class="field"><label>Role</label><select class="select" name="role_id" required>${(state.refs.roles || []).map((role) => `<option value="${esc(role.id)}" ${user?.role_id === role.id ? 'selected' : ''}>${esc(role.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Brand</label><select class="select" name="brand_id"><option value="">All brands</option>${(state.refs.brands || []).map((brand) => `<option value="${esc(brand.id)}" ${user?.brand_id === brand.id ? 'selected' : ''}>${esc(brand.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Outlet</label><select class="select" name="outlet_id"><option value="">All outlets</option>${(state.refs.outlets || []).map((outlet) => `<option value="${esc(outlet.id)}" ${user?.outlet_id === outlet.id ? 'selected' : ''}>${esc(outlet.name)} · ${esc(refName('brands', outlet.brand_id))}</option>`).join('')}</select></div>
      <div class="field"><label>Avatar color</label><input class="input" type="color" name="avatar_color" value="${esc(user?.avatar_color || '#F59E0B')}" style="height:42px;padding:4px"></div>
      <div class="field"><label>&nbsp;</label><label class="check-row"><span class="switch"><input type="checkbox" name="active" ${user?.active === false ? '' : 'checked'}><span></span></span><span class="check-label">Active</span></label></div>
    </div></form>`;
    openModal({
      title: isEdit ? 'Edit user' : 'New user',
      subtitle: 'NIK dan PIN dipakai untuk login di HQ maupun terminal POS.',
      body,
      footer: `<button class="btn ghost" data-close-modal>Batal</button><button class="btn primary" id="save-user">${icon('check', 'sm')} ${isEdit ? 'Save changes' : 'Create user'}</button>`,
      onMount(overlay) {
        const form = $('#user-form', overlay);
        const brand = form.querySelector('[name="brand_id"]');
        const outlet = form.querySelector('[name="outlet_id"]');
        const sync = () => {
          const brandId = brand.value;
          const current = outlet.value;
          outlet.innerHTML = `<option value="">All outlets</option>` + (state.refs.outlets || []).filter((item) => !brandId || item.brand_id === brandId).map((item) => `<option value="${esc(item.id)}" ${current === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('');
        };
        brand.addEventListener('change', sync);
        outlet.addEventListener('change', () => {
          if (!brand.value) {
            const selected = refRow('outlets', outlet.value);
            if (selected) brand.value = selected.brand_id;
          }
        });
        sync();
        $('#save-user', overlay).addEventListener('click', async () => {
          if (!form.reportValidity()) return;
          const button = $('#save-user', overlay);
          button.disabled = true;
          const payload = {
            name: form.name.value.trim(),
            nik: form.nik.value.trim(),
            pin: form.pin.value.trim(),
            role_id: form.role_id.value,
            brand_id: form.brand_id.value || null,
            outlet_id: form.outlet_id.value || null,
            avatar_color: form.avatar_color.value,
            active: form.active.checked,
          };
          try {
            if (isEdit) await api(`/api/admin/users/${user.id}`, { method: 'PUT', body: payload });
            else await api('/api/admin/users', { method: 'POST', body: payload });
            closeModal();
            toast(isEdit ? 'User diperbarui' : 'User dibuat', payload.name);
            await renderUsers();
          } catch (error) {
            toast('Gagal menyimpan user', error.message, 'error');
            button.disabled = false;
            button.innerHTML = `${icon('check', 'sm')} ${isEdit ? 'Save changes' : 'Create user'}`;
          }
        });
      },
    });
  }

  async function renderDashboard() {
    loadingView();
    try {
      const [dashboard, presence] = await Promise.all([
        api('/api/admin/dashboard'),
        api('/api/admin/presence'),
      ]);
      state.lastDashboard = dashboard;
      state.presence = presence.data || [];
      paintDashboard(dashboard);
    } catch (error) { errorView(error); }
  }

  function kpiCard({ label, value, meta, iconName, color = 'amber', hero = false }) {
    const palette = {
      amber: ['rgba(245,158,11,.12)', '#B45309', 'rgba(245,158,11,.16)'],
      green: ['rgba(5,150,105,.1)', '#059669', 'rgba(5,150,105,.14)'],
      blue: ['rgba(37,99,235,.1)', '#2563EB', 'rgba(37,99,235,.14)'],
      violet: ['rgba(124,58,237,.1)', '#7C3AED', 'rgba(124,58,237,.14)'],
    }[color] || ['rgba(245,158,11,.12)', '#B45309', 'rgba(245,158,11,.16)'];
    return `<div class="kpi ${hero ? 'hero' : ''}" style="--kpi-bg:${palette[0]};--kpi-color:${palette[1]};--kpi-glow:${palette[2]}">
      <div class="kpi-top"><span>${esc(label)}</span><span class="kpi-icon">${icon(iconName, 'sm')}</span></div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-meta">${meta}</div>
    </div>`;
  }

  function paintDashboard(d) {
    const hourly = d.hourly || [];
    const daily = d.daily || [];
    const chartSeries = hourly.length ? hourly : daily;
    const chartLabel = hourly.length ? 'Hourly revenue · today' : 'Daily revenue · last 7 days';
    const top = d.top_products || [];
    const maxTop = Math.max(...top.map((item) => Number(item.sales_cents || 0)), 1);
    const brands = d.brands || [];
    const maxBrand = Math.max(...brands.map((item) => Number(item.sales_cents || 0)), 1);
    const growth = Number(d.today?.growth_pct || 0);
    const growthMeta = `${growth >= 0 ? '<span class="up">↑' : '<span class="down">↓'} ${Math.abs(growth).toFixed(1)}%</span> vs kemarin`;
    const recent = d.recent_bills || [];
    const online = d.counts?.online_clients || 0;

    $('#view').innerHTML = `
      ${pageHead('Overview', 'Command Center', 'Ringkasan performa seluruh brand dan outlet secara real-time.',
        `<button class="btn ghost" id="refresh-dashboard">${icon('refresh', 'sm')} Refresh</button><a class="btn primary" href="#reports">${icon('chart', 'sm')} Sales report</a>`)}
      <div class="kpi-grid">
        ${kpiCard({ label: 'Penjualan hari ini', value: money(d.today?.sales_cents || 0), meta: growthMeta, iconName: 'chart', color: 'amber', hero: true })}
        ${kpiCard({ label: 'Bill hari ini', value: numberFmt.format(d.today?.bills || 0), meta: `${numberFmt.format(d.counts?.products || 0)} produk aktif`, iconName: 'receipt', color: 'blue' })}
        ${kpiCard({ label: 'Rata-rata bill', value: money(d.today?.avg_cents || 0), meta: `Kemarin ${money(d.yesterday?.sales_cents || 0)}`, iconName: 'wallet', color: 'violet' })}
        ${kpiCard({ label: 'Terminal online', value: `${online}<span class="faint" style="font-size:16px"> / ${d.counts?.clients || 0}</span>`, meta: `${d.counts?.outlets || 0} outlet · ${d.counts?.brands || 0} brand`, iconName: 'wifi', color: 'green' })}
      </div>

      <div class="dashboard-grid">
        <div class="card">
          <div class="card-head"><div><h3>Revenue pulse</h3><p>${chartLabel}</p></div><div class="spacer"></div><span class="badge amber">${icon('sparkles', 'sm')} Live</span></div>
          <div class="card-body"><div class="chart-wrap">${lineChart(chartSeries)}</div></div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Brand performance</h3><p>Penjualan hari ini per brand</p></div></div>
          <div class="card-body">
            ${brands.length ? `<div class="brand-split">${brands.map((brand) => `
              <div class="brand-split-row">
                <i class="brand-pill" style="--c:${esc(brand.color || '#F59E0B')}"></i>
                <div class="brand-split-info"><strong>${esc(brand.name)}</strong><span>${numberFmt.format(brand.bills || 0)} bills</span></div>
                <div class="text-right"><div class="money" style="font-size:12px">${compactMoney(brand.sales_cents)}</div><div class="brand-split-bar" style="margin-top:6px"><i style="--c:${esc(brand.color || '#F59E0B')};width:${Math.max(2, (Number(brand.sales_cents || 0) / maxBrand) * 100)}%"></i></div></div>
              </div>`).join('')}</div>` : '<div class="empty-state" style="padding:30px"><p>Belum ada brand aktif.</p></div>'}
            <div style="margin-top:22px;padding-top:17px;border-top:1px solid var(--line)" class="legend">
              <span class="legend-item"><i class="legend-dot" style="--legend:var(--green)"></i>${online} terminal online</span>
              <span class="legend-item"><i class="legend-dot" style="--legend:var(--amber)"></i>${d.counts?.users || 0} users</span>
              <span class="legend-item"><i class="legend-dot" style="--legend:var(--blue)"></i>${d.counts?.queued_commands || 0} queued command</span>
            </div>
          </div>
        </div>
      </div>

      <div class="dashboard-grid equal">
        <div class="card">
          <div class="card-head"><div><h3>Top products</h3><p>Best seller hari ini berdasarkan revenue</p></div><div class="spacer"></div><a class="link" href="#products">Manage menu</a></div>
          <div class="card-body">
            ${top.length ? `<div class="rank-list">${top.map((item, index) => `<div class="rank-item">
              <span class="rank-num">0${index + 1}</span>
              <div class="rank-main"><div class="rank-label"><span>${esc(item.name)}</span><span>${compactMoney(item.sales_cents)}</span></div><div class="progress"><i style="width:${Math.max(2, (Number(item.sales_cents || 0) / maxTop) * 100)}%"></i></div></div>
              <span class="rank-qty">${item.qty || 0}x</span>
            </div>`).join('')}</div>` : '<div class="empty-state" style="padding:28px"><p>Belum ada penjualan hari ini.</p></div>'}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Recent bills</h3><p>Transaksi terbaru dari semua terminal</p></div><div class="spacer"></div><a class="link" href="#reports">View all</a></div>
          <div class="card-body" style="padding-top:10px">
            ${recent.length ? `<table class="mini-table"><thead><tr><th>Bill</th><th>Outlet</th><th>Total</th></tr></thead><tbody>${recent.slice(0, 6).map((bill) => `<tr data-bill="${esc(bill.id)}" style="cursor:pointer"><td><div class="main">${esc(bill.bill_no)}</div><div class="sub">${esc(bill.user_name || bill.client_name)} · ${esc(bill.table_name || bill.sales_mode_name || '—')}</div></td><td>${esc(bill.outlet_name)}<div class="sub">${esc(relTime(bill.paid_at))}</div></td><td class="money">${money(bill.total_cents)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state" style="padding:28px"><p>Belum ada bill. Transaksi POS akan muncul di sini secara real-time.</p></div>'}
          </div>
        </div>
      </div>`;
    $('#refresh-dashboard').addEventListener('click', renderDashboard);
    bindBillLinks();
  }

  function bindBillLinks() {
    $$('[data-bill]').forEach((row) => {
      if (row.dataset.bound) return;
      row.dataset.bound = '1';
      row.addEventListener('click', () => openBill(row.dataset.bill));
    });
  }

  function lineChart(series) {
    const data = (series || []).map((item) => ({
      label: String(item.label ?? ''),
      value: Number(item.sales_cents || 0),
      bills: Number(item.bills || 0),
    }));
    if (!data.length) return '<div class="chart-empty">Belum ada data penjualan untuk periode ini.</div>';
    const W = 860, H = 260, left = 12, right = 18, top = 17, bottom = 32;
    const max = Math.max(...data.map((item) => item.value), 1);
    const xs = (index) => data.length === 1 ? (W - left - right) / 2 + left : left + index * ((W - left - right) / (data.length - 1));
    const ys = (value) => top + (1 - value / max) * (H - top - bottom);
    const points = data.map((item, index) => [xs(index), ys(item.value)]);
    const linePath = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L ${points[points.length - 1][0].toFixed(1)} ${H - bottom} L ${points[0][0].toFixed(1)} ${H - bottom} Z`;
    const grid = [0, 1, 2, 3, 4].map((index) => {
      const y = top + (index / 4) * (H - top - bottom);
      return `<line class="chart-grid-line" x1="${left}" y1="${y}" x2="${W - right}" y2="${y}"/>`;
    }).join('');
    const labelStep = Math.max(1, Math.ceil(data.length / 8));
    const labels = data.map((item, index) => {
      if (index % labelStep !== 0 && index !== data.length - 1) return '';
      const dateMatch = item.label.match(/^\d{4}-(\d{2})-(\d{2})$/);
      const label = dateMatch ? `${dateMatch[2]}/${dateMatch[1]}` : item.label;
      return `<text class="chart-axis-label" x="${xs(index)}" y="${H - 8}" text-anchor="middle">${esc(label)}</text>`;
    }).join('');
    const dots = data.length <= 26 ? points.map(([x, y], index) => `<circle class="chart-point" cx="${x}" cy="${y}" r="3.2"><title>${esc(data[index].label)} · ${money(data[index].value)}</title></circle>`).join('') : '';
    return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#F6AA31" stop-opacity=".22"/><stop offset="100%" stop-color="#F6AA31" stop-opacity="0"/></linearGradient></defs>
      ${grid}${areaPath ? `<path class="chart-area" d="${areaPath}"/>` : ''}<path class="chart-line" d="${linePath}" vector-effect="non-scaling-stroke"/>${dots}${labels}
      <text class="chart-axis-label" x="${W - right}" y="12" text-anchor="end">${compactMoney(max)}</text>
    </svg>`;
  }

  function barChart(series, height = 250) {
    const data = (series || []).map((item) => ({
      label: String(item.label ?? ''),
      value: Number(item.sales_cents || 0),
      bills: Number(item.bills || 0),
    }));
    if (!data.length) return '<div class="chart-empty" style="height:230px">Tidak ada data pada periode ini.</div>';
    const W = 860, H = height, left = 8, right = 8, top = 16, bottom = 42;
    const max = Math.max(...data.map((item) => item.value), 1);
    const slot = (W - left - right) / data.length;
    const barWidth = Math.max(8, Math.min(46, slot * 0.58));
    const labelStep = Math.max(1, Math.ceil(data.length / 12));
    const bars = data.map((item, index) => {
      const x = left + index * slot + (slot - barWidth) / 2;
      const h = Math.max(2, (item.value / max) * (H - top - bottom));
      const y = H - bottom - h;
      const label = item.label.length > 20 ? item.label.slice(0, 18) + '…' : item.label;
      const showLabel = index % labelStep === 0 || index === data.length - 1;
      return `<g><rect class="chart-bar" x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="4"><title>${esc(item.label)} · ${money(item.value)}</title></rect>${showLabel ? `<text class="chart-axis-label" x="${x + barWidth / 2}" y="${H - 14}" text-anchor="middle">${esc(label)}</text>` : ''}</g>`;
    }).join('');
    return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${height}px">
      ${[0, 1, 2, 3].map((index) => `<line class="chart-grid-line" x1="${left}" y1="${top + (index / 3) * (H - top - bottom)}" x2="${W - right}" y2="${top + (index / 3) * (H - top - bottom)}"/>`).join('')}
      ${bars}<text class="chart-axis-label" x="${W - right}" y="11" text-anchor="end">${compactMoney(max)}</text>
    </svg>`;
  }

  async function renderAssets() {
    loadingView();
    try {
      await loadRefs();
      const result = await api('/api/admin/assets');
      state.assets = result.data || [];
      paintAssets();
    } catch (error) { errorView(error); }
  }

  function paintAssets() {
    const meta = VIEW_META.assets;
    $('#view').innerHTML = `
      ${pageHead(meta[0], meta[1], meta[2], `<button class="btn ghost" id="refresh-assets">${icon('refresh', 'sm')} Refresh</button>`)}
      <div class="card mb-16">
        <div class="card-head"><div><h3>Upload display slide</h3><p>Gambar akan disimpan di server dan disinkronkan ke second display client.</p></div></div>
        <div class="card-body">
          <form id="asset-form">
            <div class="asset-upload">
              <div class="field" style="margin:0"><label>Brand</label><select class="select" name="brand_id" required>${(state.refs.brands || []).map((brand) => `<option value="${esc(brand.id)}">${esc(brand.name)}</option>`).join('')}</select></div>
              <div class="field" style="margin:0"><label>Outlet</label><select class="select" name="outlet_id"><option value="">All outlets in brand</option>${(state.refs.outlets || []).map((outlet) => `<option value="${esc(outlet.id)}">${esc(outlet.name)} · ${esc(refName('brands', outlet.brand_id))}</option>`).join('')}</select></div>
              <div class="field" style="margin:0"><label>Slide name</label><input class="input" name="name" placeholder="Promo Gajian"></div>
              <div class="field" style="margin:0"><label>Image</label><div class="upload-drop">${icon('upload', 'sm')} Pilih gambar<input type="file" name="file" accept="image/png,image/jpeg,image/webp,image/gif" required></div></div>
            </div>
            <div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn primary" type="submit">${icon('upload', 'sm')} Upload & deploy</button></div>
          </form>
        </div>
      </div>
      <div class="gallery">
        ${state.assets.length ? state.assets.map((asset) => `<div class="asset-card">
          <div class="asset-preview"><img src="${esc(asset.url)}" alt="${esc(asset.name)}" loading="lazy">
            <div class="asset-overlay"><button class="row-action danger" data-delete-asset="${esc(asset.id)}" title="Delete" style="background:rgba(10,14,20,.7)">${icon('trash', 'sm')}</button></div>
          </div>
          <div class="asset-meta"><strong>${esc(asset.name)}</strong><span>${esc(asset.brand_name)}${asset.outlet_name ? ' · ' + esc(asset.outlet_name) : ' · all outlets'}</span>
            <div class="asset-tags"><span class="badge gray">${numberFmt.format(Math.round((asset.size_bytes || 0) / 1024))} KB</span><span class="badge blue">${esc(asset.mime_type?.split('/')[1] || 'image')}</span><span class="code-chip">${esc(String(asset.checksum || '').slice(0, 8))}</span></div>
          </div>
        </div>`).join('') : `<div class="card" style="grid-column:1/-1"><div class="empty-state"><div class="empty-icon">${icon('image')}</div><h3>Belum ada media</h3><p>Upload gambar promo untuk ditampilkan pada second display saat terminal idle.</p></div></div>`}
      </div>`;
    $('#refresh-assets').addEventListener('click', renderAssets);
    $('#asset-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.target;
      if (!form.file.files.length) return toast('File belum dipilih', '', 'error');
      const button = form.querySelector('button[type=submit]');
      button.disabled = true;
      button.innerHTML = '<span class="spinner" style="width:15px;height:15px;border-width:2px"></span> Uploading…';
      const data = new FormData(form);
      try {
        await api('/api/admin/assets', { method: 'POST', body: data });
        toast('Media diupload', 'Client akan menerima slideshow baru saat sinkronisasi.');
        await renderAssets();
      } catch (error) {
        toast('Upload gagal', error.message, 'error');
        button.disabled = false;
        button.innerHTML = `${icon('upload', 'sm')} Upload & deploy`;
      }
    });
    $$('[data-delete-asset]').forEach((button) => button.addEventListener('click', async () => {
      const asset = state.assets.find((item) => item.id === button.dataset.deleteAsset);
      if (!asset) return;
      const confirmed = await confirmDialog('Delete display media?', `File <b>${esc(asset.name)}</b> akan dihapus dari server. Client akan menghapus cache lokal pada sinkronisasi berikutnya.`, 'Delete media');
      if (!confirmed) return;
      try {
        await api(`/api/admin/assets/${asset.id}`, { method: 'DELETE' });
        toast('Media dihapus', asset.name);
        await renderAssets();
      } catch (error) { toast('Gagal menghapus', error.message, 'error'); }
    }));
  }

  async function renderReports() {
    loadingView();
    try {
      await loadRefs();
      if (!state.reportFilters) {
        state.reportFilters = { from: todayStr(), to: todayStr(), brand_id: '', outlet_id: '', group_by: 'day' };
      }
      await loadReports();
    } catch (error) { errorView(error); }
  }

  async function loadReports() {
    const filters = state.reportFilters;
    const params = new URLSearchParams({ from: filters.from, to: filters.to, group_by: filters.group_by });
    if (filters.brand_id) params.set('brand_id', filters.brand_id);
    if (filters.outlet_id) params.set('outlet_id', filters.outlet_id);
    const [sales, bills] = await Promise.all([
      api(`/api/admin/reports/sales?${params.toString()}`),
      api(`/api/admin/reports/bills?${params.toString()}`),
    ]);
    state.reportData = { sales, bills: bills.data || [] };
    paintReports();
  }

  function paintReports() {
    const filters = state.reportFilters;
    const data = state.reportData || { sales: { totals: {}, series: [] }, bills: [] };
    const totals = data.sales.totals || {};
    const series = data.sales.series || [];
    const bills = data.bills || [];
    const outlets = (state.refs.outlets || []).filter((outlet) => !filters.brand_id || outlet.brand_id === filters.brand_id);
    const groupLabels = {
      day: 'Daily revenue', hour: 'Hourly revenue', brand: 'Revenue by brand',
      outlet: 'Revenue by outlet', product: 'Revenue by product', payment: 'Revenue by payment type',
    };
    const avg = totals.bills ? Math.round(totals.total_cents / totals.bills) : 0;
    const meta = VIEW_META.reports;
    $('#view').innerHTML = `
      ${pageHead(meta[0], meta[1], meta[2], `<button class="btn ghost" id="export-report">${icon('download', 'sm')} Export CSV</button>`)}
      <div class="filter-bar">
        <div class="field"><label>From</label><input class="input" type="date" id="report-from" value="${esc(filters.from)}"></div>
        <div class="field"><label>To</label><input class="input" type="date" id="report-to" value="${esc(filters.to)}"></div>
        <div class="field"><label>Brand</label><select class="select" id="report-brand"><option value="">All brands</option>${(state.refs.brands || []).map((brand) => `<option value="${esc(brand.id)}" ${filters.brand_id === brand.id ? 'selected' : ''}>${esc(brand.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Outlet</label><select class="select" id="report-outlet"><option value="">All outlets</option>${outlets.map((outlet) => `<option value="${esc(outlet.id)}" ${filters.outlet_id === outlet.id ? 'selected' : ''}>${esc(outlet.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Group by</label><select class="select" id="report-group"><option value="day" ${filters.group_by === 'day' ? 'selected' : ''}>Day</option><option value="hour" ${filters.group_by === 'hour' ? 'selected' : ''}>Hour</option><option value="brand" ${filters.group_by === 'brand' ? 'selected' : ''}>Brand</option><option value="outlet" ${filters.group_by === 'outlet' ? 'selected' : ''}>Outlet</option><option value="product" ${filters.group_by === 'product' ? 'selected' : ''}>Product</option><option value="payment" ${filters.group_by === 'payment' ? 'selected' : ''}>Payment</option></select></div>
        <button class="btn primary" id="run-report">${icon('search', 'sm')} Apply</button>
        <div class="spacer"></div>
        <button class="btn sm ghost" data-range="today">Today</button>
        <button class="btn sm ghost" data-range="7d">7 days</button>
        <button class="btn sm ghost" data-range="30d">30 days</button>
      </div>

      <div class="report-totals">
        <div class="report-total"><span>Total sales</span><strong>${money(totals.total_cents || 0)}</strong></div>
        <div class="report-total"><span>Bills</span><strong>${numberFmt.format(totals.bills || 0)}</strong></div>
        <div class="report-total"><span>Average bill</span><strong>${money(avg)}</strong></div>
        <div class="report-total"><span>Discount</span><strong style="color:var(--pink)">${money(totals.discount_cents || 0)}</strong></div>
        <div class="report-total"><span>Tax & service</span><strong>${money((totals.tax_cents || 0) + (totals.service_cents || 0))}</strong></div>
      </div>

      <div class="report-grid">
        <div class="card">
          <div class="card-head"><div><h3>${groupLabels[filters.group_by] || 'Revenue'}</h3><p>${filters.from} — ${filters.to}</p></div><div class="spacer"></div><span class="badge amber">${series.length} buckets</span></div>
          <div class="report-chart">${barChart(series, 260)}</div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Bill composition</h3><p>Subtotal, diskon, pajak, dan service</p></div></div>
          <div class="card-body">
            ${[
              ['Subtotal', totals.subtotal_cents || 0, 'var(--amber)'],
              ['Discount', totals.discount_cents || 0, 'var(--pink)'],
              ['Service', totals.service_cents || 0, 'var(--blue)'],
              ['Tax', totals.tax_cents || 0, 'var(--violet)'],
            ].map(([label, value, color]) => `<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line);font-size:11.5px"><span class="muted">${label}</span><b style="color:${color}">${money(value)}</b></div>`).join('')}
            <div style="display:flex;justify-content:space-between;padding:15px 0 2px"><span class="muted">Grand total</span><b style="font-size:17px">${money(totals.total_cents || 0)}</b></div>
            ${bills.length ? `<div class="help" style="margin-top:10px">${bills.length} bill terakhir ditampilkan di tabel bawah.</div>` : ''}
          </div>
        </div>
      </div>

      <div class="table-card">
        <table class="data-table">
          <thead><tr><th>Bill</th><th>Paid at</th><th>Outlet</th><th>Cashier</th><th>Table / mode</th><th>Payment</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>${bills.length ? bills.map((bill) => `<tr data-bill="${esc(bill.id)}" style="cursor:pointer">
            <td><div class="cell-title">${esc(bill.bill_no)}</div><div class="cell-sub">${bill.items || 0} items</div></td>
            <td><span class="faint">${esc(dt(bill.paid_at))}</span></td>
            <td>${esc(bill.outlet_name)}<div class="cell-sub">${esc(bill.brand_name)}</div></td>
            <td>${esc(bill.user_name || bill.client_name)}</td>
            <td>${esc(bill.table_name || bill.sales_mode_name || '—')}</td>
            <td><span class="badge gray">${esc(bill.payment_summary || '—')}</span></td>
            <td><span class="money">${money(bill.total_cents)}</span></td>
            <td><span class="badge ${bill.status === 'paid' ? 'green' : 'gray'}">${esc(bill.status)}</span></td>
          </tr>`).join('') : '<tr><td colspan="8"><div class="empty-state" style="padding:50px"><div class="empty-icon">' + icon('chart') + '</div><h3>Tidak ada transaksi</h3><p>Ubah rentang tanggal atau filter brand/outlet.</p></div></td></tr>'}</tbody>
        </table>
      </div>`;

    $('#run-report').addEventListener('click', applyReportFilters);
    $('#report-group').addEventListener('change', applyReportFilters);
    $('#report-brand').addEventListener('change', () => {
      state.reportFilters.brand_id = $('#report-brand').value;
      state.reportFilters.outlet_id = '';
      loadReports().catch((error) => toast('Gagal memuat report', error.message, 'error'));
    });
    $$('[data-range]').forEach((button) => button.addEventListener('click', () => {
      const to = new Date();
      const from = new Date();
      if (button.dataset.range === '7d') from.setDate(from.getDate() - 6);
      if (button.dataset.range === '30d') from.setDate(from.getDate() - 29);
      state.reportFilters.from = from.toLocaleDateString('en-CA');
      state.reportFilters.to = to.toLocaleDateString('en-CA');
      loadReports().catch((error) => toast('Gagal memuat report', error.message, 'error'));
    }));
    $('#export-report').addEventListener('click', exportReportCsv);
    bindBillLinks();
  }

  function applyReportFilters() {
    state.reportFilters.from = $('#report-from').value || todayStr();
    state.reportFilters.to = $('#report-to').value || todayStr();
    state.reportFilters.brand_id = $('#report-brand').value;
    state.reportFilters.outlet_id = $('#report-outlet').value;
    state.reportFilters.group_by = $('#report-group').value;
    loadReports().catch((error) => toast('Gagal memuat report', error.message, 'error'));
  }

  function exportReportCsv() {
    const bills = state.reportData?.bills || [];
    if (!bills.length) return toast('Tidak ada data', 'Tidak ada bill pada periode ini.', 'info');
    const rows = [
      ['Bill No', 'Paid At', 'Brand', 'Outlet', 'Client', 'Cashier', 'Table', 'Mode', 'Payment', 'Subtotal', 'Discount', 'Tax', 'Service', 'Total', 'Status'],
      ...bills.map((bill) => [
        bill.bill_no, bill.paid_at, bill.brand_name, bill.outlet_name, bill.client_name, bill.user_name,
        bill.table_name, bill.sales_mode_name, bill.payment_summary,
        (Number(bill.subtotal_cents || 0) / 100).toFixed(0), (Number(bill.discount_cents || 0) / 100).toFixed(0),
        (Number(bill.tax_cents || 0) / 100).toFixed(0), (Number(bill.service_cents || 0) / 100).toFixed(0),
        (Number(bill.total_cents || 0) / 100).toFixed(0), bill.status,
      ]),
    ];
    const csv = '\uFEFF' + rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `workapos-sales-${state.reportFilters.from}-${state.reportFilters.to}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast('Export selesai', `${bills.length} bill diexport.`);
  }

  async function openBill(id) {
    openModal({ title: 'Loading bill…', subtitle: '', body: '<div class="loading" style="padding:40px"><div class="spinner"></div></div>', wide: true });
    try {
      const result = await api(`/api/admin/reports/bills/${id}`);
      const bill = result.data;
      const items = bill.items || [];
      const payments = bill.payments || [];
      openModal({
          title: `Bill ${bill.bill_no}`,
          subtitle: `${bill.brand_name} · ${bill.outlet_name} · ${dt(bill.paid_at)}`,
          wide: true,
          body: `<div class="receipt">
            <h2>WORKAPOS</h2>
            <div style="text-align:center" class="muted">${esc(bill.brand_name)}<br>${esc(bill.outlet_name)}</div>
            <div class="line"></div>
            <div class="row"><span>Bill</span><span>${esc(bill.bill_no)}</span></div>
            <div class="row"><span>Time</span><span>${esc(dt(bill.paid_at))}</span></div>
            <div class="row"><span>Cashier</span><span>${esc(bill.user_name || bill.client_name)}</span></div>
            <div class="row"><span>Type</span><span>${esc(bill.table_name || bill.sales_mode_name || '—')}</span></div>
            <div class="line"></div>
            <div class="receipt-items">${items.map((item) => `<div style="margin-bottom:7px"><div class="receipt-item"><span>${esc(item.name)}</span><span>${money(item.total_cents)}</span></div><div class="muted" style="font-size:9px">${item.qty} × ${money(item.unit_price_cents)}${item.note ? ' · ' + esc(item.note) : ''}</div></div>`).join('')}</div>
            <div class="line"></div>
            <div class="row"><span>Subtotal</span><span>${money(bill.subtotal_cents)}</span></div>
            ${Number(bill.discount_cents) ? `<div class="row"><span>Discount</span><span>-${money(bill.discount_cents)}</span></div>` : ''}
            ${Number(bill.service_cents) ? `<div class="row"><span>Service</span><span>${money(bill.service_cents)}</span></div>` : ''}
            ${Number(bill.tax_cents) ? `<div class="row"><span>Tax</span><span>${money(bill.tax_cents)}</span></div>` : ''}
            <div class="line"></div>
            <div class="row total"><span>TOTAL</span><span>${money(bill.total_cents)}</span></div>
            <div class="row"><span>Paid</span><span>${money(bill.paid_cents)}</span></div>
            <div class="row"><span>Change</span><span>${money(bill.change_cents)}</span></div>
            ${payments.map((payment) => `<div class="row"><span>${esc(payment.name || payment.method)}</span><span>${money(payment.amount_cents)}</span></div>`).join('')}
            <div class="line"></div>
            <div style="text-align:center" class="muted">${esc(bill.note || 'Terima kasih atas kunjungan Anda')}</div>
          </div>`,
          footer: `<button class="btn ghost" data-close-modal>Close</button><button class="btn primary" id="copy-bill">${icon('copy', 'sm')} Copy bill no</button>`,
          onMount(overlay) {
            $('#copy-bill', overlay).addEventListener('click', () => copyText(bill.bill_no, 'Bill number disalin'));
          },
      });
    } catch (error) {
      toast('Gagal memuat bill', error.message, 'error');
      closeModal();
    }
  }

  async function renderLive() {
    loadingView();
    try {
      const [dashboard, presence] = await Promise.all([
        api('/api/admin/dashboard'),
        api('/api/admin/presence'),
      ]);
      state.lastDashboard = dashboard;
      state.presence = presence.data || [];
      paintLive();
    } catch (error) { errorView(error); }
  }

  function paintLive() {
    const d = state.lastDashboard || {};
    const clients = state.presence || [];
    const online = clients.filter(isClientOnline);
    const meta = VIEW_META.live;
    const feed = state.liveEvents.length ? state.liveEvents : (d.recent_bills || []).map((bill) => ({
      at: bill.paid_at, kind: 'sale.created',
      data: { ...bill, total_cents: bill.total_cents, bill_no: bill.bill_no, client_name: bill.client_name },
    }));
    $('#view').innerHTML = `
      ${pageHead(meta[0], meta[1], meta[2], `<button class="btn ghost" id="refresh-live">${icon('refresh', 'sm')} Refresh</button>`)}
      <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
        ${kpiCard({ label: 'Realtime sales today', value: money(d.today?.sales_cents || 0), meta: `${d.today?.bills || 0} bills completed`, iconName: 'receipt', color: 'amber', hero: true })}
        ${kpiCard({ label: 'Terminals online', value: `${online.length}<span class="faint" style="font-size:16px"> / ${clients.length}</span>`, meta: 'Websocket presence + heartbeat', iconName: 'wifi', color: 'green' })}
        ${kpiCard({ label: 'Stream status', value: 'Connected', meta: 'Server-sent events active', iconName: 'sparkles', color: 'blue' })}
      </div>
      <div class="dashboard-grid" style="grid-template-columns:1.55fr .8fr">
        <div class="card">
          <div class="card-head"><div><h3>Live transaction stream</h3><p>Transaksi dari semua brand dan outlet</p></div><div class="spacer"></div><span class="badge green"><span class="dot"></span>Realtime</span></div>
          <div class="card-body"><div id="live-feed" style="display:flex;flex-direction:column;gap:9px;max-height:520px;overflow:auto">${feed.length ? feed.slice(0, 40).map(liveEventHtml).join('') : '<div class="empty-state" style="padding:55px"><div class="empty-icon">' + icon('receipt') + '</div><h3>Menunggu transaksi</h3><p>Setiap pembayaran yang selesai di POS akan muncul di sini tanpa refresh.</p></div>'}</div></div>
        </div>
        <div class="stack">
          <div class="card">
            <div class="card-head"><div><h3>Online terminals</h3><p>${online.length} dari ${clients.length} client</p></div><div class="spacer"></div><a class="link" href="#presence">Manage</a></div>
            <div class="card-body" style="display:flex;flex-direction:column;gap:8px">
              ${online.length ? online.slice(0, 7).map((client) => `<div class="brand-split-row"><div class="avatar square" style="background:var(--panel-3);color:var(--amber)">${icon('monitor', 'sm')}</div><div class="brand-split-info"><strong>${esc(client.name)}</strong><span>${esc(client.outlet_name)} · ${esc(client.kind)}</span></div><span class="badge green"><span class="dot"></span>Live</span></div>`).join('') : '<div class="faint tiny" style="padding:10px 0">Tidak ada terminal online.</div>'}
            </div>
          </div>
          <div class="card">
            <div class="card-head"><div><h3>Latest bill</h3><p>Transaksi terakhir</p></div></div>
            <div class="card-body">
              ${(d.recent_bills || []).slice(0, 4).map((bill) => `<div style="padding:9px 0;border-bottom:1px solid var(--line);cursor:pointer" data-bill="${esc(bill.id)}"><div style="display:flex;justify-content:space-between;gap:8px"><b class="tiny">${esc(bill.bill_no)}</b><span class="money tiny">${money(bill.total_cents)}</span></div><div class="faint tiny">${esc(bill.outlet_name)} · ${esc(relTime(bill.paid_at))}</div></div>`).join('') || '<div class="faint tiny">Belum ada transaksi.</div>'}
            </div>
          </div>
        </div>
      </div>`;
    $('#refresh-live').addEventListener('click', renderLive);
    bindBillLinks();
  }

  function liveEventHtml(event) {
    const data = event.data || {};
    const bill = data.bill?.bill || {};
    const total = data.total_cents ?? bill.total_cents ?? 0;
    const billNo = data.bill_no || bill.bill_no || '—';
    const client = data.client_name || bill.client_name || 'POS';
    const table = bill.table_name || bill.sales_mode_name || '';
    return `<div class="command-item" style="padding:12px 13px">
      <div style="width:32px;height:32px;border-radius:9px;background:rgba(53,212,154,.1);display:grid;place-items:center;color:var(--green)">${icon('receipt', 'sm')}</div>
      <div class="grow"><strong>${esc(billNo)} <span class="badge green" style="margin-left:5px">paid</span></strong><span>${esc(client)}${table ? ' · ' + esc(table) : ''} · ${esc(relTime(event.at || data.paid_at))}</span></div>
      <div class="money" style="font-size:13px;color:var(--amber-bright)">${money(total)}</div>
    </div>`;
  }

  function isClientOnline(client) {
    if (client.status === 'online') return true;
    if (!client.last_seen_at) return false;
    return Date.now() - new Date(String(client.last_seen_at).replace(' ', 'T')).getTime() < 3 * 60 * 1000;
  }

  async function renderPresence() {
    loadingView();
    try {
      const result = await api('/api/admin/presence');
      state.presence = result.data || [];
      paintPresence();
    } catch (error) { errorView(error); }
  }

  function paintPresence() {
    const clients = state.presence || [];
    const online = clients.filter(isClientOnline);
    const meta = VIEW_META.presence;
    $('#view').innerHTML = `
      ${pageHead(meta[0], meta[1], meta[2], `<button class="btn ghost" id="refresh-presence">${icon('refresh', 'sm')} Refresh presence</button>`)}
      <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
        ${kpiCard({ label: 'Online terminals', value: `${online.length}<span class="faint" style="font-size:16px"> / ${clients.length}</span>`, meta: 'Koneksi aktif dalam 3 menit terakhir', iconName: 'wifi', color: 'green' })}
        ${kpiCard({ label: 'Cashier terminals', value: clients.filter((c) => c.kind !== 'order_station').length, meta: 'Bisa menerima pembayaran', iconName: 'monitor', color: 'amber' })}
        ${kpiCard({ label: 'Order stations', value: clients.filter((c) => c.kind === 'order_station').length, meta: 'Order-only, tanpa payment', iconName: 'command', color: 'blue' })}
      </div>
      <div class="presence-grid">
        ${clients.length ? clients.map((client) => {
          const onlineClient = isClientOnline(client);
          return `<div class="presence-card">
            <div class="presence-top"><div class="presence-icon">${icon(client.kind === 'order_station' ? 'command' : 'monitor')}</div><div class="presence-title"><strong>${esc(client.name)}</strong><span>${esc(client.code)} · ${esc(client.brand_name)}</span></div><span class="badge ${onlineClient ? 'green' : 'gray'}"><span class="dot"></span>${onlineClient ? 'Online' : 'Offline'}</span></div>
            <div class="presence-details"><span>${icon('store', 'sm')} <b>${esc(client.outlet_name)}</b></span><span>${icon('monitor', 'sm')} <b>${esc(client.kind)}</b></span><span>${icon('refresh', 'sm')} ${esc(relTime(client.last_seen_at))}</span></div>
            <div class="presence-actions">
              <button class="btn sm ghost" data-presence-command="${esc(client.id)}">${icon('command', 'sm')} Command</button>
              <button class="btn sm ghost" data-presence-history="${esc(client.id)}">${icon('receipt', 'sm')} History</button>
              <button class="btn sm ghost" data-presence-sync="${esc(client.id)}">${icon('refresh', 'sm')} Sync</button>
            </div>
          </div>`;
        }).join('') : `<div class="card" style="grid-column:1/-1"><div class="empty-state"><div class="empty-icon">${icon('monitor')}</div><h3>Belum ada client</h3><p>Tambahkan terminal POS pada menu Clients.</p></div></div>`}
      </div>`;
    $('#refresh-presence').addEventListener('click', renderPresence);
    $$('[data-presence-command]').forEach((button) => button.addEventListener('click', () => {
      const client = clients.find((item) => item.id === button.dataset.presenceCommand);
      if (client) openRemoteCommand(client);
    }));
    $$('[data-presence-history]').forEach((button) => button.addEventListener('click', () => {
      const client = clients.find((item) => item.id === button.dataset.presenceHistory);
      if (client) openCommandHistory(client);
    }));
    $$('[data-presence-sync]').forEach((button) => button.addEventListener('click', async () => {
      const client = clients.find((item) => item.id === button.dataset.presenceSync);
      if (client) await sendRemoteCommand(client, 'sync');
    }));
  }

  function openRemoteCommand(client) {
    openModal({
      title: client.name,
      subtitle: `${client.outlet_name || ''} · ${client.code || ''} · ${isClientOnline(client) ? 'online' : 'offline'}`,
      body: `<div class="card" style="background:var(--panel-2);padding:14px;margin-bottom:16px"><div style="display:flex;align-items:center;gap:10px"><div class="presence-icon" style="width:34px;height:34px">${icon('monitor', 'sm')}</div><div><strong class="tiny">Remote command channel</strong><div class="faint tiny">Command akan dikirim via websocket, atau diantrikan saat terminal offline.</div></div></div></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button class="btn" data-cmd="sync">${icon('refresh', 'sm')} Force sync catalog</button>
          <button class="btn" data-cmd="reload">${icon('power', 'sm')} Reload terminal</button>
          <button class="btn" data-cmd="test_print">${icon('printer', 'sm')} Test printer</button>
          <button class="btn" data-cmd="open_drawer">${icon('wallet', 'sm')} Open cash drawer</button>
          <button class="btn" data-cmd="clear_cache">${icon('trash', 'sm')} Clear local cache</button>
          <button class="btn" data-cmd="update_display">${icon('image', 'sm')} Refresh display media</button>
        </div>
        <div class="field" style="margin-top:17px"><label>Message to terminal</label><textarea class="textarea" id="remote-message" placeholder="Pesan akan tampil sebagai overlay di layar kasir…"></textarea></div>
        <button class="btn primary block" id="send-message">${icon('bell', 'sm')} Send message</button>`,
      footer: `<button class="btn ghost" data-close-modal>Close</button><button class="btn" id="remote-history">${icon('receipt', 'sm')} Command history</button>`,
      onMount(overlay) {
        $$('[data-cmd]', overlay).forEach((button) => button.addEventListener('click', async () => {
          await sendRemoteCommand(client, button.dataset.cmd);
        }));
        $('#send-message', overlay).addEventListener('click', async () => {
          const message = $('#remote-message', overlay).value.trim();
          if (!message) return toast('Pesan kosong', 'Tulis pesan terlebih dahulu.', 'error');
          await sendRemoteCommand(client, 'show_message', { message });
          $('#remote-message', overlay).value = '';
        });
        $('#remote-history', overlay).addEventListener('click', () => openCommandHistory(client));
      },
    });
  }

  async function sendRemoteCommand(client, action, payload = {}) {
    try {
      const result = await api(`/api/admin/clients/${client.id}/command`, { method: 'POST', body: { action, payload } });
      toast('Command dikirim', `${action} → ${client.name}${result.online ? '' : ' (queued, terminal offline)'}`, result.online ? 'success' : 'info');
    } catch (error) {
      toast('Command gagal', error.message, 'error');
    }
  }

  async function openCommandHistory(client) {
    try {
      const result = await api(`/api/admin/clients/${client.id}/commands`);
      const commands = result.data || [];
      openModal({
        title: 'Command history',
        subtitle: client.name,
        body: commands.length ? `<div class="command-log">${commands.map((command) => `<div class="command-item"><div>${icon('command', 'sm')}</div><div class="grow"><strong>${esc(command.action)}</strong><span>${esc(dt(command.created_at))} · ${esc(command.status)}</span></div><span class="status">${esc(command.status)}</span></div>`).join('')}</div>` : '<div class="empty-state" style="padding:30px"><p>Belum ada command untuk terminal ini.</p></div>',
        footer: `<button class="btn ghost" data-close-modal>Close</button>`,
      });
    } catch (error) { toast('Gagal memuat history', error.message, 'error'); }
  }

  function connectEvents() {
    closeEvents();
    if (!session?.token) return;
    const source = new EventSource(`/api/admin/events?token=${encodeURIComponent(session.token)}`);
    state.eventSource = source;
    source.onopen = () => updateLiveStatus(true);
    source.onerror = () => updateLiveStatus(false);
    source.addEventListener('sale.created', (event) => {
      try {
        const payload = JSON.parse(event.data);
        state.liveEvents.unshift(payload);
        state.liveEvents = state.liveEvents.slice(0, 40);
        const data = payload.data || {};
        toast('Penjualan baru', `${data.bill_no || 'Bill'} · ${money(data.total_cents || 0)}`, 'success');
        const feed = $('#live-feed');
        if (feed && state.view === 'live') {
          feed.insertAdjacentHTML('afterbegin', liveEventHtml(payload));
        }
        scheduleRefresh();
      } catch { /* ignore malformed event */ }
    });
    source.addEventListener('client.online', (event) => {
      const data = parseEvent(event);
      toast('Terminal online', data?.client_name || data?.client_id || '', 'info');
      if (state.view === 'presence') scheduleRefresh(500);
    });
    source.addEventListener('client.offline', () => {
      if (state.view === 'presence' || state.view === 'live') scheduleRefresh(500);
    });
    source.addEventListener('command.ack', (event) => {
      const data = parseEvent(event);
      toast('Command acknowledged', data?.ok ? 'Client menerima command.' : 'Client gagal menjalankan command.', data?.ok ? 'success' : 'error');
    });
  }

  function parseEvent(event) {
    try { return JSON.parse(event.data); } catch { return null; }
  }

  function updateLiveStatus(online) {
    const dot = $('#live-dot');
    if (!dot) return;
    dot.classList.toggle('off', !online);
    dot.classList.toggle('pulse', online);
    const label = $('#live-label');
    if (label) label.textContent = online ? 'Realtime connected' : 'Reconnecting…';
  }

  function closeEvents() {
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
    }
  }

  function scheduleRefresh(delay = 1200) {
    if (!['dashboard', 'live', 'presence', 'reports'].includes(state.view)) return;
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      if (state.view === 'dashboard') renderDashboard();
      else if (state.view === 'live') renderLive();
      else if (state.view === 'presence') renderPresence();
      else if (state.view === 'reports') loadReports().catch(() => {});
    }, delay);
  }

  function openAccountModal() {
    const user = session.user;
    openModal({
      title: 'Account & session',
      subtitle: 'HQ administrator session',
      narrow: true,
      body: `<div style="display:flex;align-items:center;gap:14px;margin-bottom:20px"><div class="avatar" style="width:52px;height:52px;font-size:17px;background:${esc(user.avatar_color || '#F59E0B')}">${esc(initials(user.name))}</div><div><strong style="font-size:15px">${esc(user.name)}</strong><div class="faint tiny">${esc(user.role_name)} · NIK ${esc(user.nik)}</div></div></div>
        <div class="card" style="background:var(--panel-2);padding:14px"><div class="row" style="display:flex;justify-content:space-between;padding:4px 0"><span class="muted tiny">Brand scope</span><b class="tiny">${esc(user.brand_id ? refName('brands', user.brand_id) : 'All brands')}</b></div><div style="display:flex;justify-content:space-between;padding:4px 0"><span class="muted tiny">Outlet scope</span><b class="tiny">${esc(user.outlet_id ? refName('outlets', user.outlet_id) : 'All outlets')}</b></div><div style="display:flex;justify-content:space-between;padding:4px 0"><span class="muted tiny">Session</span><b class="tiny" style="color:var(--green)">Active · 16 hours</b></div></div>
        <div class="field" style="margin-top:17px"><label>Permissions</label><div style="display:flex;flex-wrap:wrap;gap:5px">${(user.permissions || []).map((permission) => `<span class="badge gray">${esc(permission)}</span>`).join('') || '<span class="badge violet">Full administrator access</span>'}</div></div>`,
      footer: `<button class="btn ghost" data-close-modal>Close</button><button class="btn danger" id="logout-button">${icon('logout', 'sm')} Logout</button>`,
      onMount(overlay) {
        $('#logout-button', overlay).addEventListener('click', async () => {
          const confirmed = await confirmDialog('Logout dari HQ?', 'Sesi administrator akan diakhiri pada browser ini.', 'Logout');
          if (confirmed) { closeModal(); logout(); }
        });
      },
    });
  }

  window.addEventListener('hashchange', route);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });
  window.addEventListener('online', () => updateLiveStatus(true));
  window.addEventListener('offline', () => updateLiveStatus(false));

  boot();
})();
