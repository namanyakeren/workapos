import type { Brand, CartLine, PaymentType, Promotion, Totals } from '../types';

export function subtotalOf(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.product.price_cents * line.qty, 0);
}

function eligibleBase(promo: Promotion, lines: CartLine[], subtotal: number): number {
  if (promo.scope === 'product') {
    return lines
      .filter((line) => promo.target_ids.includes(line.product.id))
      .reduce((sum, line) => sum + line.product.price_cents * line.qty, 0);
  }
  if (promo.scope === 'group') {
    return lines
      .filter((line) => promo.target_ids.includes(line.product.group_id))
      .reduce((sum, line) => sum + line.product.price_cents * line.qty, 0);
  }
  return subtotal;
}

export function promotionDiscount(promo: Promotion | null, lines: CartLine[]): number {
  if (!promo) return 0;
  const subtotal = subtotalOf(lines);
  if (subtotal <= 0) return 0;
  if (promo.min_subtotal_cents > 0 && subtotal < promo.min_subtotal_cents) return 0;

  const base = eligibleBase(promo, lines, subtotal);
  if (base <= 0) return 0;

  let discount = 0;
  if (promo.type === 'percentage') {
    discount = Math.round((base * Math.max(0, promo.value)) / 100);
  } else if (promo.type === 'fixed') {
    // Promotion.value is authored in whole Rupiah.
    discount = Math.round(Math.max(0, promo.value) * 100);
  } else if (promo.type === 'bogo') {
    for (const line of lines) {
      const isTarget = promo.scope === 'bill'
        || (promo.scope === 'product' && promo.target_ids.includes(line.product.id))
        || (promo.scope === 'group' && promo.target_ids.includes(line.product.group_id));
      if (isTarget) {
        discount += Math.floor(line.qty / 2) * line.product.price_cents;
      }
    }
  }

  if (promo.max_discount_cents && promo.max_discount_cents > 0) {
    discount = Math.min(discount, promo.max_discount_cents);
  }
  return Math.max(0, Math.min(discount, base));
}

export function bestAutoPromo(promotions: Promotion[], lines: CartLine[]): Promotion | null {
  let best: Promotion | null = null;
  let bestValue = 0;
  for (const promo of promotions) {
    if (!promo.auto_apply) continue;
    const value = promotionDiscount(promo, lines);
    if (value > bestValue) {
      best = promo;
      bestValue = value;
    }
  }
  return best;
}

export interface TotalsInput {
  lines: CartLine[];
  brand: Brand;
  promo: Promotion | null;
  manualDiscountCents: number;
  paymentType?: PaymentType | null;
  allowManualDiscount: boolean;
}

export function computeTotals(input: TotalsInput): Totals {
  const subtotal = subtotalOf(input.lines);
  const promoDiscount = Math.min(promotionDiscount(input.promo, input.lines), subtotal);
  const manual = input.allowManualDiscount
    ? Math.max(0, Math.min(Math.round(input.manualDiscountCents || 0), subtotal - promoDiscount))
    : 0;
  const discount = Math.min(subtotal, promoDiscount + manual);
  const taxableBase = Math.max(0, subtotal - discount);
  const service = Math.round(taxableBase * Math.max(0, Number(input.brand.service_charge_rate || 0)));
  const tax = Math.round((taxableBase + service) * Math.max(0, Number(input.brand.tax_rate || 0)));
  const surcharge = input.paymentType
    ? Math.round((taxableBase + service + tax) * Math.max(0, Number(input.paymentType.surcharge_rate || 0)))
    : 0;
  const raw = taxableBase + service + tax + surcharge;
  // Indonesian receipts are usually rounded to the nearest Rp 100.
  const rounding = raw > 0 ? Math.round(raw / 10_000) * 10_000 - raw : 0;
  return {
    subtotal_cents: subtotal,
    promo_discount_cents: promoDiscount,
    manual_discount_cents: manual,
    discount_cents: discount,
    service_cents: service,
    tax_cents: tax,
    surcharge_cents: surcharge,
    rounding_cents: rounding,
    total_cents: Math.max(0, raw + rounding),
  };
}

export function ticketSubtotal(items: Array<{ unit_price_cents: number; qty: number; total_cents?: number }>): number {
  return items.reduce((sum, item) => sum + (item.total_cents ?? item.unit_price_cents * item.qty), 0);
}
