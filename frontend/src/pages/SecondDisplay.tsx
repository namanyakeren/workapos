import { useEffect, useMemo, useRef, useState } from 'react';
import { ShoppingBag, Sparkles } from 'lucide-react';
import type { Bootstrap, DisplayAsset } from '../types';
import { fetchAssets } from '../lib/api';
import { resolveDisplayMedia, subscribeDisplay, type CachedMedia, type DisplayState } from '../lib/display';
import { cacheBootstrap, readBootstrapCache } from '../lib/storage';
import { clock, dateLong, money } from '../lib/format';

export function SecondDisplay() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [assets, setAssets] = useState<DisplayAsset[]>([]);
  const [media, setMedia] = useState<CachedMedia[]>([]);
  const [index, setIndex] = useState(0);
  const [payment, setPayment] = useState<DisplayState | null>(null);
  const [now, setNow] = useState(new Date());
  const [syncLabel, setSyncLabel] = useState('Menyiapkan tampilan');
  const revokeRef = useRef<(() => void) | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const cached = await readBootstrapCache();
        if (alive && cached) {
          setBoot(cached.bootstrap);
          setAssets(cached.bootstrap.display_assets || []);
        }
      } catch {
        /* first run */
      }
      try {
        const fresh = await fetchAssets();
        if (!alive) return;
        setAssets(fresh);
        setSyncLabel(`Live · ${fresh.length} media`);
        const cached = await readBootstrapCache();
        if (cached) {
          const merged: Bootstrap = { ...cached.bootstrap, display_assets: fresh };
          setBoot(merged);
          await cacheBootstrap(merged);
        }
      } catch {
        if (alive) setSyncLabel('Mode offline · media dari cache');
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 45_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const currentAssets = assets;
    void resolveDisplayMedia(currentAssets).then((result) => {
      if (!alive) {
        result.revoke();
        return;
      }
      revokeRef.current?.();
      revokeRef.current = result.revoke;
      setMedia(result.media);
      setIndex(0);
    });
    return () => {
      alive = false;
    };
  }, [assets]);

  useEffect(() => () => {
    revokeRef.current?.();
    if (intervalRef.current) window.clearInterval(intervalRef.current);
  }, []);

  useEffect(() => subscribeDisplay((state) => {
    setPayment(state.type === 'payment' ? state : null);
  }), []);

  const slideshowSeconds = Math.max(4, boot?.client.slideshow_interval_seconds || 8);

  useEffect(() => {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    if (media.length <= 1) return;
    intervalRef.current = window.setInterval(() => {
      setIndex((current) => (current + 1) % media.length);
    }, slideshowSeconds * 1000);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [media.length, slideshowSeconds]);

  const activeMedia = media[index % Math.max(1, media.length)];
  const brandColor = boot?.brand.color || '#f59e0b';
  const paymentItems = useMemo(() => payment?.items || [], [payment]);

  return (
    <div
      className={`second-display ${payment ? 'is-payment' : 'is-slideshow'}`}
      style={{ '--brand': brandColor } as React.CSSProperties}
    >
      <section className="display-media">
        {activeMedia ? (
          <img key={activeMedia.objectUrl} className="display-image" src={activeMedia.objectUrl} alt={activeMedia.name} />
        ) : (
          <div className="display-fallback">
            <div className="fallback-orb one" />
            <div className="fallback-orb two" />
            <Sparkles size={48} />
            <h2>{boot?.brand.name || 'WORKAPOS'}</h2>
            <p>Slideshow siap. Tambahkan media dari HQ untuk menampilkan promo.</p>
          </div>
        )}
        <div className="display-shade" />

        <div className="display-topbar">
          <div className="display-brand">
            <span className="brand-mark" style={{ '--brand': brandColor } as React.CSSProperties}>
              <span>{boot?.brand.code?.slice(0, 2) || 'W'}</span>
            </span>
            <div>
              <strong>{boot?.brand.name || 'WORKAPOS'}</strong>
              <small>{boot?.outlet.name || 'Terminal pelanggan'}</small>
            </div>
          </div>
          <div className="display-clock">
            <strong>{clock(now)}</strong>
            <span>{dateLong(now)}</span>
          </div>
        </div>

        <div className="display-caption">
          <span className="display-live"><i /> {syncLabel}</span>
          {!payment ? (
            <>
              <h2>{boot?.brand.name || 'Selamat datang'}</h2>
              <p>Nikmati sajian terbaik kami. Pesanan Anda sedang kami siapkan dengan sepenuh hati.</p>
            </>
          ) : (
            <p className="display-pay-hint">Ringkasan pesanan Anda</p>
          )}
        </div>

        {media.length > 1 ? (
          <div className="slideshow-dots">
            {media.map((item, dotIndex) => (
              <button
                key={item.id}
                type="button"
                className={dotIndex === index ? 'active' : ''}
                onClick={() => setIndex(dotIndex)}
                aria-label={`Media ${dotIndex + 1}`}
              />
            ))}
          </div>
        ) : null}
      </section>

      {payment ? (
        <aside className="display-order">
          <div className="display-order-head">
            <span className="eyebrow">Pesanan Anda</span>
            <h2>{payment.table_name || 'Order'}</h2>
            <p>{paymentItems.length} item · {payment.customer_name || 'Pelanggan'}</p>
          </div>
          <div className="display-order-items">
            {paymentItems.map((item, itemIndex) => (
              <div key={`${item.name}-${itemIndex}`} className="display-order-item">
                <span className="display-item-qty">{item.qty}×</span>
                <span className="display-item-name">
                  {item.name}
                  {item.note ? <small>{item.note}</small> : null}
                </span>
                <strong>{money(item.total_cents)}</strong>
              </div>
            ))}
          </div>
          <div className="display-order-totals">
            <div><span>Subtotal</span><span>{money(payment.subtotal_cents)}</span></div>
            {payment.discount_cents > 0 ? <div className="discount"><span>Diskon</span><span>−{money(payment.discount_cents)}</span></div> : null}
            <div className="grand"><span>Total</span><strong>{money(payment.total_cents)}</strong></div>
            {payment.payment_name ? (
              <div className="pay-method"><ShoppingBag size={15} /><span>{payment.payment_name}</span></div>
            ) : null}
            {payment.change_cents > 0 ? (
              <div className="change"><span>Kembalian</span><strong>{money(payment.change_cents)}</strong></div>
            ) : null}
          </div>
          <div className="display-thanks">
            <Sparkles size={18} />
            <span>Terima kasih telah berkunjung</span>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
