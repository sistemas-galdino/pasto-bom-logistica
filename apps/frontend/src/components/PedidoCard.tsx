// Cartão de PEDIDO (a ordem de venda) — Onda 2.
//
// Depois que o ciclo da viagem migrou para a ENTREGA, este cartão tem um papel
// só: mostrar o que AINDA FALTA entregar de um pedido e abrir o agendamento.
// Ele vive na coluna Pendente (e na aba de descartados).
//
// O saldo é o dado principal. "Restam 80 de 180" é a informação que faz a
// logística decidir; a quantidade total do pedido, sozinha, mente quando parte
// já saiu.

import React from 'react';
import type { Pedido, SaldoItem } from '@pastobom/shared';
import { formatarData, formatarMoeda } from '../lib/format';
import { rotuloStatusOrix } from './status';

interface Props {
  pedido: Pedido;
  /** Saldo calculado; ausente na aba de descartados, onde não faz sentido. */
  saldo?: SaldoItem[];
  podeEscrever: boolean;
  onAgendar?: (pedido: Pedido) => void;
  onDescartar?: (pedido: Pedido) => void;
  onRestaurar?: (pedido: Pedido) => void;
}

function formatarQtd(qtd: number): string {
  return qtd.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function IconePin(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0 text-pedra"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5c0 3.2 4.5 8.5 4.5 8.5s4.5-5.3 4.5-8.5A4.5 4.5 0 0 0 8 1.5Zm0 6.2a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4Z"
      />
    </svg>
  );
}

export function PedidoCard({
  pedido,
  saldo,
  podeEscrever,
  onAgendar,
  onDescartar,
  onRestaurar,
}: Props): React.ReactElement {
  const local = [pedido.bairro, pedido.cidadeCliente]
    .filter((p) => p && p.trim() !== '')
    .join(' · ');

  const statusOrixNome = pedido.statusOrixNome?.trim() ?? '';
  const statusOrixRotulo = rotuloStatusOrix(pedido.statusOrix, statusOrixNome);

  const comSaldo = (saldo ?? []).filter((s) => s.qtdSaldo > 0);
  // "Parcial" quando alguma coisa já foi para uma viagem: é o aviso de que este
  // cartão é o RESTO de um pedido, não o pedido inteiro.
  const parcial = (saldo ?? []).some((s) => s.qtdComprometida > 0);
  const descartado = pedido.statusLogistico === 'cancelada';

  return (
    <article className="animate-sobe rounded-xl border border-linha bg-papel p-3.5 shadow-carta transition duration-200 hover:-translate-y-0.5 hover:shadow-flutua">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display text-[15px] font-semibold leading-tight text-tinta">
          {pedido.clienteNome || pedido.clienteCodigo || 'Cliente'}
        </h3>
        <span className="shrink-0 rounded-md bg-creme-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-tinta-suave">
          nº {pedido.orixNumero || '—'}
        </span>
      </div>

      <p className="mt-1 flex items-center gap-1 text-xs text-tinta-suave">
        <IconePin />
        {local || '—'}
      </p>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-pedra">
        {pedido.dataPedido && (
          <span>
            Entrada:{' '}
            <span className="font-semibold text-tinta-suave">
              {formatarData(pedido.dataPedido)}
            </span>
          </span>
        )}
        {statusOrixRotulo !== '' && (
          <span
            title={`Status no Órix: ${statusOrixNome || statusOrixRotulo}`}
            className="max-w-full truncate rounded-md bg-creme-100 px-1.5 py-0.5 font-semibold text-tinta-suave"
          >
            {statusOrixRotulo}
          </span>
        )}
        {parcial && (
          <span
            title="Parte deste pedido já está em uma entrega."
            className="rounded-md bg-trigo-claro px-1.5 py-0.5 font-semibold text-trigo-escuro"
          >
            Parcial
          </span>
        )}
      </div>

      {/* O SALDO: o que ainda falta entregar. */}
      {saldo !== undefined && (
        <ul className="mt-2.5 space-y-0.5 border-t border-linha/70 pt-2 text-xs text-tinta-suave">
          {comSaldo.slice(0, 4).map((item) => (
            <li key={item.produtoCodigo} className="flex items-baseline gap-1.5">
              <span className="font-bold text-tinta">
                {formatarQtd(item.qtdSaldo)}×
              </span>
              <span className="truncate">
                {item.nomeProduto || item.produtoCodigo}
              </span>
              {item.qtdComprometida > 0 && (
                <span className="shrink-0 text-[10px] text-pedra">
                  de {formatarQtd(item.qtdPedido)}
                </span>
              )}
            </li>
          ))}
          {comSaldo.length > 4 && (
            <li className="text-[11px] text-pedra">
              + {comSaldo.length - 4} outro{comSaldo.length - 4 > 1 ? 's' : ''}
            </li>
          )}
        </ul>
      )}

      <p className="mt-2 text-right font-display text-sm font-semibold text-mata-escuro">
        {formatarMoeda(pedido.valorTotal)}
      </p>

      {podeEscrever && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-linha/70 pt-3">
          {!descartado && onAgendar && (
            <button
              type="button"
              onClick={() => onAgendar(pedido)}
              className="rounded-lg bg-mata px-2.5 py-1.5 text-xs font-bold text-creme-50 transition hover:bg-mata-escuro"
            >
              Agendar entrega
            </button>
          )}
          {!descartado && onDescartar && (
            <button
              type="button"
              onClick={() => onDescartar(pedido)}
              title="Some do quadro por não ser uma entrega. Reversível."
              className="rounded-lg border border-linha px-2.5 py-1.5 text-xs font-semibold text-tinta-suave transition hover:border-terra/40 hover:text-terra-escuro"
            >
              Descartar
            </button>
          )}
          {descartado && onRestaurar && (
            <button
              type="button"
              onClick={() => onRestaurar(pedido)}
              className="rounded-lg border border-linha px-2.5 py-1.5 text-xs font-semibold text-tinta-suave transition hover:border-mata/30 hover:text-mata"
            >
              Restaurar
            </button>
          )}
        </div>
      )}
    </article>
  );
}
