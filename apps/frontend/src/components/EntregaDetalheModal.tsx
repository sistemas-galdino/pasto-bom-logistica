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
// LEITURA É O PADRÃO; AÇÕES SÓ COM `comAcoes`. Nasceu somente leitura, e a
// /agenda continua assim: é tela de consulta, aberta para quem não mexe em
// entrega. A tela de Agendamento (logística) passa `comAcoes` e o detalhe ganha
// o rodapé com as ações da etapa — pedido da Natália, 24/09/2026: "essas
// funcionalidades aqui dos cards, tanto quando tá agendado quanto tá em rota,
// se a gente consegue pôr elas aqui para ter a mesma função, para eu não
// precisar vir aqui no quadro de pedido".
//
// As ações são as MESMAS do cartão do quadro, montadas da mesma máquina de
// estados (TRANSICOES_ENTREGA + reversoesDaEntrega) e com os mesmos rótulos
// (rotuloAcaoEntrega) e os mesmos sub-modais. Uma cópia com regra própria
// divergiria do quadro na primeira mudança de fluxo. Com UMA exceção decidida
// na reunião: "Separar" NÃO entra — separar é da tela de Separação, e quem
// separa pode não ser quem agenda.

import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, MapPin, Truck, User, X } from 'lucide-react';
import type { Entrega, PeriodoEntrega, StatusEntrega } from '@pastobom/shared';
import { TRANSICOES_ENTREGA, reversoesDaEntrega } from '@pastobom/shared';
import { api, ApiError } from '../lib/api';
import { invalidarAgendamento } from '../lib/cache';
import { emToneladas, formatarData, formatarQuantidade } from '../lib/format';
import {
  STATUS_ENTREGA_META,
  rotuloAcaoEntrega,
  textoConfirmacaoEntrega,
} from './status';
import { TagPedido } from './TagPedido';
import { ConfirmacaoModal } from './ConfirmacaoModal';
import { NaoRealizadoModal } from './NaoRealizadoModal';
import { ReagendarEntregaModal } from './ReagendarEntregaModal';
import { ConcluirEntregaModal, type ConclusaoEntrega } from './ConcluirEntregaModal';

const PERIODO_ROTULO: Record<PeriodoEntrega, string> = {
  manha: 'manhã',
  tarde: 'tarde',
};

interface Props {
  entregaId: string;
  onFechar: () => void;
  /** Mostra as ações da etapa (só a tela de Agendamento, só logística). */
  comAcoes?: boolean;
}

/**
 * Qual sub-modal está aberto POR CIMA do detalhe. Um estado só, e não quatro
 * booleanos: dois sub-modais abertos ao mesmo tempo não têm sentido, e com um
 * union isso nem é representável.
 *
 * `confirmar` cobre as transições que são só "tem certeza?" — pôr em rota,
 * desfazer e as reversões —, como o AlvoEntrega do quadro.
 */
type SubModal =
  | { tipo: 'confirmar'; para: StatusEntrega; reversao: boolean }
  | { tipo: 'concluir' }
  | { tipo: 'nao_realizado' }
  | { tipo: 'reagendar' };

