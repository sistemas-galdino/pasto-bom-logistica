// A barra de navegação da agenda: ‹ Hoje ›, o título do período, a contagem de
// entregas e os seletores Mês / Semana / Dia.
//
// Não guarda estado NENHUM de propósito: visão e âncora continuam na página, e
// aqui chegam prontos (título já formatado, total já somado) com os callbacks
// para mexer neles. É o que deixa a tela de Rota montar a mesma barra sobre a
// sua própria navegação sem herdar o estado da tela de Agenda.

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Legenda } from './Legenda';
import type { Visao } from './slots';

export interface NavegadorPeriodoProps {
  visao: Visao;
  /** Título já formatado do período (a formatação é da montagem da página). */
  titulo: string;
  totalEntregas: number;
  /** Mostra o "atualizando…" ao lado da contagem. */
  atualizando: boolean;
  onNavegar: (passo: -1 | 1) => void;
  onHoje: () => void;
  onVisao: (visao: Visao) => void;
}

export function NavegadorPeriodo({
  visao,
  titulo,
  totalEntregas,
  atualizando,
  onNavegar,
  onHoje,
  onVisao,
}: NavegadorPeriodoProps): React.ReactElement {
  const abaCls = (ativo: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
      ativo
        ? 'bg-mata text-creme-50 shadow-sm'
        : 'border border-linha bg-papel text-tinta-suave hover:border-mata/30 hover:text-mata'
    }`;

  const navCls =
    'flex h-8 w-8 items-center justify-center rounded-lg border border-linha bg-papel text-tinta-suave transition hover:border-mata/30 hover:text-mata';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-linha bg-creme-50/70 px-4 py-2.5 backdrop-blur sm:px-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onNavegar(-1)}
            aria-label="Período anterior"
            className={navCls}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onHoje}
            className="rounded-lg border border-linha bg-papel px-3 py-1.5 text-xs font-semibold text-tinta-suave transition hover:border-mata/30 hover:text-mata"
          >
            Hoje
          </button>
          <button
            type="button"
            onClick={() => onNavegar(1)}
            aria-label="Próximo período"
            className={navCls}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-baseline gap-2 text-sm">
          <h2 className="font-display text-base font-semibold text-mata-escuro">
            {titulo}
          </h2>
          <span className="text-pedra">·</span>
          <span className="text-tinta-suave">
            {totalEntregas === 1 ? '1 entrega' : `${totalEntregas} entregas`}
          </span>
          {atualizando && (
            <span className="text-xs text-pedra">atualizando…</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Legenda />
        <span className="hidden h-4 w-px bg-linha sm:block" />
        <button
          type="button"
          onClick={() => onVisao('mes')}
          className={abaCls(visao === 'mes')}
        >
          Mês
        </button>
        <button
          type="button"
          onClick={() => onVisao('semana')}
          className={abaCls(visao === 'semana')}
        >
          Semana
        </button>
        <button
          type="button"
          onClick={() => onVisao('dia')}
          className={abaCls(visao === 'dia')}
        >
          Dia
        </button>
      </div>
    </div>
  );
}
