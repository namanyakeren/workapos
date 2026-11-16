import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Banknote,
  Check,
  CreditCard,
  Delete,
  QrCode,
  RefreshCw,
  Trash2,
  Wallet,
} from 'lucide-react';
import { usePos } from '../store';
import { money } from '../lib/format';
import { bestAutoPromo, computeTotals } from '../lib/pricing';
import { canDiscount, canPay } from '../lib/realtime';
import type { PaymentType } from '../types';

function PayIcon({ type }: { type: PaymentType }) {
  const method = `${type.method} ${type.icon}`.toLowerCase();
  if (method.includes('cash')) return <Banknote size={23} />;
  if (method.includes('qr')) return <QrCode size={23} />;
  if (method.includes('wallet')) return <Wallet size={23} />;
  return <CreditCard size={23} />;
}

export function PaymentPage() {
  const boot = usePos((state) => state.boot);
  const user = usePos((state) => state.user);
  const lines = usePos((state) => state.lines);
  const mode = usePos((state) => state.mode);
  const table = usePos((state) => state.table);
  const customerName = usePos((state) => state.customerName);
  const promo = usePos((state) => state.promo);
  const manualDiscountCents = usePos((state) => state.manualDiscountCents);
  const payments = usePos((state) => state.payments);
  const addPayment = usePos((state) => state.addPayment);
  const removePayment = usePos((state) => state.removePayment);
  const completePayment = usePos((state) => state.completePayment);
  const backToOrder = usePos((state) => state.backToOrder);
  const broadcastPayment = usePos((state) => state.broadcastPayment);
  const toast = usePos((state) => state.toast);

  const [selectedId, setSelectedId] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedType = useMemo(() => {
    if (!boot) return null;
    return boot.payment_types.find((type) => type.id === selectedId)
      || boot.payment_types.find((type) => type.method === 'cash')
      || boot.payment_types[0]
      || null;
  }, [boot, selectedId]);

  const effectiveType = payments[0]?.paymentType || selectedType;
  const effectivePromo = promo || (boot ? bestAutoPromo(boot.promotions, lines) : null);

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
      promo: effectivePromo,
      manualDiscountCents,
      paymentType: effectiveType,
      allowManualDiscount: canDiscount(user, boot.client.kind === 'order_station'),
    });
  }, [boot, user, lines, effectivePromo, manualDiscountCents, effectiveType]);

  const paid = payments.reduce((sum, payment) => sum + payment.amount_cents, 0);
  const remaining = Math.max(0, totals.total_cents - paid);
  const change = Math.max(0, paid - totals.total_cents);
  const amountCents = amount ? Number(amount) * 100 : 0;

  useEffect(() => {
    broadcastPayment(totals, payments.map((payment) => payment.paymentType.name).join(', '));
  }, [totals.total_cents, totals.discount_cents, payments.length, broadcastPayment]);

  if (!boot) return null;

  const groups = boot.payment_groups
    .map((group) => ({
      group,
      types: boot.payment_types.filter((type) => type.group_id === group.id),
    }))
    .filter((entry) => entry.types.length > 0);
  const ungrouped = boot.payment_types.filter((type) => !boot.payment_groups.some((group) => group.id === type.group_id));

  const selectType = (type: PaymentType) => {
    setSelectedId(type.id);
    setAmount('');
    setReference('');
  };

  const quickSet = (rupiah: number) => {
    setAmount(String(Math.max(0, Math.round(rupiah))));
  };

  const currentRemainingRupiah = Math.ceil(remaining / 100);

  const submitPayment = () => {
    if (!selectedType) return;
    const requested = amountCents > 0 ? amountCents : remaining;
    if (requested <= 0) {
      toast('Tidak ada sisa yang perlu dibayar.', 'warn');
      return;
    }
    if (selectedType.requires_reference && !reference.trim()) {
      toast('Nomor referensi wajib diisi untuk metode ini.', 'warn');
      return;
    }
    addPayment(selectedType, requested, reference.trim());
    setAmount('');
    setReference('');
  };

  const finish = async () => {
    if (busy) return;
    if (payments.length === 0) {
      toast('Tambahkan pembayaran terlebih dahulu.', 'warn');
      return;
    }
    if (paid < totals.total_cents) {
      toast('Nominal pembayaran belum mencukupi.', 'warn');
      return;
    }
    setBusy(true);
    const result = await completePayment();
    setBusy(false);
    if (!result.ok) toast(result.message || 'Pembayaran gagal.', 'warn');
  };

  const canFinish = payments.length > 0 && paid >= totals.total_cents && canPay(user, boot.client.kind === 'order_station');

  return (
    <div className="payment-screen">
      <div className="payment-left">
        <div className="payment-top">
          <button type="button" className="btn btn-ghost btn-sm" onClick={backToOrder}>
            <ArrowLeft size={18} /> Kembali ke order
          </button>
          <span className="badge badge-teal">{table?.name || mode?.name || 'Order'}</span>
        </div>

        <div className="payment-order">
          <div className="payment-order-head">
            <div>
              <span className="eyebrow">Ringkasan order</span>
              <h1>{lines.length} item{customerName ? ` · ${customerName}` : ''}</h1>
            </div>
            <span className="payment-table">{table ? table.name : mode?.name}</span>
          </div>
          <div className="payment-items">
            {lines.map((line) => (
              <div key={line.id} className="payment-item">
                <span className="payment-item-emoji">{line.product.emoji}</span>
                <span className="payment-item-copy">
                  <strong>{line.qty}× {line.product.name}</strong>
                  {line.note ? <small>{line.note}</small> : null}
                </span>
                <strong>{money(line.product.price_cents * line.qty)}</strong>
              </div>
            ))}
          </div>
          <div className="payment-totals">
            <div className="summary-row"><span>Subtotal</span><strong>{money(totals.subtotal_cents)}</strong></div>
            {totals.discount_cents > 0 ? <div className="summary-row discount"><span>Diskon</span><strong>−{money(totals.discount_cents)}</strong></div> : null}
            {totals.service_cents > 0 ? <div className="summary-row"><span>Service</span><strong>{money(totals.service_cents)}</strong></div> : null}
            {totals.tax_cents > 0 ? <div className="summary-row"><span>Pajak</span><strong>{money(totals.tax_cents)}</strong></div> : null}
            {totals.surcharge_cents > 0 ? <div className="summary-row"><span>Biaya metode</span><strong>{money(totals.surcharge_cents)}</strong></div> : null}
            {totals.rounding_cents !== 0 ? <div className="summary-row"><span>Pembulatan</span><strong>{money(totals.rounding_cents)}</strong></div> : null}
            <div className="summary-total big"><span>Total</span><strong>{money(totals.total_cents)}</strong></div>
          </div>
        </div>

        <div className="payment-added">
          <div className="section-title">
            <h3>Pembayaran</h3>
            {payments.length > 0 ? <span className="badge badge-green">{payments.length} metode</span> : null}
          </div>
          {payments.map((payment) => (
            <div key={payment.id} className="added-payment">
              <span className="added-icon"><Check size={17} /></span>
              <div>
                <strong>{payment.paymentType.name}</strong>
                {payment.reference ? <small>Ref {payment.reference}</small> : null}
              </div>
              <strong>{money(payment.amount_cents)}</strong>
              <button type="button" className="icon-btn tiny" onClick={() => removePayment(payment.id)} aria-label="Hapus pembayaran">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {payments.length === 0 ? (
            <div className="empty-payment">Belum ada pembayaran dipilih.</div>
          ) : null}
          <div className="payment-balance">
            <span>{remaining > 0 ? 'Sisa tagihan' : 'Kembalian'}</span>
            <strong className={remaining > 0 ? 'due' : 'change'}>{money(remaining > 0 ? remaining : change)}</strong>
          </div>
        </div>
      </div>

      <div className="payment-right">
        <div className="payment-methods">
          <div className="section-title">
            <h3>Metode pembayaran</h3>
            <span className="hint-inline">Pilih satu atau beberapa</span>
          </div>
          {groups.map(({ group, types }) => (
            <div key={group.id} className="pay-group">
              <div className="pay-group-label">{group.name}</div>
              <div className="pay-type-grid">
                {types.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    className={`pay-type ${effectiveType?.id === type.id ? 'active' : ''}`}
                    onClick={() => selectType(type)}
                  >
                    <span className="pay-type-icon"><PayIcon type={type} /></span>
                    <span>{type.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {ungrouped.length > 0 ? (
            <div className="pay-type-grid">
              {ungrouped.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  className={`pay-type ${effectiveType?.id === type.id ? 'active' : ''}`}
                  onClick={() => selectType(type)}
                >
                  <span className="pay-type-icon"><PayIcon type={type} /></span>
                  <span>{type.name}</span>
                </button>
              ))}
            </div>
          ) : null}
          {boot.payment_types.length === 0 ? <div className="empty-mini">Belum ada metode pembayaran.</div> : null}
        </div>

        <div className="payment-entry">
          <div className="amount-display">
            <span className="payload-label">Nominal {selectedType ? `· ${selectedType.name}` : ''}</span>
            <strong className={amount ? '' : 'placeholder'}>{money(amountCents || remaining)}</strong>
            <small>{amount ? 'Nominal yang akan ditambahkan' : 'Sisa tagihan'}</small>
          </div>

          {selectedType?.requires_reference ? (
            <label className="field compact-field">
              <span>Nomor referensi</span>
              <input
                className="input"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Contoh: approval code / nomor kartu"
              />
            </label>
          ) : null}

          <div className="quick-amounts">
            <button type="button" onClick={() => quickSet(currentRemainingRupiah)}>Uang pas</button>
            {[50_000, 100_000, 150_000, 200_000].map((value) => (
              <button key={value} type="button" onClick={() => quickSet(value)}>{money(value * 100)}</button>
            ))}
          </div>

          <div className="amount-keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button key={digit} type="button" onClick={() => setAmount((current) => current === '0' ? digit : `${current}${digit}`.replace(/^0+(?=\d)/, ''))}>
                {digit}
              </button>
            ))}
            <button type="button" className="muted" onClick={() => setAmount('')} aria-label="Hapus semua">
              <RefreshCw size={19} />
            </button>
            <button type="button" onClick={() => setAmount((current) => current === '0' ? current : `${current}0`)}>0</button>
            <button type="button" className="muted" onClick={() => setAmount((current) => current.slice(0, -1))} aria-label="Hapus satu digit">
              <Delete size={20} />
            </button>
          </div>

          <button type="button" className="btn btn-teal btn-block btn-lg" onClick={submitPayment}>
            Tambah Pembayaran
          </button>
          <button
            type="button"
            className="btn btn-primary btn-block btn-xl pay-finish"
            disabled={!canFinish || busy}
            onClick={() => void finish()}
          >
            {busy ? 'Memproses…' : remaining > 0 ? `Bayar ${money(totals.total_cents)}` : `Selesaikan · Kembali ${money(change)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
