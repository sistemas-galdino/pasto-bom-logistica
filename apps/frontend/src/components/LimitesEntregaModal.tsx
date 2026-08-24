// Limite de ENTREGAS por dia de um caminhão, por janela de vigência.
//
// A tonelagem (capacidade em kg do caminhão) continua valendo e não é tocada
// aqui: as duas regras são checadas juntas no agendamento. Esta tela só
// cadastra o TETO DE QUANTIDADE — "esse caminhão faz no máximo 5 entregas por
// dia entre 01/09 e 30/09".
//
// SEM nenhuma janela cadastrada não existe teto de quantidade: o caminhão segue
// limitado só pela tonelagem, como sempre foi. Nenhum default é inventado, e a
// tela diz isso em voz alta — do contrário a operação acharia que existe um
// limite padrão escondido.

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, Trash2, X } from 'lucide-react';
import type { Caminhao, LimiteEntregasCaminhao } from '@pastobom/shared';
import { limiteVigente } from '@pastobom/shared';
import { api, ApiError } from '../lib/api';
import { formatarData } from '../lib/format';

interface Props {
  caminhao: Caminhao;
  onFechar: () => void;
}

function mensagemDeErro(err: unknown, fallback: string): string {
  // O servidor manda mensagem pronta (o 409 de janela sobreposta já explica o
  // que fazer), e a ApiError a carrega. Só cai no fallback quem não tem nada.
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

/** 'YYYY-MM-DD' de hoje em horário LOCAL — nunca via toISOString (fuso). */
function hojeISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** "01/09/2026 – 30/09/2026" ou "01/09/2026 em diante" (vigência aberta). */
function rotuloPeriodo(limite: LimiteEntregasCaminhao): string {
  const inicio = formatarData(limite.validoDe);
  if (limite.validoAte === null) return `${inicio} em diante`;
  return `${inicio} – ${formatarData(limite.validoAte)}`;
}

function rotuloTeto(max: number): string {
  return max === 1 ? 'máx. 1 entrega/dia' : `máx. ${max} entregas/dia`;
}

/** Aceita só inteiro positivo; devolve null quando não serve como teto. */
function lerMaxEntregas(texto: string): number | null {
  const limpo = texto.trim();
  if (limpo.length === 0) return null;
  const n = Number(limpo);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function LimitesEntregaModal({
  caminhao,
  onFechar,
}: Props): React.ReactElement {
  const queryClient = useQueryClient();
  const chaveLimites = ['caminhoes', caminhao.id, 'limites'] as const;

  const [validoDe, setValidoDe] = useState('');
  const [validoAte, setValidoAte] = useState('');
  const [maxEntregas, setMaxEntregas] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [erroForm, setErroForm] = useState<string | null>(null);
  // Remover é destrutivo e a linha é pequena: confirma na própria linha em vez
  // de abrir um segundo modal em cima deste.
  const [confirmandoRemocao, setConfirmandoRemocao] = useState<string | null>(
    null,
  );

  const limitesQuery = useQuery({
    queryKey: chaveLimites,
    queryFn: ({ signal }) => api.limitesDoCaminhao(caminhao.id, signal),
  });

  function invalidar() {
    void queryClient.invalidateQueries({ queryKey: chaveLimites });
    // A agenda decide o que cabe no dia com base nessas janelas; depois de
    // mexer no teto, o que ela tem em cache está velho.
    void queryClient.invalidateQueries({ queryKey: ['caminhoes'] });
  }

  const criar = useMutation({
    mutationFn: (body: {
      validoDe: string;
      validoAte?: string | null;
      maxEntregasDia: number;
      observacoes?: string;
    }) => api.criarLimiteCaminhao(caminhao.id, body),
    onSuccess: () => {
      setValidoDe('');
      setValidoAte('');
      setMaxEntregas('');
      setObservacoes('');
      setErroForm(null);
      invalidar();
    },
  });

  const remover = useMutation({
    mutationFn: (limiteId: string) =>
      api.removerLimiteCaminhao(caminhao.id, limiteId),
    onSuccess: () => {
      setConfirmandoRemocao(null);
      invalidar();
    },
  });

  const limites = limitesQuery.data ?? [];
  const hoje = hojeISO();
  // Quem escolhe a janela válida numa data é a regra compartilhada — a tela só
  // marca visualmente o que ela apontou. Ela devolve o PRÓPRIO item da lista,
  // então dá para comparar por identidade (o tipo dela não tem `id`).
  const vigente = limiteVigente(limites, hoje);

  const enviando = criar.isPending;
  const erroCriar = criar.isError
    ? mensagemDeErro(criar.error, 'Falha ao cadastrar o limite.')
    : null;
  const erroRemover = remover.isError
    ? mensagemDeErro(remover.error, 'Falha ao remover o limite.')
    : null;

  function aoSubmeter(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;

    if (validoDe.length === 0) {
      setErroForm('Informe a data inicial da vigência.');
      return;
    }
    if (validoAte.length > 0 && validoAte < validoDe) {
      setErroForm('A data final não pode ser anterior à inicial.');
      return;
    }
    const max = lerMaxEntregas(maxEntregas);
    if (max === null) {
      setErroForm('Informe o máximo de entregas por dia (inteiro maior que zero).');
      return;
    }
    setErroForm(null);

    const obs = observacoes.trim();
    criar.mutate({
      validoDe,
      validoAte: validoAte.length > 0 ? validoAte : null,
      maxEntregasDia: max,
      ...(obs.length > 0 ? { observacoes: obs } : {}),
    });
  }

  const inputCls =
    'w-full rounded-lg border border-linha bg-creme-50 px-3 py-2 text-sm text-tinta outline-none transition placeholder:text-pedra focus:border-folha focus:bg-papel focus:ring-2 focus:ring-folha/25';
  const rotuloCls =
    'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-tinta-suave';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-mata-escuro/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Limite de entregas por dia — ${caminhao.nome}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onFechar();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg animate-sobe overflow-y-auto scroll-suave rounded-xl2 bg-papel p-5 shadow-flutua">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-folha-claro text-mata">
              <CalendarClock className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-display text-lg font-semibold text-mata-escuro">
                Entregas por dia — {caminhao.nome}
              </h2>
              <p className="text-sm text-tinta-suave">
                Teto de quantidade por período. A capacidade em toneladas
                continua valendo junto.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onFechar}
            disabled={enviando}
            aria-label="Fechar"
            className="shrink-0 rounded-lg p-1.5 text-tinta-suave transition hover:bg-creme-50 hover:text-tinta disabled:opacity-60"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Decisão de produto: o passado não se reescreve. Trocar o teto não
            mexe em agendamento que já existe — só nos próximos. Quem opera
            precisa saber, senão vai esperar que o sistema "arrume" a agenda. */}
        <p className="flex items-start gap-2 rounded-lg border border-linha bg-creme-50 px-3 py-2.5 text-xs text-tinta-suave">
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-terra"
            aria-hidden="true"
          />
          <span>
            Mudar o limite <strong className="font-semibold">não desmarca</strong>{' '}
            agendamento que já existe. O novo teto vale para os próximos
            agendamentos.
          </span>
        </p>

        <div className="mt-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tinta-suave">
            Janelas cadastradas
          </h3>

          {limitesQuery.isLoading ? (
            <p className="py-4 text-center text-sm text-tinta-suave">
              Carregando limites…
            </p>
          ) : limitesQuery.isError ? (
            <div className="flex flex-col items-center gap-2 py-4 text-sm text-tinta-suave">
              <p>
                {mensagemDeErro(
                  limitesQuery.error,
                  'Não foi possível carregar os limites.',
                )}
              </p>
              <button
                type="button"
                onClick={() => void limitesQuery.refetch()}
                className="rounded-lg border border-linha bg-papel px-3 py-1.5 text-xs font-semibold text-tinta-suave hover:border-mata/30 hover:text-mata"
              >
                Tentar novamente
              </button>
            </div>
          ) : limites.length === 0 ? (
            <p className="rounded-lg border border-dashed border-linha px-3 py-4 text-center text-sm text-tinta-suave">
              Nenhuma janela cadastrada — este caminhão segue limitado{' '}
              <strong className="font-semibold text-tinta">
                só pela tonelagem
              </strong>
              . Não existe teto padrão de entregas por dia.
            </p>
          ) : (
            <ul className="space-y-2">
              {limites.map((l) => {
                const eVigente = vigente === l;
                const removendo =
                  remover.isPending && remover.variables === l.id;
                return (
                  <li
                    key={l.id}
                    className={`rounded-lg border px-3 py-2.5 ${
                      eVigente
                        ? 'border-mata/30 bg-mata-claro/50'
                        : 'border-linha bg-creme-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-tinta">
                          {rotuloPeriodo(l)}
                          {eVigente && (
                            <span className="rounded-full bg-mata px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-creme-50">
                              Vigente hoje
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 font-display text-sm font-semibold text-mata-escuro">
                          {rotuloTeto(l.maxEntregasDia)}
                        </p>
                        {l.observacoes && (
                          <p className="mt-0.5 text-xs text-tinta-suave">
                            {l.observacoes}
                          </p>
                        )}
                      </div>

                      {confirmandoRemocao === l.id ? (
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            disabled={removendo}
                            onClick={() => remover.mutate(l.id)}
                            className="rounded-lg border border-terra/30 px-2.5 py-1.5 text-xs font-semibold text-terra-escuro transition hover:bg-terra-claro disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {removendo ? '…' : 'Confirmar'}
                          </button>
                          <button
                            type="button"
                            disabled={removendo}
                            onClick={() => setConfirmandoRemocao(null)}
                            className="rounded-lg border border-linha px-2.5 py-1.5 text-xs font-semibold text-tinta-suave transition hover:bg-papel disabled:opacity-60"
                          >
                            Não
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            remover.reset();
                            setConfirmandoRemocao(l.id);
                          }}
                          aria-label={`Remover limite de ${rotuloPeriodo(l)}`}
                          className="shrink-0 rounded-lg border border-linha p-1.5 text-tinta-suave transition hover:border-terra/30 hover:text-terra-escuro"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {erroRemover && (
            <div
              role="alert"
              className="mt-2 rounded-lg border border-terra/30 bg-terra-claro px-3 py-2 text-sm text-terra-escuro"
            >
              {erroRemover}
            </div>
          )}
        </div>

        <form onSubmit={aoSubmeter} className="mt-5 border-t border-linha pt-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-tinta-suave">
            Nova janela
          </h3>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="limite-de" className={rotuloCls}>
                  Data inicial
                </label>
                <input
                  id="limite-de"
                  type="date"
                  required
                  value={validoDe}
                  onChange={(e) => setValidoDe(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="limite-ate" className={rotuloCls}>
                  Data final <span className="normal-case">(opcional)</span>
                </label>
                <input
                  id="limite-ate"
                  type="date"
                  min={validoDe.length > 0 ? validoDe : undefined}
                  value={validoAte}
                  onChange={(e) => setValidoAte(e.target.value)}
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-pedra">
                  Em branco = vale de lá em diante, sem data de fim.
                </p>
              </div>
            </div>

            <div>
              <label htmlFor="limite-max" className={rotuloCls}>
                Máximo de entregas por dia
              </label>
              <input
                id="limite-max"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                required
                value={maxEntregas}
                onChange={(e) => setMaxEntregas(e.target.value)}
                className={inputCls}
                placeholder="5"
              />
              <p className="mt-1 text-xs text-pedra">
                Conta o dia inteiro — manhã e tarde somadas.
              </p>
            </div>

            <div>
              <label htmlFor="limite-obs" className={rotuloCls}>
                Observação <span className="normal-case">(opcional)</span>
              </label>
              <input
                id="limite-obs"
                type="text"
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                className={inputCls}
                placeholder="Ex.: safra, motorista em treinamento"
              />
            </div>
          </div>

          {(erroForm ?? erroCriar) && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-terra/30 bg-terra-claro px-3 py-2 text-sm text-terra-escuro"
            >
              {erroForm ?? erroCriar}
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onFechar}
              disabled={enviando}
              className="rounded-lg border border-linha px-4 py-2 text-sm font-semibold text-tinta-suave transition hover:bg-creme-50 disabled:opacity-60"
            >
              Fechar
            </button>
            <button
              type="submit"
              disabled={enviando}
              className="rounded-lg bg-mata px-4 py-2 text-sm font-bold text-creme-50 transition hover:bg-mata-escuro disabled:cursor-not-allowed disabled:opacity-60"
            >
              {enviando ? 'Salvando…' : 'Adicionar janela'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
