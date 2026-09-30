// Concluir uma viagem declarando o que o cliente de fato recebeu — documento
// "parte 3" da Natália e reunião de 24/09/2026 (migração 0025).
//
// O caso que motivou: levou 40, o cliente aceitou 20. Antes, a única saída era
// "não realizado", que marcava os 40 como rejeitados; e marcar entregue consumia
// os 40, fazendo os 20 que voltaram sumirem do sistema.
//
// Um formulário só, três chamadores: o Quadro, o detalhe do card na agenda e a
// Rota do Dia do motorista. Três cópias desta tela divergiriam na primeira
// correção.
//
// O fluxo de todo dia não paga pelo caso raro: as quantidades vêm preenchidas
// com o carregado, e sem divergência não aparece pergunta nenhuma — é um botão.
// Havendo diferença, a pergunta dela: "o cliente deseja o restante?", com a
// consequência escrita embaixo de cada resposta.
//
// A conta (o que é divergência, o que é inválido, quanto volta) mora em
// `avaliarConclusao`, a mesma função que o servidor usa para recusar.

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { avaliarConclusao, type Entrega } from '@pastobom/shared';

import { api } from '../lib/api';
import { formatarQuantidade } from '../lib/format';

/** Motivo semeado pela 0025 — o padrão do card do restante recusado. */
const MOTIVO_PADRAO = 'Cliente recusou o restante';

export interface ConclusaoEntrega {
  entregues: Record<string, number>;
  /** Só com divergência: true = o cliente não quer o restante. */
  restanteRecusado?: boolean;
  motivoRecusa?: string;
  observacao?: string;
}

interface Props {
  entrega: Entrega;
  enviando: boolean;
  erro: string | null;
  onConfirmar: (conclusao: ConclusaoEntrega) => void;
  onCancelar: () => void;
  /** Frase sobre o aviso ao cliente, quando a tela quiser dizê-la. */
  aviso?: string;
}

