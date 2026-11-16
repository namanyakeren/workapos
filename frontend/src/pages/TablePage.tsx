import { ArrowLeft, Armchair, Crown, Users } from 'lucide-react';
import { useMemo } from 'react';
import { usePos } from '../store';
import type { FloorTable } from '../types';

function typeLabel(type: string): string {
  if (type === 'vip') return 'VIP';
  if (type === 'bar') return 'Bar';
  if (type === 'outdoor') return 'Outdoor';
  return 'Regular';
}

export function TablePage() {
  const boot = usePos((state) => state.boot);
  const mode = usePos((state) => state.mode);
  const selectTable = usePos((state) => state.selectTable);
  const cancelActiveTicket = usePos((state) => state.cancelActiveTicket);

  const zones = useMemo(() => {
    if (!boot) return [];
    const map = new Map<string, FloorTable[]>();
    for (const table of boot.tables) {
      const zone = table.zone || 'Main';
      if (!map.has(zone)) map.set(zone, []);
      map.get(zone)!.push(table);
    }
    return [...map.entries()].map(([zone, tables]) => ({
      zone,
      tables: tables.sort((a, b) => a.sort_order - b.sort_order || a.number.localeCompare(b.number)),
    }));
  }, [boot]);

  if (!boot) return null;

  return (
    <div className="table-screen">
      <div className="page-intro">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => usePos.setState({ screen: 'mode' })}>
          <ArrowLeft size={18} /> Ganti mode
        </button>
        <div>
          <span className="eyebrow">{mode?.name || 'Dine In'} · Langkah 2 dari 2</span>
          <h1>Pilih meja</h1>
          <p>{boot.tables.length} meja tersedia di {boot.outlet.name}. Ketuk meja untuk mulai order.</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            void cancelActiveTicket();
            selectTable(null);
          }}
        >
          Lanjut tanpa meja
        </button>
      </div>

      <div className="zone-list">
        {zones.map(({ zone, tables }) => (
          <section key={zone} className="zone-block">
            <div className="zone-head">
              <h2>{zone}</h2>
              <span>{tables.length} meja</span>
            </div>
            <div className="table-grid">
              {tables.map((table) => (
                <button
                  key={table.id}
                  type="button"
                  className={`table-card ${table.table_type}`}
                  onClick={() => selectTable(table)}
                >
                  <span className="table-card-top">
                    <span className="table-number">{table.number}</span>
                    {table.table_type === 'vip' ? <Crown size={18} /> : <Armchair size={18} />}
                  </span>
                  <span className="table-name">{table.name}</span>
                  <span className="table-meta">
                    <Users size={15} />
                    {table.seats} kursi
                    <i />
                    {typeLabel(table.table_type)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {zones.length === 0 ? (
          <div className="empty-state">
            <Armchair size={42} />
            <h3>Belum ada meja</h3>
            <p>Tambahkan meja dari HQ, atau lanjutkan tanpa meja.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
