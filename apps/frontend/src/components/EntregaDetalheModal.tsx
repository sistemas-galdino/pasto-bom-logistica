// Detalhe de uma viagem, aberto ao clicar num card da agenda.
//
// Pedido da Natália, textual: "ter a opção de clicar no card agendado ou em
// rota e ver os produtos da entrega e quantidade".
//
// Por que buscar sob demanda em vez de trazer os itens no payload da agenda:
// GET /api/entregas/:id já existe e devolve a viagem completa (itens, marcas de
// separação, peso congelado, observações). Enfiar os itens na resposta da
// agenda encareceria TODA navegação de mês — a janela chega a 92 dias e a visão
// de mês nem mostra produto. Aqui é uma chamada por clique, com cache.
//
// Somente leitura: a agenda é tela de consulta. Quem mexe na separação é o
// quadro e a tela de Separação.

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, MapPin, Truck, User, X } from 'lucide-react';
import type { PeriodoEntrega } from '@pastobom/shared';
import { api } from '../lib/api';
import { formatarData } from '../lib/format';
import { STATUS_ENTREGA_META } from './status';

const PERIODO_ROTULO: Record<PeriodoEntrega, string> = {
  manha: 'manhã',
  tarde: 'tarde',
};

interface Props {
  entregaId: string;
  onFechar: () => void;
}

function emToneladas(kg: number): string {
  return (kg / 1000).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** Quantidade sem decimal inútil: 100, não 100,00 — mas 2,5 continua 2,5. */
function formatarQtd(qtd: number): string {
  return qtd.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

export function EntregaDetalheModal({
  entregaId,
  onFechar,
}: Props): React.ReactElement {
  const { data: entrega, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['entrega', entregaId],
    queryFn: ({ signal }) => api.obterEntrega(entregaId, signal),
    staleTime: 30_000,
  });

  // Esc fecha, e o corpo para de rolar atrás do modal. Nenhum modal do sistema
  // fazia isto; começa aqui, sem mexer nos outros no mesmo commit.
  React.useEffect(() => {
    function aoTeclar(e: KeyboardEvent): void {
      if (e.key === 'Escape') onFechar();
    }
    document.addEventListener('keydown', aoTeclar);
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = overflowAnterior;
    };
  }, [onFechar]);

  const meta = entrega ? STATUS_ENTREGA_META[entrega.status] : null;
  const local = entrega
    ? [entrega.bairro, entrega.cidadeCliente]
        .filter((p) => p && p.trim().length > 0)
        .join(' · ')
    : '';
  const mostrarSeparacao = entrega?.status === 'agendada';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-mata-escuro/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Produtos da entrega"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onFechar();
      }}
    >
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto animate-sobe rounded-xl2 bg-papel p-5 shadow-flutua">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold leading-tight text-mata-escuro">
              {entrega?.clienteNome || 'Entrega'}
            </h2>
            {entrega && (
              <p className="mt-0.5 text-xs text-tinta-suave">
                nº {entrega.orixNumero || '—'} ·{' '}
                {formatarData(entrega.dataAgendada)}
                {entrega.periodo ? ` · ${PERIODO_ROTULO[entrega.periodo]}` : ''}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onFechar}
            autoFocus
            aria-label="Fechar"
            className="shrink-0 rounded-lg border border-linha p-1.5 text-tinta-suave transition hover:border-mata/30 hover:text-mata"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {isLoading && (
          <div className="space-y-2" aria-label="Carregando">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-8 animate-pulse rounded-lg bg-creme-100"
              />
            ))}
          </div>
        )}

        {isError && (
          <div className="rounded-xl border border-brasa/30 bg-brasa-claro/40 p-3">
            <p className="text-sm text-brasa-escuro">
              {error instanceof Error
                ? error.message
                : 'Não foi possível carregar esta entrega.'}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-2 rounded-lg border border-brasa/40 px-2.5 py-1.5 text-xs font-semibold text-brasa transition hover:bg-brasa-claro"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {entrega && meta && (
          <>
            <div className="space-y-1 rounded-xl border border-linha bg-creme-50/60 p-3 text-xs text-tinta-suave">
              <p className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 shrink-0 text-pedra" aria-hidden="true" />
                <span className="truncate">
                  {entrega.motoristaNome || 'Sem motorista'}
                </span>
              </p>
              <p className="flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5 shrink-0 text-pedra" aria-hidden="true" />
                <span className="truncate">{entrega.caminhaoNome || '—'}</span>
              </p>
              <p className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-pedra" aria-hidden="true" />
                <span className="truncate">{local || '—'}</span>
              </p>
            </div>

            <div className="mt-3">
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-tinta-suave">
                  Produtos desta viagem
                </h3>
                <span
                  className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${meta.badge}`}
                >
                  {meta.rotulo}
                </span>
              </div>

              {entrega.itens.length === 0 ? (
                <p className="py-4 text-center text-sm text-tinta-suave">
                  Esta viagem não tem itens.
                </p>
              ) : (
                <ul className="divide-y divide-linha/70 rounded-xl border border-linha">
                  {entrega.itens.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-start gap-2 px-3 py-2 text-sm"
                    >
                      {/* A quantidade primeiro, e em negrito: é o que se lê
                          antes do nome, na tela e no papel. */}
                      <span className="w-16 shrink-0 text-right font-bold text-mata-escuro">
                        {formatarQtd(item.qtd)}
                      </span>
                      <span className="min-w-0 flex-1 text-tinta">
                        {item.nomeProduto || item.produtoCodigo}
                      </span>
                      {mostrarSeparacao && item.separado && (
                        <Check
                          className="mt-0.5 h-4 w-4 shrink-0 text-mata"
                          aria-label="Separado"
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-2 flex items-baseline justify-between gap-2 text-xs">
                <span className="text-tinta-suave">
                  {entrega.itens.length === 1
                    ? '1 item'
                    : `${entrega.itens.length} itens`}
                </span>
                {entrega.pesoTotalKg === null ? (
                  <span className="font-semibold text-trigo-escuro">
                    peso pendente
                  </span>
                ) : (
                  <span className="font-semibold text-mata-escuro">
                    {emToneladas(entrega.pesoTotalKg)} t
                  </span>
                )}
              </div>
            </div>

            {entrega.motivoNaoEntrega && (
              <div className="mt-3 rounded-xl border border-brasa/30 bg-brasa-claro/40 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-brasa-escuro">
                  Motivo da não entrega
                </p>
                <p className="mt-0.5 text-sm text-brasa-escuro">
                  {entrega.motivoNaoEntrega}
                </p>
              </div>
            )}

            {entrega.observacoes && (
              <div className="mt-3 rounded-xl border border-linha bg-creme-50/60 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-tinta-suave">
                  Observações
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-tinta">
                  {entrega.observacoes}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
