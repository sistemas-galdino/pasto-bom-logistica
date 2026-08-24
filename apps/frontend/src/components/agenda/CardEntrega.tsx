// Cartão de uma ENTREGA na AGENDA (somente leitura).
//
// Não confundir com components/EntregaCard.tsx, que é o cartão do QUADRO e
// carrega as ações da viagem: aqui é só consulta, cabe num slot estreito da
// semana e por isso tem modo compacto. Vive nesta pasta porque a agenda do
// caminhão (tela de Rota) mostra os MESMOS cartões — duplicá-los era garantir
// que as duas telas divergissem na primeira correção.

import React from 'react';
import { AlertTriangle, MapPin, Truck, User } from 'lucide-react';
import type { AgendaEntrega } from '@pastobom/shared';
import { STATUS_ENTREGA_META } from '../status';
import { emToneladas } from '../../lib/format';

export interface CardEntregaProps {
  entrega: AgendaEntrega;
  compacto: boolean;
  onAbrir: (entregaId: string) => void;
}

// Ordem de destaque pedida na reunião: CLIENTE, MOTORISTA, BAIRRO (+ cidade).
//
// O cartão é um <button> de largura cheia, e não um <article> com onClick: dá
// foco por Tab, aciona com Enter/Espaço e ganha :focus-visible sem precisar de
// role/tabIndex/onKeyDown à mão. Ela pediu para "clicar no card agendado ou em
// rota e ver os produtos da entrega e quantidade".
export function CardEntrega({
  entrega,
  compacto,
  onAbrir,
}: CardEntregaProps): React.ReactElement {
  const meta = STATUS_ENTREGA_META[entrega.status];
  const local = [entrega.bairro, entrega.cidade]
    .filter((p) => p && p.trim().length > 0)
    .join(' · ');

  return (
    <button
      type="button"
      onClick={() => onAbrir(entrega.entregaId)}
      aria-label={`Ver produtos de ${entrega.clienteNome || 'cliente'}${
        entrega.orixNumero ? `, pedido nº ${entrega.orixNumero}` : ''
      }`}
      className={`animate-sobe block w-full cursor-pointer rounded-xl border border-linha bg-papel text-left shadow-carta transition duration-200 hover:-translate-y-0.5 hover:shadow-flutua focus:outline-none focus-visible:ring-2 focus-visible:ring-folha ${
        compacto ? 'p-2' : 'p-3.5'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h4
          className={`flex min-w-0 items-center gap-1.5 font-display font-semibold leading-tight text-tinta ${
            compacto ? 'text-xs' : 'text-[15px]'
          }`}
        >
          {/* No cartão compacto (mês/semana) não cabe a pílula do status, então
              a cor vira uma bolinha — é o que a legenda do topo explica. */}
          {compacto && (
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${meta.faixa}`}
              title={meta.rotulo}
              aria-label={meta.rotulo}
            />
          )}
          <span className="truncate">{entrega.clienteNome || 'Cliente'}</span>
        </h4>
        {!compacto && (
          <span className="shrink-0 rounded-md bg-creme-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-tinta-suave">
            nº {entrega.orixNumero || '—'}
          </span>
        )}
      </div>

      <p
        className={`mt-1 flex items-center gap-1 font-medium text-tinta-suave ${
          compacto ? 'text-[11px]' : 'text-xs'
        }`}
      >
        <User className="h-3.5 w-3.5 shrink-0 text-pedra" aria-hidden="true" />
        <span className="truncate">
          {entrega.motoristaNome || 'Sem motorista'}
        </span>
      </p>

      <p
        className={`mt-0.5 flex items-center gap-1 text-tinta-suave ${
          compacto ? 'text-[11px]' : 'text-xs'
        }`}
      >
        <MapPin
          className="h-3.5 w-3.5 shrink-0 text-pedra"
          aria-hidden="true"
        />
        <span className="truncate">{local || '—'}</span>
      </p>

      <div
        className={`mt-2 flex items-center justify-between gap-2 border-t border-linha/70 pt-2 ${
          compacto ? 'text-[11px]' : 'text-xs'
        }`}
      >
        <span className="flex min-w-0 items-center gap-1 text-tinta-suave">
          <Truck
            className="h-3.5 w-3.5 shrink-0 text-pedra"
            aria-hidden="true"
          />
          <span className="truncate">{entrega.caminhaoNome || '—'}</span>
        </span>
        {entrega.pesoTotalKg === null ? (
          <span
            className="flex shrink-0 items-center gap-1 text-trigo-escuro"
            title="Algum item do pedido ainda está sem peso cadastrado."
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            peso pendente
          </span>
        ) : (
          <span className="shrink-0 font-semibold text-mata-escuro">
            {emToneladas(entrega.pesoTotalKg)} t
          </span>
        )}
      </div>

      {!compacto && (
        <span
          className={`mt-2 inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${meta.badge}`}
        >
          {meta.rotulo}
        </span>
      )}
    </button>
  );
}
