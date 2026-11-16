import { useMemo, useState } from 'react';
import {
  BadgePercent,
  ChevronLeft,
  CreditCard,
  Minus,
  Plus,
  Search,
  Send,
  ShoppingCart,
  StickyNote,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { usePos } from '../store';
import type { CartLine, Promotion } from '../types';
import { money } from '../lib/format';
import { computeTotals, bestAutoPromo, promotionDiscount } from '../lib/pricing';
import { canDiscount, canPay } from '../lib/realtime';
import { Modal } from '../components/Modal';

export function OrderPage() {
  const boot = usePos((state) => state.boot);
  const user = usePos((state) => state.user);
  const lines = usePos((state) => state.lines);
  const mode = usePos((state) => state.mode);
  const table = usePos((state) => state.table);
  const promo = usePos((state) => state.promo);
  const manualDiscountCents = usePos((state) => state.manualDiscountCents);
  const customerName = usePos((state) => state.customerName);
  const note = usePos((state) => state.note);
  const addProduct = usePos((state) => state.addProduct);
  const changeQty = usePos((state) => state.changeQty);
  const removeLine = usePos((state) => state.removeLine);
  const setLineNote = usePos((state) => state.setLineNote);
  const applyPromotion = usePos((state) => state.applyPromotion);
  const setManualDiscount = usePos((state) => state.setManualDiscount);
  const setCustomerName = usePos((state) => state.setCustomerName);
  const setNote = usePos((state) => state.setNote);
  const goPayment = usePos((state) => state.goPayment);
  const sendOrder = usePos((state) => state.sendOrder);
  const toast = usePos((state) => state.toast);
  const clearCart = usePos((state) => state.clearCart);

  const [activeGroup, setActiveGroup] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [noteLine, setNoteLine] = useState<CartLine | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [promoOpen, setPromoOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountDraft, setDiscountDraft] = useState('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerDraft, setCustomerDraft] = useState(customerName);
  const [noteDraftOrder, setNoteDraftOrder] = useState(note);
  const [sending, setSending] = useState(false);

  const orderStation = boot?.client.kind === 'order_station';
  const discountAllowed = canDiscount(user, Boolean(orderStation));
  const paymentAllowed = canPay(user, Boolean(orderStation));

  const activePromo = promo || (boot ? bestAutoPromo(boot.promotions, lines) : null);

  const totals = useMemo(() => {
    if (!boot) {
      return {
        subtotal_cents: 0, promo_discount_cents: 0, manual_discount_cents: 0,
        discount_cents: 0, service_cents: 0, tax_cents: 0, surcharge_cents: 0,
        rounding_cents: 0, total_cents: 0,
      };
    }
    return computeTotals({
      lines,
      brand: boot.brand,
      promo: activePromo,
      manualDiscountCents,
      allowManualDiscount: discountAllowed,
    });
  }, [boot, lines, activePromo, manualDiscountCents, discountAllowed]);

  const filteredProducts = useMemo(() => {
    if (!boot) return [];
    const needle = search.trim().toLowerCase();
    return boot.products.filter((product) => {
      if (activeGroup !== 'all' && product.group_id !== activeGroup) return false;
      if (!needle) return true;
      return `${product.name} ${product.sku} ${product.description}`.toLowerCase().includes(needle);
    });
  }, [boot, activeGroup, search]);

  const groupCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const product of boot?.products || []) {
      map.set(product.group_id, (map.get(product.group_id) || 0) + 1);
    }
    return map;
  }, [boot]);

  const itemCount = lines.reduce((sum, line) => sum + line.qty, 0);

  if (!boot) return null;

  const openNote = (line: CartLine) => {
    setNoteLine(line);
    setNoteDraft(line.note);
  };

  const saveNote = () => {
    if (!noteLine) return;
    setLineNote(noteLine.id, noteDraft.trim());
    setNoteLine(null);
    setNoteDraft('');
  };

  const openDiscount = () => {
    setDiscountDraft(String(Math.round(manualDiscountCents / 100)));
    setDiscountOpen(true);
  };

  const saveDiscount = () => {
    const value = Number(discountDraft.replace(/[^\d]/g, ''));
    setManualDiscount(Number.isFinite(value) ? value * 100 : 0);
    setDiscountOpen(false);
  };

  const saveCustomer = () => {
    setCustomerName(customerDraft.trim());
    setNote(noteDraftOrder.trim());
    setCustomerOpen(false);
  };

  const handlePay = () => {
    if (lines.length === 0) {
      toast('Tambahkan item terlebih dahulu.', 'warn');
      return;
    }
    if (paymentAllowed) {
      goPayment();
    } else {
      void handleSend();
    }
  };

  const handleSend = async () => {
    if (sending) return;
    if (lines.length === 0) {
      toast('Tambahkan item terlebih dahulu.', 'warn');
      return;
    }
    setSending(true);
    const result = await sendOrder();
    setSending(false);
    if (!result.ok) toast(result.message || 'Order gagal dikirim.', 'warn');
  };

  return (
    <div className="order-screen">
      <aside className="category-rail">
        <button
          type="button"
          className={`category-btn ${activeGroup === 'all' ? 'active' : ''}`}
          onClick={() => setActiveGroup('all')}
        >
          <span className="category-icon all"><ShoppingCart size={19} /></span>
          <span>Semua</span>
          <small>{boot.products.length}</small>
        </button>
        {boot.product_groups.map((group) => (
          <button
            key={group.id}
            type="button"
            className={`category-btn ${activeGroup === group.id ? 'active' : ''}`}
            onClick={() => setActiveGroup(group.id)}
            style={{ '--group-color': group.color } as React.CSSProperties}
          >
            <span className="category-dot" />
            <span>{group.name}</span>
            <small>{groupCounts.get(group.id) || 0}</small>
          </button>
        ))}
      </aside>

      <main className="catalog">
        <div className="catalog-head">
          <div className="search-box">
            <Search size={20} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cari menu, SKU, atau kata kunci…"
              aria-label="Cari produk"
            />
            {search ? (
              <button type="button" className="search-clear" onClick={() => setSearch('')} aria-label="Bersihkan pencarian">
                <X size={18} />
              </button>
            ) : null}
          </div>
          <div className="catalog-count">
            <strong>{filteredProducts.length}</strong>
            <span>menu</span>
          </div>
        </div>

        <div className="product-grid">
          {filteredProducts.map((product) => (
            <button
              key={product.id}
              type="button"
              className="product-card"
              style={{ '--product-color': product.color } as React.CSSProperties}
              onClick={() => addProduct(product)}
            >
              <span className="product-emoji">{product.emoji || '🍽️'}</span>
              <span className="product-copy">
                <strong>{product.name}</strong>
                <small>{product.sku}</small>
              </span>
              <span className="product-price">{money(product.price_cents)}</span>
              <span className="product-add"><Plus size={18} /></span>
            </button>
          ))}
          {filteredProducts.length === 0 ? (
            <div className="empty-state wide">
              <Search size={40} />
              <h3>Tidak ada menu yang cocok</h3>
              <p>Coba kata kunci lain atau pilih kategori berbeda.</p>
            </div>
          ) : null}
        </div>
      </main>

      <aside className="cart-panel">
        <div className="cart-head">
          <div>
            <span className="eyebrow">Order saat ini</span>
            <h2>{table ? table.name : mode?.name || 'Pesanan baru'}</h2>
            <p>{itemCount} item · {mode?.name || 'Penjualan'}</p>
          </div>
          {lines.length > 0 ? (
            <button type="button" className="icon-btn" onClick={() => clearCart()} title="Kosongkan keranjang">
              <Trash2 size={19} />
            </button>
          ) : null}
        </div>

        <div className="cart-lines">
          {lines.map((line) => (
            <div key={line.id} className="cart-line">
              <span className="cart-line-emoji" style={{ background: `${line.product.color}22` }}>{line.product.emoji}</span>
              <div className="cart-line-main">
                <div className="cart-line-title">
                  <strong>{line.product.name}</strong>
                  <span>{money(line.product.price_cents * line.qty)}</span>
                </div>
                <div className="cart-line-meta">
                  <small>{money(line.product.price_cents)} / item</small>
                  <button type="button" className="note-btn" onClick={() => openNote(line)}>
                    <StickyNote size={13} /> {line.note ? 'Ubah catatan' : 'Catatan'}
                  </button>
                </div>
                {line.note ? <div className="line-note">{line.note}</div> : null}
                <div className="qty-row">
                  <button type="button" className="qty-btn" onClick={() => changeQty(line.id, -1)} aria-label="Kurangi">
                    <Minus size={16} />
                  </button>
                  <span>{line.qty}</span>
                  <button type="button" className="qty-btn" onClick={() => changeQty(line.id, 1)} aria-label="Tambah">
                    <Plus size={16} />
                  </button>
                  <button type="button" className="line-remove" onClick={() => removeLine(line.id)}>Hapus</button>
                </div>
              </div>
            </div>
          ))}
          {lines.length === 0 ? (
            <div className="cart-empty">
              <ShoppingCart size={38} />
              <h3>Keranjang kosong</h3>
              <p>Ketuk menu di sebelah kiri untuk mulai order.</p>
            </div>
          ) : null}
        </div>

        <div className="cart-tools">
          {!orderStation ? (
            <button type="button" className="tool-btn" onClick={() => setPromoOpen(true)}>
              <BadgePercent size={17} />
              <span>{activePromo ? activePromo.name : 'Promo'}</span>
            </button>
          ) : null}
          {discountAllowed ? (
            <button type="button" className="tool-btn" onClick={openDiscount}>
              <BadgePercent size={17} />
              <span>{manualDiscountCents > 0 ? `Diskon ${money(manualDiscountCents)}` : 'Diskon manual'}</span>
            </button>
          ) : null}
          <button type="button" className="tool-btn" onClick={() => { setCustomerDraft(customerName); setNoteDraftOrder(note); setCustomerOpen(true); }}>
            <UserRound size={17} />
            <span>{customerName || 'Pelanggan'}</span>
          </button>
        </div>

        <div className="cart-summary">
          <div className="summary-row"><span>Subtotal</span><strong>{money(totals.subtotal_cents)}</strong></div>
          {totals.discount_cents > 0 ? (
            <div className="summary-row discount"><span>Diskon</span><strong>−{money(totals.discount_cents)}</strong></div>
          ) : null}
          {totals.service_cents > 0 ? (
            <div className="summary-row"><span>Service {Math.round(Number(boot.brand.service_charge_rate) * 100)}%</span><strong>{money(totals.service_cents)}</strong></div>
          ) : null}
          {totals.tax_cents > 0 ? (
            <div className="summary-row"><span>Pajak {Math.round(Number(boot.brand.tax_rate) * 100)}%</span><strong>{money(totals.tax_cents)}</strong></div>
          ) : null}
          {totals.rounding_cents !== 0 ? (
            <div className="summary-row"><span>Pembulatan</span><strong>{money(totals.rounding_cents)}</strong></div>
          ) : null}
          <div className="summary-total"><span>Total</span><strong>{money(totals.total_cents)}</strong></div>
        </div>

        <button
          type="button"
          className="btn btn-primary btn-block btn-xl pay-btn"
          disabled={sending || lines.length === 0}
          onClick={() => void handlePay()}
        >
          {paymentAllowed ? <CreditCard size={22} /> : <Send size={22} />}
          <span>
            {paymentAllowed ? 'Bayar' : orderStation ? 'Kirim ke Kasir' : 'Simpan Order'}
            <small>{money(totals.total_cents)}</small>
          </span>
        </button>
        {paymentAllowed && lines.length > 0 ? (
          <button type="button" className="btn btn-ghost btn-block btn-sm" onClick={() => void handleSend()}>
            <Send size={16} /> Simpan sebagai ticket order
          </button>
        ) : null}
      </aside>

      <Modal
        open={Boolean(noteLine)}
        onClose={() => setNoteLine(null)}
        title="Catatan Item"
        subtitle={noteLine ? noteLine.product.name : ''}
        size="sm"
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setNoteLine(null)}>Batal</button>
            <button type="button" className="btn btn-primary" onClick={saveNote}>Simpan</button>
          </>
        )}
      >
        <label className="field">
          <span>Catatan dapur</span>
          <textarea
            className="input textarea"
            rows={3}
            value={noteDraft}
            placeholder="Contoh: tanpa sambal, extra pedas…"
            onChange={(event) => setNoteDraft(event.target.value)}
          />
        </label>
      </Modal>

      <Modal
        open={promoOpen}
        onClose={() => setPromoOpen(false)}
        title="Promo & Voucher"
        subtitle="Promo otomatis dipilih jika tidak ada promo manual."
        size="md"
      >
        <div className="promo-list">
          {boot.promotions.map((item: Promotion) => {
            const discount = promotionDiscount(item, lines);
            const active = activePromo?.id === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`promo-card ${active ? 'active' : ''} ${discount <= 0 ? 'disabled' : ''}`}
                disabled={discount <= 0}
                onClick={() => {
                  applyPromotion(item);
                  setPromoOpen(false);
                  toast(`Promo ${item.name} diterapkan.`, 'success');
                }}
              >
                <span className="promo-icon"><BadgePercent size={20} /></span>
                <span className="promo-copy">
                  <strong>{item.name}</strong>
                  <small>
                    {item.code ? <code>{item.code}</code> : null}
                    {item.type === 'percentage' ? `${item.value}%` : item.type === 'fixed' ? money(item.value * 100) : 'Buy 1 Get 1'}
                    {item.auto_apply ? ' · otomatis' : ''}
                  </small>
                </span>
                <span className="promo-value">{discount > 0 ? `−${money(discount)}` : 'Belum memenuhi'}</span>
              </button>
            );
          })}
          {boot.promotions.length === 0 ? <div className="empty-mini">Belum ada promo aktif.</div> : null}
        </div>
        <div className="modal-inline-actions">
          <button type="button" className="btn btn-ghost" onClick={() => { applyPromotion(null); setPromoOpen(false); }}>
            Gunakan promo otomatis
          </button>
        </div>
      </Modal>

      <Modal
        open={discountOpen}
        onClose={() => setDiscountOpen(false)}
        title="Diskon Manual"
        subtitle="Diskon dalam Rupiah, dibatasi oleh subtotal."
        size="sm"
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDiscountOpen(false)}>Batal</button>
            <button type="button" className="btn btn-primary" onClick={saveDiscount}>Terapkan</button>
          </>
        )}
      >
        <label className="field">
          <span>Nominal diskon (Rp)</span>
          <input
            className="input input-lg"
            inputMode="numeric"
            value={discountDraft}
            onChange={(event) => setDiscountDraft(event.target.value.replace(/[^\d]/g, ''))}
            placeholder="0"
          />
        </label>
        <div className="hint">Maksimal {money(totals.subtotal_cents)} sebelum pajak & service.</div>
      </Modal>

      <Modal
        open={customerOpen}
        onClose={() => setCustomerOpen(false)}
        title="Detail Pelanggan"
        subtitle="Opsional, membantu dapur dan struk."
        size="md"
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setCustomerOpen(false)}>Batal</button>
            <button type="button" className="btn btn-primary" onClick={saveCustomer}>Simpan</button>
          </>
        )}
      >
        <label className="field">
          <span>Nama pelanggan</span>
          <input
            className="input"
            value={customerDraft}
            onChange={(event) => setCustomerDraft(event.target.value)}
            placeholder="Opsional"
          />
        </label>
        <label className="field">
          <span>Catatan order</span>
          <textarea
            className="input textarea"
            rows={3}
            value={noteDraftOrder}
            onChange={(event) => setNoteDraftOrder(event.target.value)}
            placeholder="Contoh: semua makanan keluar bersamaan…"
          />
        </label>
      </Modal>
    </div>
  );
}
