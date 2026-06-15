// Modal de separação de mercadorias (RF-2.2).
//
// O líder de almoxarifado (ou a logística) marca cada item como separado.
// Enquanto a separação não estiver completa, o pedido não pode ir para 'em rota'
// (regra validada no backend). Mostra o progresso e libera quando tudo é marcado.

import React from 'react';
import type { Pedido } from '@pastobom/shared';

interface Props {
  pedido: Pedido;
  enviando: boolean;
  erro: string | null;
  onToggle: (itemId: string, separado: boolean) => void;
  onFechar: () => void;
}

function IconeCheck(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.5 8.5l3 3 6-7"
      />
    </svg>
  );
}

export function SeparacaoModal({
  pedido,
  enviando,
  erro,
  onToggle,
  onFechar,
}: Props): React.ReactElement {
  const tot = pedido.itens.length;
  const sep = pedido.itens.filter((i) => i.separado).length;
  const completa = tot > 0 && sep === tot;
  const pct = tot > 0 ? Math.round((sep / tot) * 100) : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-mata-escuro/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Separação de mercadorias"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onFechar();
      }}
    >
      <div className="w-full max-w-md animate-sobe rounded-xl2 bg-papel p-5 shadow-flutua">
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-mata-escuro">
              Separação de mercadorias
            </h2>
            <p className="mt-0.5 text-sm text-tinta-suave">
              Pedido nº {pedido.orixNumero || '—'} —{' '}
              {pedido.clienteNome || pedido.clienteCodigo}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${
              completa
                ? 'bg-mata-claro text-mata-escuro'
                : 'bg-trigo-claro text-trigo-escuro'
            }`}
          >
            {sep}/{tot}
          </span>
        </div>

        {/* Progresso */}
        <div className="mb-4 mt-3 h-2 w-full overflow-hidden rounded-full bg-creme-100">
          <div
            className={`h-full rounded-full transition-all ${
              completa ? 'bg-folha' : 'bg-trigo'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Lista de itens */}
        <ul className="scroll-suave max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {pedido.itens.length === 0 ? (
            <li className="rounded-lg bg-creme-50 px-3 py-4 text-center text-sm text-tinta-suave">
              Este pedido não tem itens cadastrados.
            </li>
          ) : (
            pedido.itens.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={enviando}
                  onClick={() => onToggle(item.id, !item.separado)}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition disabled:opacity-60 ${
                    item.separado
                      ? 'border-folha/40 bg-folha-claro/60'
                      : 'border-linha bg-creme-50 hover:border-folha/40'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                      item.separado
                        ? 'border-mata bg-mata text-creme-50'
                        : 'border-pedra bg-papel text-transparent'
                    }`}
                  >
                    <IconeCheck />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-sm font-medium ${
                        item.separado ? 'text-mata-escuro' : 'text-tinta'
                      }`}
                    >
                      {item.nomeProduto || item.produtoCodigo || 'Item'}
                    </span>
                    {item.qtd > 0 && (
                      <span className="text-[11px] text-tinta-suave">
                        Qtd: {item.qtd}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>

        {erro && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-terra/30 bg-terra-claro px-3 py-2 text-sm text-terra-escuro"
          >
            {erro}
          </div>
        )}

        {completa ? (
          <p className="mt-4 rounded-lg bg-mata-claro px-3 py-2.5 text-sm font-medium text-mata-escuro">
            ✓ Tudo separado — o pedido já pode ser posto em rota.
          </p>
        ) : (
          <p className="mt-4 rounded-lg bg-trigo-claro px-3 py-2.5 text-sm text-trigo-escuro">
            Marque todos os itens para liberar o pedido para a rota.
          </p>
        )}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onFechar}
            disabled={enviando}
            className="rounded-lg border border-linha px-4 py-2 text-sm font-semibold text-tinta-suave transition hover:bg-creme-50 disabled:opacity-60"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