/** "12,5" -> 12.5; vazio -> null (a regra trata como "não declarado"). */
function lerQuantidade(texto: string): number | null {
  const limpo = texto.trim().replace(/\s/g, '').replace(',', '.');
  if (limpo === '') return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function ConcluirEntregaModal({
  entrega,
  enviando,
  erro,
  onConfirmar,
  onCancelar,
  aviso,
}: Props): React.ReactElement {
  const [textos, setTextos] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      entrega.itens.map((i) => [i.produtoCodigo, formatarQuantidade(i.qtd)]),
    ),
  );
  const [querRestante, setQuerRestante] = useState<boolean | null>(null);
  const [motivo, setMotivo] = useState('');
  const [observacao, setObservacao] = useState('');

  const declarado = useMemo(() => {
    const r: Record<string, number | null> = {};
    for (const [codigo, texto] of Object.entries(textos)) {
      r[codigo] = lerQuantidade(texto);
    }
    return r;
  }, [textos]);

  const avaliacao = useMemo(
    () => avaliarConclusao(entrega.itens, declarado),
    [entrega.itens, declarado],
  );
  const erroPorProduto = new Map(
    avaliacao.erros.map((e) => [e.produtoCodigo, e.mensagem]),
  );

  const motivosQuery = useQuery({
    queryKey: ['motivos'],
    queryFn: ({ signal }) => api.listarMotivos(false, signal),
    staleTime: 5 * 60_000,
    enabled: avaliacao.divergiu && querRestante === false,
  });
  const motivos = motivosQuery.data ?? [];
  const motivoEscolhido =
    motivo || (motivos.some((m) => m.descricao === MOTIVO_PADRAO) ? MOTIVO_PADRAO : '');

  const totalRestante = avaliacao.restante.reduce((s, r) => s + r.qtd, 0);
  const podeConfirmar =
    !enviando &&
    avaliacao.erros.length === 0 &&
    (!avaliacao.divergiu || querRestante !== null);

  function confirmar(): void {
    if (!podeConfirmar) return;
    onConfirmar({
      entregues: avaliacao.entregues,
      restanteRecusado: avaliacao.divergiu ? querRestante === false : undefined,
      motivoRecusa:
        avaliacao.divergiu && querRestante === false && motivoEscolhido
          ? motivoEscolhido
          : undefined,
      observacao: observacao.trim() || undefined,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-mata-escuro/30 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Marcar como entregue"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onCancelar();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-lg animate-sobe flex-col rounded-t-xl2 bg-papel shadow-flutua sm:rounded-xl2">
        <div className="border-b border-linha px-5 pb-3 pt-5">
          <h2 className="font-display text-lg font-semibold text-mata-escuro">
            Marcar como entregue
          </h2>
          <p className="mt-0.5 text-sm text-tinta-suave">
            Pedido nº {entrega.orixNumero || '—'} —{' '}
            {entrega.clienteNome || entrega.clienteCodigo}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-sm font-semibold text-tinta">
            Quanto o cliente recebeu?
          </p>
          <p className="mt-0.5 text-xs text-tinta-suave">
            Já vem com o que foi carregado. Só mude se o cliente recebeu menos.
          </p>

          <ul className="mt-3 space-y-2">
            {entrega.itens.map((item) => {
              const erroItem = erroPorProduto.get(item.produtoCodigo);
              const entregue = avaliacao.entregues[item.produtoCodigo];
              const menos =
                !erroItem && entregue !== undefined && entregue < item.qtd;
              const idInput = `qtd-entregue-${item.produtoCodigo}`;
              return (
                <li
                  key={item.id}
                  className={`rounded-lg border px-3 py-2 ${
                    erroItem
                      ? 'border-terra/40 bg-terra-claro/40'
                      : menos
                        ? 'border-trigo/50 bg-trigo-claro/40'
                        : 'border-linha'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <label htmlFor={idInput} className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-tinta">
                        {item.nomeProduto || item.produtoCodigo}
                      </span>
                      <span className="text-[11px] text-tinta-suave">
                        Carregado: {formatarQuantidade(item.qtd)}
                      </span>
                    </label>
                    <input
                      id={idInput}
                      inputMode="decimal"
                      value={textos[item.produtoCodigo] ?? ''}
                      onChange={(e) =>
                        setTextos((t) => ({
                          ...t,
                          [item.produtoCodigo]: e.target.value,
                        }))
                      }
                      disabled={enviando}
                      aria-invalid={erroItem ? true : undefined}
                      className="w-24 rounded-lg border border-linha bg-creme-50 px-2 py-1.5 text-right text-sm font-semibold tabular-nums text-tinta outline-none transition focus:border-mata/40 focus:bg-papel"
                    />
                  </div>
                  {erroItem && (
                    <p className="mt-1 text-[11px] text-terra-escuro">{erroItem}</p>
                  )}
                  {menos && entregue !== undefined && (
                    <p className="mt-1 text-[11px] text-trigo-escuro">
                      Voltam {formatarQuantidade(item.qtd - entregue)} no caminhão.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {avaliacao.divergiu && (
            <fieldset className="mt-4">
              <legend className="text-sm font-semibold text-tinta">
                O cliente deseja o restante da mercadoria?
              </legend>
              <div className="mt-2 space-y-2">
                <label
                  className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 ${
                    querRestante === true ? 'border-mata/50 bg-mata-claro/40' : 'border-linha'
                  }`}
                >
                  <input
                    type="radio"
                    name="quer-restante"
                    checked={querRestante === true}
                    onChange={() => setQuerRestante(true)}
                    disabled={enviando}
                    className="mt-1 accent-mata"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-tinta">
                      Sim, quer o restante
                    </span>
                    <span className="text-xs text-tinta-suave">
                      {formatarQuantidade(totalRestante)} voltam para o pedido e
                      podem ser agendados de novo.
                    </span>
                  </span>
                </label>
                <label
                  className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 ${
                    querRestante === false ? 'border-brasa/40 bg-brasa-claro/40' : 'border-linha'
                  }`}
                >
                  <input
                    type="radio"
                    name="quer-restante"
                    checked={querRestante === false}
                    onChange={() => setQuerRestante(false)}
                    disabled={enviando}
                    className="mt-1 accent-brasa"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-tinta">
                      Não quer mais
                    </span>
                    <span className="text-xs text-tinta-suave">
                      O pedido é encerrado, e os {formatarQuantidade(totalRestante)}{' '}
                      ficam registrados como não realizados.
                    </span>
                  </span>
                </label>
              </div>

              {querRestante === false && (
                <div className="mt-3">
                  <label
                    htmlFor="motivo-recusa"
                    className="text-xs font-semibold text-tinta"
                  >
                    Motivo da recusa
                  </label>
                  <select
                    id="motivo-recusa"
                    value={motivoEscolhido}
                    onChange={(e) => setMotivo(e.target.value)}
                    disabled={enviando || motivosQuery.isLoading}
                    className="mt-1 w-full rounded-lg border border-linha bg-creme-50 px-3 py-2 text-sm text-tinta outline-none transition focus:border-mata/40 focus:bg-papel"
                  >
                    {motivoEscolhido === '' && (
                      <option value="">
                        {motivosQuery.isLoading ? 'Carregando motivos…' : 'Escolha o motivo…'}
                      </option>
                    )}
                    {motivos.map((m) => (
                      <option key={m.id} value={m.descricao}>
                        {m.descricao}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </fieldset>
          )}

          <div className="mt-4">
            <label
              htmlFor="obs-conclusao"
              className="text-xs font-semibold text-tinta"
            >
              Observação <span className="font-normal text-pedra">(opcional)</span>
            </label>
            <textarea
              id="obs-conclusao"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
              maxLength={2000}
              disabled={enviando}
              className="mt-1 w-full resize-none rounded-lg border border-linha bg-creme-50 px-3 py-2 text-sm text-tinta outline-none transition focus:border-mata/40 focus:bg-papel"
            />
          </div>

          {aviso && <p className="mt-3 text-xs text-tinta-suave">{aviso}</p>}

          {erro && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-terra/30 bg-terra-claro px-3 py-2 text-sm text-terra-escuro"
            >
              {erro}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-linha px-5 py-3">
          <button
            type="button"
            onClick={onCancelar}
            disabled={enviando}
            className="rounded-lg border border-linha px-4 py-2 text-sm font-semibold text-tinta-suave transition hover:bg-creme-50 disabled:opacity-60"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={!podeConfirmar}
            className="rounded-lg bg-mata px-4 py-2 text-sm font-bold text-creme-50 transition hover:bg-mata-escuro disabled:cursor-not-allowed disabled:opacity-60"
          >
            {enviando
              ? 'Registrando…'
              : avaliacao.divergiu
                ? 'Registrar entrega parcial'
                : 'Marcar entregue'}
          </button>
        </div>
      </div>
    </div>
  );
}