/** A mesma extração de mensagem do quadro (Board.tsx). */
function mensagemDeErro(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export function EntregaDetalheModal({
  entregaId,
  onFechar,
  comAcoes = false,
}: Props): React.ReactElement {
  const queryClient = useQueryClient();
  const { data: entrega, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['entrega', entregaId],
    queryFn: ({ signal }) => api.obterEntrega(entregaId, signal),
    staleTime: 30_000,
  });

  const [sub, setSub] = React.useState<SubModal | null>(null);
  const [erroSub, setErroSub] = React.useState<string | null>(null);

  function abrirSub(s: SubModal): void {
    setErroSub(null);
    setSub(s);
  }

  /**
   * Depois de qualquer ação: as quatro chaves da agenda (lib/cache.ts) e o
   * próprio detalhe, que tem chave própria e ficaria mostrando o estado velho.
   *
   * `fecharDetalhe` quando o card SAI da agenda — ela só mostra agendada e em
   * rota, então depois de entregue, não realizado ou desfeito o detalhe
   * apontaria para um card que já não está na tela. Voltar, reagendar e pôr em
   * rota mantêm o card na agenda: o detalhe fica aberto mostrando o estado novo,
   * que é a confirmação visual de que deu certo.
   */
  function aposSucesso(fecharDetalhe: boolean): void {
    invalidarAgendamento(queryClient);
    void queryClient.invalidateQueries({ queryKey: ['entrega', entregaId] });
    setSub(null);
    setErroSub(null);
    if (fecharDetalhe) onFechar();
  }

  const transicaoMutacao = useMutation({
    mutationFn: ({
      id,
      para,
      reversao,
    }: {
      id: string;
      para: StatusEntrega;
      reversao: boolean;
    }) =>
      reversao
        ? api.reverterEntrega(id, para)
        : api.transicionarEntrega(id, { para }),
    onSuccess: (_d, v) => aposSucesso(!v.reversao && v.para === 'cancelada'),
    onError: (err) =>
      setErroSub(mensagemDeErro(err, 'Falha ao atualizar a entrega.')),
  });

  const concluirMutacao = useMutation({
    mutationFn: ({ id, conclusao }: { id: string; conclusao: ConclusaoEntrega }) =>
      api.transicionarEntrega(id, { para: 'entregue', ...conclusao }),
    onSuccess: () => aposSucesso(true),
    onError: (err) =>
      setErroSub(mensagemDeErro(err, 'Falha ao marcar a entrega como entregue.')),
  });

  const naoRealizadoMutacao = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      api.transicionarEntrega(id, { para: 'nao_realizado', motivo }),
    onSuccess: () => aposSucesso(true),
    onError: (err) =>
      setErroSub(
        mensagemDeErro(err, 'Falha ao marcar a entrega como não realizada.'),
      ),
  });

  const reagendarMutacao = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Parameters<typeof api.reagendarEntrega>[1];
    }) => api.reagendarEntrega(id, body),
    onSuccess: () => aposSucesso(false),
    onError: (err) =>
      setErroSub(mensagemDeErro(err, 'Falha ao reagendar a entrega.')),
  });

  const enviando =
    transicaoMutacao.isPending ||
    concluirMutacao.isPending ||
    naoRealizadoMutacao.isPending ||
    reagendarMutacao.isPending;

  /** Fecha o sub-modal — nunca no meio de um envio, como no quadro. */
  function fecharSub(): void {
    if (enviando) return;
    setSub(null);
    setErroSub(null);
  }

  /** Fecha o detalhe — só sem sub-modal por cima e sem envio pendente. */
  function tentarFechar(): void {
    if (enviando || sub !== null) return;
    onFechar();
  }

  // Esc e trava de scroll em efeitos SEPARADOS. O Esc precisa enxergar o
  // sub-modal e o envio atuais; se ele morasse no mesmo efeito da trava, cada
  // mudança de estado desfaria e refaria o overflow — e, com o Reagendar (que
  // também trava o scroll) montado por cima, a ordem das restaurações deixaria
  // o corpo rolando atrás de dois modais. O ref dá ao listener a versão mais
  // nova do handler sem re-registrar nada.
  //
  // Com sub-modal aberto, o Esc fecha SÓ o sub-modal (o Reagendar já faz isso
  // sozinho; fechar de novo é idempotente). Sem esta regra, um Esc para
  // desistir de "Não realizado" derrubaria o detalhe inteiro junto.
  const aoEsc = React.useRef<() => void>(() => undefined);
  aoEsc.current = () => {
    if (sub !== null) fecharSub();
    else tentarFechar();
  };

  React.useEffect(() => {
    function aoTeclar(e: KeyboardEvent): void {
      if (e.key === 'Escape') aoEsc.current();
    }
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, []);

  React.useEffect(() => {
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflowAnterior;
    };
  }, []);

  const meta = entrega ? STATUS_ENTREGA_META[entrega.status] : null;
  const local = entrega
    ? [entrega.bairro, entrega.cidadeCliente]
        .filter((p) => p && p.trim().length > 0)
        .join(' · ')
    : '';
  const mostrarSeparacao = entrega?.status === 'agendada';

  // Mesma conta do EntregaCard para travar "Pôr em rota": sem a carga
  // conferida o backend recusa (422), e o botão já dizer isso é melhor do que a
  // pessoa clicar e tomar erro.
  const totalItens = entrega?.itens.length ?? 0;
  const separacaoCompleta =
    totalItens > 0 && (entrega?.itens.every((i) => i.separado) ?? false);

  const subtitulo = entrega
    ? `Pedido nº ${entrega.orixNumero || '—'} — ${entrega.clienteNome}`
    : '';

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-mata-escuro/30 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label="Produtos da entrega"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) tentarFechar();
        }}
      >
        <div className="max-h-[85vh] w-full max-w-md overflow-y-auto animate-sobe rounded-xl2 bg-papel p-5 shadow-flutua">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold leading-tight text-mata-escuro">
                {entrega?.clienteNome || 'Entrega'}
              </h2>
              {entrega && (
                // A tag no lugar do "nº" em texto: é a mesma do card, e é ela
                // que fica amarela quando o pedido já teve entrega parcial —
                // o detalhe não pode esconder o que o card mostra.
                <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-tinta-suave">
                  <TagPedido
                    numero={entrega.orixNumero}
                    parcial={entrega.pedidoParcial}
                  />
                  <span>
                    {formatarData(entrega.dataAgendada)}
                    {entrega.periodo
                      ? ` · ${PERIODO_ROTULO[entrega.periodo]}`
                      : ''}
                  </span>
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={tentarFechar}
              disabled={enviando}
              autoFocus
              aria-label="Fechar"
              className="shrink-0 rounded-lg border border-linha p-1.5 text-tinta-suave transition hover:border-mata/30 hover:text-mata disabled:cursor-not-allowed disabled:opacity-50"
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

                {/* O card do restante recusado não é uma viagem: é a metade
                    que o cliente não quis de outra, e sem esta linha ele se
                    lê como "não realizado" comum — carga que ainda precisaria
                    ser reagendada, quando na verdade o saldo foi encerrado. */}
                {entrega.encerraSaldo && (
                  <p className="mb-1.5 rounded-lg border border-trigo/40 bg-trigo-claro/50 px-2.5 py-1.5 text-xs text-trigo-escuro">
                    Restante recusado pelo cliente numa entrega parcial. Não
                    volta para a fila do pedido.
                  </p>
                )}

                {entrega.itens.length === 0 ? (
                  <p className="py-4 text-center text-sm text-tinta-suave">
                    Esta viagem não tem itens.
                  </p>
                ) : (
                  <ul className="divide-y divide-linha/70 rounded-xl border border-linha">
                    {entrega.itens.map((item) => {
                      // Entrega parcial declarada: "20 de 40" — o que o cliente
                      // recebeu, do que foi carregado. Só em `entregue`: antes
                      // disso qtdEntregue é sempre null, e null vale `qtd`.
                      const parcial =
                        entrega.status === 'entregue' &&
                        item.qtdEntregue !== null &&
                        item.qtdEntregue < item.qtd;
                      return (
                        <li
                          key={item.id}
                          className="flex items-start gap-2 px-3 py-2 text-sm"
                        >
                          {/* A quantidade primeiro, e em negrito: é o que se lê
                              antes do nome, na tela e no papel. */}
                          {parcial && item.qtdEntregue !== null ? (
                            <span
                              className="w-20 shrink-0 text-right font-bold text-trigo-escuro"
                              title="Entregue de carregado: o cliente recebeu menos do que foi na viagem."
                            >
                              {formatarQuantidade(item.qtdEntregue)}
                              <span className="font-normal"> de </span>
                              {formatarQuantidade(item.qtd)}
                            </span>
                          ) : (
                            <span className="w-16 shrink-0 text-right font-bold text-mata-escuro">
                              {formatarQuantidade(item.qtd)}
                            </span>
                          )}
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
                      );
                    })}
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

              {comAcoes && (
                <RodapeAcoes
                  entrega={entrega}
                  separacaoCompleta={separacaoCompleta}
                  desabilitado={enviando}
                  onAbrir={abrirSub}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Sub-modais DEPOIS do detalhe no DOM: mesmo z-50, então o último
          pintado fica por cima. Fora da div do detalhe para que o clique no
          fundo deles não seja lido como clique no fundo do detalhe. */}
      {entrega && sub?.tipo === 'confirmar' &&
        (() => {
          const t = textoConfirmacaoEntrega(entrega.status, sub.para, sub.reversao);
          return (
            <ConfirmacaoModal
              titulo={t.titulo}
              subtitulo={subtitulo}
              descricao={t.descricao}
              rotuloConfirmar={t.rotulo}
              perigo={t.perigo}
              enviando={transicaoMutacao.isPending}
              erro={erroSub}
              onCancelar={fecharSub}
              onConfirmar={() =>
                transicaoMutacao.mutate({
                  id: entrega.id,
                  para: sub.para,
                  reversao: sub.reversao,
                })
              }
            />
          );
        })()}

      {entrega && sub?.tipo === 'concluir' && (
        <ConcluirEntregaModal
          entrega={entrega}
          enviando={concluirMutacao.isPending}
          erro={erroSub}
          onCancelar={fecharSub}
          onConfirmar={(conclusao) =>
            concluirMutacao.mutate({ id: entrega.id, conclusao })
          }
        />
      )}

      {entrega && sub?.tipo === 'nao_realizado' && (
        <NaoRealizadoModal
          entrega={entrega}
          enviando={naoRealizadoMutacao.isPending}
          erro={erroSub}
          onCancelar={fecharSub}
          onConfirmar={(motivo) =>
            naoRealizadoMutacao.mutate({ id: entrega.id, motivo })
          }
        />
      )}

      {entrega && sub?.tipo === 'reagendar' && (
        <ReagendarEntregaModal
          entrega={entrega}
          enviando={reagendarMutacao.isPending}
          erro={erroSub}
          onFechar={fecharSub}
          onConfirmar={(body) =>
            reagendarMutacao.mutate({ id: entrega.id, body })
          }
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Rodapé de ações
// ---------------------------------------------------------------------------

interface RodapeProps {
  entrega: Entrega;
  separacaoCompleta: boolean;
  /** Uma ação está enviando: nenhum outro botão abre nada até ela voltar. */
  desabilitado: boolean;
  onAbrir: (s: SubModal) => void;
}

/**
 * Os botões da etapa, na mesma ordem e com os mesmos destaques do EntregaCard.
 *
 * Tudo sai da máquina de estados — nenhum status é testado para decidir SE um
 * botão existe, só para escolher QUAL sub-modal ele abre. Se amanhã a máquina
 * ganhar uma transição, ela aparece aqui com o rótulo de status.ts sem ninguém
 * lembrar deste arquivo.
 *
 * `reversoesDaEntrega`, e não REVERSOES_ENTREGA direto: o card do restante
 * recusado (encerraSaldo) não tem volta própria — desfaz-se pela viagem de
 * origem —, e a função é quem sabe disso.
 */
function RodapeAcoes({
  entrega,
  separacaoCompleta,
  desabilitado,
  onAbrir,
}: RodapeProps): React.ReactElement | null {
  const transicoes = TRANSICOES_ENTREGA[entrega.status];
  const reversoes = reversoesDaEntrega(entrega);
  // Reagendar não é transição (a viagem continua agendada), por isso é o único
  // botão ancorado num status. Mesmo critério do quadro.
  const podeReagendar = entrega.status === 'agendada';

  if (transicoes.length === 0 && reversoes.length === 0 && !podeReagendar) {
    return null;
  }

  const total = entrega.itens.length;
  const cls = {
    primario:
      'rounded-lg bg-mata px-2.5 py-1.5 text-xs font-bold text-creme-50 transition hover:bg-mata-escuro disabled:cursor-not-allowed disabled:opacity-50',
    neutro:
      'rounded-lg border border-linha px-2.5 py-1.5 text-xs font-semibold text-tinta-suave transition hover:border-mata/30 hover:text-mata disabled:cursor-not-allowed disabled:opacity-50',
    perigo:
      'rounded-lg border border-brasa/40 px-2.5 py-1.5 text-xs font-semibold text-brasa transition hover:bg-brasa-claro disabled:cursor-not-allowed disabled:opacity-50',
    recuo:
      'rounded-lg border border-linha px-2.5 py-1.5 text-xs font-semibold text-tinta-suave transition hover:border-terra/40 hover:text-terra-escuro disabled:cursor-not-allowed disabled:opacity-50',
  };

  // Avanços primeiro, depois "Não realizado", Reagendar, Desfazer e Voltar —
  // a ordem do cartão do quadro, para a mão ir no mesmo lugar nas duas telas.
  const avancos = transicoes.filter(
    (p) => p !== 'nao_realizado' && p !== 'cancelada',
  );

  return (
    <div className="mt-4 flex flex-wrap gap-1.5 border-t border-linha/70 pt-3">
      {avancos.map((para) => {
        const travadoPorSeparacao =
          para === 'em_rota' && total > 0 && !separacaoCompleta;
        return (
          <button
            key={para}
            type="button"
            disabled={desabilitado || travadoPorSeparacao}
            title={
              travadoPorSeparacao
                ? 'Conclua a separação para liberar a saída.'
                : undefined
            }
            onClick={() =>
              // Entregue abre o formulário de conclusão (quanto foi entregue,
              // se o cliente quer o restante); o resto é só confirmação.
              onAbrir(
                para === 'entregue'
                  ? { tipo: 'concluir' }
                  : { tipo: 'confirmar', para, reversao: false },
              )
            }
            className={cls.primario}
          >
            {rotuloAcaoEntrega(entrega.status, para)}
          </button>
        );
      })}

      {transicoes.includes('nao_realizado') && (
        <button
          type="button"
          disabled={desabilitado}
          onClick={() => onAbrir({ tipo: 'nao_realizado' })}
          className={cls.perigo}
        >
          {rotuloAcaoEntrega(entrega.status, 'nao_realizado')}
        </button>
      )}

      {podeReagendar && (
        <button
          type="button"
          disabled={desabilitado}
          onClick={() => onAbrir({ tipo: 'reagendar' })}
          title="Muda data, período, motorista ou caminhão. A separação é mantida."
          className={cls.neutro}
        >
          Reagendar
        </button>
      )}

      {transicoes.includes('cancelada') && (
        <button
          type="button"
          disabled={desabilitado}
          onClick={() =>
            onAbrir({ tipo: 'confirmar', para: 'cancelada', reversao: false })
          }
          title="Desfaz o agendamento: a carga volta para a fila e a vaga do caminhão é liberada."
          className={cls.recuo}
        >
          {rotuloAcaoEntrega(entrega.status, 'cancelada')}
        </button>
      )}

      {reversoes.map((para) => (
        <button
          key={`rev-${para}`}
          type="button"
          disabled={desabilitado}
          onClick={() => onAbrir({ tipo: 'confirmar', para, reversao: true })}
          className={cls.neutro}
        >
          Voltar
        </button>
      ))}
    </div>
  );
}
