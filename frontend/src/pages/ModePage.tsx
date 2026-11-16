import { ArrowRight, Bike, Coffee, ShoppingBag, Utensils } from 'lucide-react';
import { usePos } from '../store';
import type { SalesMode } from '../types';

function ModeIcon({ mode, size = 30 }: { mode: SalesMode; size?: number }) {
  const key = `${mode.icon} ${mode.code} ${mode.template}`.toLowerCase();
  if (key.includes('bag') || key.includes('take')) return <ShoppingBag size={size} />;
  if (key.includes('bike') || key.includes('delivery')) return <Bike size={size} />;
  if (key.includes('coffee')) return <Coffee size={size} />;
  return <Utensils size={size} />;
}

export function ModePage() {
  const boot = usePos((state) => state.boot);
  const user = usePos((state) => state.user);
  const selectMode = usePos((state) => state.selectMode);

  if (!boot) return null;

  return (
    <div className="mode-screen">
      <div className="page-intro">
        <div>
          <span className="eyebrow">Langkah 1 dari 2</span>
          <h1>Pilih jenis penjualan</h1>
          <p>Halo {user?.name?.split(' ')[0] || 'kawan'}, mau melayani dengan cara apa hari ini?</p>
        </div>
        <div className="intro-accent" style={{ background: boot.brand.color }}>
          {boot.brand.code}
        </div>
      </div>

      <div className="mode-grid">
        {boot.sales_modes.map((mode, index) => (
          <button
            key={mode.id}
            type="button"
            className="mode-card"
            style={{
              '--mode-color': mode.color,
              animationDelay: `${index * 60}ms`,
            } as React.CSSProperties}
            onClick={() => selectMode(mode)}
          >
            <span className="mode-card-icon"><ModeIcon mode={mode} /></span>
            <span className="mode-card-copy">
              <strong>{mode.name}</strong>
              <small>{mode.template === 'table_service' ? 'Pilih meja & layani di tempat' : 'Order cepat tanpa meja'}</small>
            </span>
            <span className="mode-card-arrow"><ArrowRight size={22} /></span>
          </button>
        ))}
      </div>

      <div className="mode-tip">
        <span className="tip-dot" />
        Tekan kartu untuk melanjutkan. Anda dapat berganti mode sebelum order pertama.
      </div>
    </div>
  );
}
