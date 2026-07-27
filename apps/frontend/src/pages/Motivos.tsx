// Página de MOTIVOS DE NÃO ENTREGA (somente logística).
//
// É a lista fechada que o modal de "entrega não realizada" oferece. A reunião de
// 16/07/2026 decidiu centralizar o cadastro aqui: com cada pessoa digitando o
// motivo à mão, nascem cinco jeitos de escrever "cliente ausente" e o filtro por
// motivo deixa de servir para qualquer coisa.
//
// Não existe excluir: desativar tira o motivo da lista de escolha e preserva o
// histórico do que já foi registrado com ele.

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, X } from 'lucide-react';
import type { MotivoNaoEntrega } from '@pastobom/shared';
import { api, ApiError } from '../lib/api';

function mensagemDeErro(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export default function Motivos(): React.ReactElement {
  const queryClient = useQueryClient();
  const [modalAberto, setModalAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<MotivoNaoEntrega | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  // `todos` = inclui desativados; é a visão do administrador (precisa poder
  // reativar). O modal de não entrega usa a mesma rota sem o parâmetro.
  const motivosQuery = useQuery({
    queryKey: ['motivos', 'todos'],
    queryFn: ({ signal }) => api.listarMotivos(true, signal),
  });

  /** Invalida TODAS as listas de motivo — inclusive a que o modal usa. */
  function aoSalvar(): void {
    setErroAcao(null);
    void queryClient.invalidateQueries({ queryKey: ['motivos'] });
  }

  const statusMutacao = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      api.atualizarMotivo(id, { ativo }),
    onSuccess: aoSalvar,
    onError: (err) =>
      setErroAcao(mensagemDeErro(err, 'Falha ao alterar o motivo.')),
  });

  const ordemMutacao = useMutation({
    mutationFn: ({ id, ordem }: { id: string; ordem: number }) =>
      api.atualizarMotivo(id, { ordem }),
    onSuccess: aoSalvar,
    onError: (err) =>
      setErroAcao(mensagemDeErro(err, 'Falha ao reordenar os motivos.')),
  });

  const motivos = motivosQuery.data ?? [];
  const ativos = motivos.filter((m) => m.ativo);

  if (motivosQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-tinta-suave">
        Carregando motivos…
      </div>
    );
  }

  if (motivosQuery.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-tinta-suave">
        <p>
          {motivosQuery.error instanceof Error
            ? motivosQuery.error.message
            : 'Não foi possível carregar os motivos.'}
        </p>
        <button
          type="button"
          onClick={() => void motivosQuery.refetch()}
          className="rounded-lg border border-linha bg-papel px-3 py-1.5 text-xs font-semibold text-tinta-suave hover:border-mata/30 hover:text-mata"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  function abrirNovo(): void {
    setErroAcao(null);
    setEmEdicao(null);
    setModalAberto(true);
  }

  function abrirEdicao(motivo: MotivoNaoEntrega): void {
    setErroAcao(null);
    setEmEdicao(motivo);
    setModalAberto(true);
  }

  /**
   * Troca a posição de dois motivos na lista. Manda as DUAS ordens (a do
   * vizinho também), senão dois motivos empatariam no mesmo número e a ordem
   * dependeria do desempate por descrição.
   */
  function mover(indice: number, direcao: -1 | 1): void {
    const atual = motivos[indice];
    const vizinho = motivos[indice + direcao];
    if (!atual || !vizinho) return;
    setErroAcao(null);
    ordemMutacao.mutate({ id: atual.id, ordem: vizinho.ordem });
    ordemMutacao.mutate({ id: vizinho.id, ordem: atual.ordem });
  }

  return (
    <div className="h-full overflow-y-auto scroll-suave">
      <div className="mx-auto max-w-4xl space-y-5 p-4 animate-sobe sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-tinta-suave">
            {ativos.length === 1
              ? '1 motivo disponível'
              : `${ativos.length} motivos disponíveis`}
            {motivos.length > ativos.length && (
              <> · {motivos.length - ativos.length} desativado(s)</>
            )}
          </p>
          <button
            type="button"
            onClick={abrirNovo}
            className="flex items-center gap-2 rounded-lg bg-mata px-4 py-2 text-sm font-bold text-creme-50 shadow-sm transition hover:bg-mata-escuro"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Novo motivo
          </button>
        </div>

        <p className="rounded-xl2 border border-linha bg-creme-50/70 px-4 py-3 text-sm text-tinta-suave">
          Estes são os motivos que aparecem quando uma entrega é marcada como{' '}
          <strong className="text-tinta">não realizada</strong>. Quem registra
          escolhe da lista — não digita. É isso que permite, depois, filtrar as
          entregas por motivo.
        </p>

        {erroAcao && (
          <div
            role="alert"
            className="flex items-start justify-between gap-3 rounded-lg border border-terra/30 bg-terra-claro px-3 py-2.5 text-sm text-terra-escuro"
          >
            <span>{erroAcao}</span>
            <button
              type="button"
              onClick={() => setErroAcao(null)}
              aria-label="Fechar erro"
              className="shrink-0 rounded p-0.5 text-terra-escuro/70 hover:text-terra-escuro"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {motivos.length === 0 ? (
          <p className="py-16 text-center text-sm text-tinta-suave">
            Nenhum motivo cadastrado. Sem pelo menos um, ninguém consegue
            registrar uma entrega não realizada.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl2 border border-linha bg-papel shadow-carta">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-linha text-[11px] font-semibold uppercase tracking-wide text-tinta-suave">
                  <th className="px-4 py-3">Motivo</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {motivos.map((m, i) => {
                  const ocupado =
                    (statusMutacao.isPending &&
                      statusMutacao.variables?.id === m.id) ||
                    ordemMutacao.isPending;
                  return (
                    <tr
                      key={m.id}
                      className="border-b border-linha/70 last:border-0 hover:bg-creme-50/60"
                    >
                      <td className="px-4 py-3">
                        <span
                          className={`font-medium ${
                            m.ativo ? 'text-tinta' : 'text-pedra line-through'
                          }`}
                        >
                          {m.descricao}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${
                            m.ativo
                              ? 'bg-mata-claro text-mata-escuro'
                              : 'bg-terra-claro text-terra-escuro'
                          }`}
                        >
                          {m.ativo ? 'Ativo' : 'Desativado'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={ocupado || i === 0}
                            onClick={() => mover(i, -1)}
                            aria-label={`Subir ${m.descricao}`}
                            className="rounded-lg border border-linha p-1.5 text-tinta-suave transition hover:border-mata/30 hover:text-mata disabled:opacity-40"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={ocupado || i === motivos.length - 1}
                            onClick={() => mover(i, 1)}
                            aria-label={`Descer ${m.descricao}`}
                            className="rounded-lg border border-linha p-1.5 text-tinta-suave transition hover:border-mata/30 hover:text-mata disabled:opacity-40"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={ocupado}
                            onClick={() => abrirEdicao(m)}
                            className="flex items-center gap-1.5 rounded-lg border border-linha px-2.5 py-1.5 text-xs font-semibold text-tinta-suave transition hover:border-mata/30 hover:text-mata disabled:opacity-60"
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={ocupado}
                            onClick={() =>
                              statusMutacao.mutate({ id: m.id, ativo: !m.ativo })
                            }
                            className="rounded-lg border border-linha px-2.5 py-1.5 text-xs font-semibold text-tinta-suave transition hover:border-mata/30 hover:text-mata disabled:opacity-60"
                          >
                            {m.ativo ? 'Desativar' : 'Reativar'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalAberto && (
        <ModalMotivo
          motivo={emEdicao}
          onFechar={() => setModalAberto(false)}
          onSalvo={() => {
            setModalAberto(false);
            aoSalvar();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal de criação / edição
// ---------------------------------------------------------------------------

interface ModalProps {
  /** null = criando um motivo novo. */
  motivo: MotivoNaoEntrega | null;
  onFechar: () => void;
  onSalvo: () => void;
}

function ModalMotivo({
  motivo,
  onFechar,
  onSalvo,
}: ModalProps): React.ReactElement {
  const [descricao, setDescricao] = useState(motivo?.descricao ?? '');
  const [erro, setErro] = useState<string | null>(null);

  const mutacao = useMutation({
    mutationFn: (texto: string) =>
      motivo
        ? api.atualizarMotivo(motivo.id, { descricao: texto })
        : api.criarMotivo(texto),
    onSuccess: onSalvo,
    onError: (err) =>
      setErro(mensagemDeErro(err, 'Falha ao salvar o motivo.')),
  });

  const texto = descricao.trim();
  const invalido = texto === '';

  function salvar(): void {
    if (invalido) return;
    setErro(null);
    mutacao.mutate(texto);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-mata-escuro/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={motivo ? 'Editar motivo' : 'Novo motivo'}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !mutacao.isPending) onFechar();
      }}
    >
      <div className="w-full max-w-md animate-sobe rounded-xl2 bg-papel p-5 shadow-flutua">
        <h2 className="font-display text-lg font-semibold text-mata-escuro">
          {motivo ? 'Editar motivo' : 'Novo motivo'}
        </h2>

        <div className="mt-4">
          <label
            htmlFor="descricao-motivo"
            className="text-sm font-semibold text-tinta"
          >
            Descrição
          </label>
          <input
            id="descricao-motivo"
            type="text"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') salvar();
            }}
            maxLength={120}
            autoFocus
            disabled={mutacao.isPending}
            placeholder="Ex.: Ponte interditada"
            className="mt-2 w-full rounded-lg border border-linha bg-creme-50 px-3 py-2 text-sm text-tinta outline-none transition placeholder:text-pedra focus:border-mata/40 focus:bg-papel disabled:opacity-60"
          />
          <p className="mt-1 text-[11px] text-pedra">
            Curto e direto — é o que aparece na lista e nos relatórios.
          </p>
        </div>

        {erro && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-terra/30 bg-terra-claro px-3 py-2 text-sm text-terra-escuro"
          >
            {erro}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            disabled={mutacao.isPending}
            className="rounded-lg border border-linha px-4 py-2 text-sm font-semibold text-tinta-suave transition hover:bg-creme-50 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={mutacao.isPending || invalido}
            className="rounded-lg bg-mata px-4 py-2 text-sm font-bold text-creme-50 transition hover:bg-mata-escuro disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutacao.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
