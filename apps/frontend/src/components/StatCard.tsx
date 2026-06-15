// Cartão de métrica do dashboard: rótulo, valor em destaque, "sub" opcional e
// um ícone (lucide) em chip colorido conforme o acento da paleta "Campo Claro".

import React from 'react';
import type { LucideIcon } from 'lucide-react';

export type StatCardAccent = 'mata' | 'folha' | 'trigo' | 'terra' | 'pedra';

// Chip do ícone: fundo "claro" + texto no acento. "pedra" não tem variante
// -claro na paleta, então espelha o estilo "pendente" do STATUS_META.
const ACCENT_CHIP: Record<StatCardAccent, string> = {
  mata: 'bg-mata-claro text-mata-escuro',
  folha: 'bg-folha-claro text-mata',
  trigo: 'bg-trigo-claro text-trigo-escuro',
  terra: 'bg-terra-claro text-terra-escuro',
  pedra: 'bg-creme-100 text-tinta-suave',
};

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: LucideIcon;
  accent?: StatCardAccent;
}

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = 'mata',
}: StatCardProps): React.ReactElement {
  return (
    <div className="rounded-xl2 border border-linha bg-papel p-4 shadow-carta transition hover:shadow-flutua sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">
            {label}
          </p>
          <p className="mt-1 font-display text-2xl font-semibold text-mata-escuro sm:text-3xl">
            {value}
          </p>
          {sub && <p className="mt-0.5 truncate text-xs text-pedra">{sub}</p>}
        </div>
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl2 ${ACCENT_CHIP[accent]}`}
        >
          <Icon className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}
