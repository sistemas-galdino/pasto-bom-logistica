// Página de CAMINHÕES (somente logística): cadastro da frota com a capacidade
// de carga que a agenda usa para saber se "cabe mais uma entrega".
//
// UNIDADE: a tela fala em TONELADAS (é como o pessoal do pátio pensa), mas a
// API guarda kg. A conversão (t × 1000 na ida, kg ÷ 1000 na volta) vive aqui.
//
// Não existe excluir: desativar preserva o histórico dos pedidos já entregues.

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Truck, X } from 'lucide-react';
import type {
  AtualizarCaminhaoRequest,
  Caminhao,
  CriarCaminhaoRequest,
} from '@pastobom/shared';
import { api, ApiError } from '../lib/api';

function mensagemDeErro(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

/** kg -> "10,5 t" (a API guarda kg; a tela sempre fala toneladas). */
function formatarToneladas(kg: number): string {
  const t = kg / 1000;
  return `${t.toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  })} t`;
}

/** Aceita vírgula (pt-BR) ou ponto; devolve null se não for um número válido. */
function lerToneladas(texto: string): number | null {
  const limpo = texto.trim().replace(',', '.');
  if (limpo.length === 0) return null;
  const n = Number(limpo);
  if (!Number.isFinite(n)) return null;
  return n;
}

export default function Caminhoes(): React.ReactElement {
  const queryClient = useQueryClient();
  const [modalAberto, setModalAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Caminhao | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const caminhoesQuery = useQuery({
    queryKey: ['caminhoes'],
    queryFn: ({ signal }) => api.listarCaminhoes(signal),
  });

  const statusMutacao = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      api.atualizarCaminhao(id, { ativo }),
    onSuccess: () => {
      setErroAcao(null);
      void queryClient.invalidateQueries({ queryKey: ['caminhoes'] });
    },
    onError: (err) =>
      setErroAcao(mensagemDeErro(err, 'Falha ao alterar o caminhão.')),
  });

  const caminhoes = caminhoesQuery.data ?? [];
  const ativos = caminhoes.filter((c) => c.ativo);
  const capacidadeAtiva = ativos.reduce((s, c) => s + c.capacidadeKg, 0);

  if (caminhoesQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-tinta-suave">
        Carregando caminhões…
      </div>
    );
  }

  if (caminhoesQuery.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-tinta-suave">
        <p>
          {caminhoesQuery.error instanceof Error
            ? caminhoesQuery.error.message
            : 'Não foi possível carregar os caminhões.'}
        </p>
        <button
          type="button"
          onClick={() => void caminhoesQuery.refetch()}
          className="rounded-lg border border-linha bg-papel px-3 py-1.5 text-xs font-semibold text-tinta-suave hover:border-mata/30 hover:text-mata"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  function abrirNovo() {
    setErroAcao(null);
    setEmEdicao(null);
    setModalAberto(true);
  }

  function abrirEdicao(caminhao: Caminhao) {
    setErroAcao(null);
    setEmEdicao(caminhao);
    setModalAberto(true);
  }

  return (
    <div className="h-full overflow-y-auto scroll-suave">
      <div className="mx-auto max-w-7xl space-y-5 p-4 animate-sobe sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-tinta-suave">
            {caminhoes.length === 1
              ? '1 caminhão na frota'
              : `${caminhoes.length} caminhões na frota`}
            {ativos.length > 0 && (
              <>
                {' · '}
                <span className="text-tinta">
                  {formatarToneladas(capacidadeAtiva)}
                </span>{' '}
                de capacidade ativa
              </>
            )}
          </p>
          <button
            type="button"
            onClick={abrirNovo}
            className="flex items-center gap-2 rounded-lg bg-mata px-4 py-2 text-sm font-bold text-creme-50 shadow-sm transition hover:bg-mata-escuro"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Novo caminhão
          </button>
        </div>

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

        {caminhoes.length === 0 ? (
          <p className="py-16 text-center text-sm text-tinta-suave">
            Nenhum caminhão cadastrado.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl2 border border-linha bg-papel shadow-carta">
            <table className="w-full min-w-[680px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-linha text-[11px] font-semibold uppercase tracking-wide text-tinta-suave">
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Placa</th>
                  <th className="px-4 py-3">Capacidade</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {caminhoes.map((c) => {
                  const ocupado =
                    statusMutacao.isPending &&
                    statusMutacao.variables?.id === c.id;
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-linha/70 last:border-0 hover:bg-creme-50/60"
                    >
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2.5 font-medium text-tinta">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-folha-claro text-mata">
                            <Truck className="h-4 w-4" aria-hidden="true" />
                          </span>
                          {c.nome}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs uppercase text-tinta-suave">
                        {c.placa || '—'}
                      </td>
                      <td className="px-4 py-3 font-display font-semibold text-mata-escuro">
                        {formatarToneladas(c.capacidadeKg)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${
                            c.ativo
                              ? 'bg-mata-claro text-mata-escuro'
                              : 'bg-terra-claro text-terra-escuro'
                          }`}
                        >
                          {c.ativo ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => abrirEdicao(c)}
                            className="flex items-center gap-1.5 rounded-lg border border-linha px-3 py-1.5 text-xs font-semibold text-tinta-suave transition hover:border-mata/30 hover:text-mata"
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={ocupado}
                            title={
                              c.ativo
                                ? 'Desativar preserva o histórico dos pedidos.'
                                : undefined
                            }
                            onClick={() => {
                              setErroAcao(null);
                              statusMutacao.mutate({
                                id: c.id,
                                ativo: !c.ativo,
                              });
                            }}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                              c.ativo
                                ? 'border-terra/30 text-terra-escuro hover:bg-terra-claro'
                                : 'border-mata/30 text-mata hover:bg-mata-claro'
                            }`}
                          >
                            {ocupado ? '…' : c.ativo ? 'Desativar' : 'Ativar'}
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
        <CaminhaoModal
          caminhao={emEdicao}
          onFechar={() => {
            setModalAberto(false);
            setEmEdicao(null);
          }}
          onSalvo={() => {
            setModalAberto(false);
            setEmEdicao(null);
            void queryClient.invalidateQueries({ queryKey: ['caminhoes'] });
          }}
        />
      )}
    </div>
  );
}

interface CaminhaoModalProps {
  /** null = cadastro novo; preenchido = edição. */
  caminhao: Caminhao | null;
  onFechar: () => void;
  onSalvo: () => void;
}

function CaminhaoModal({
  caminhao,
  onFechar,
  onSalvo,
}: CaminhaoModalProps): React.ReactElement {
  const edicao = caminhao !== null;
  const [nome, setNome] = useState(caminhao?.nome ?? '');
  const [placa, setPlaca] = useState(caminhao?.placa ?? '');
  const [capacidade, setCapacidade] = useState(
    caminhao ? String(caminhao.capacidadeKg / 1000).replace('.', ',') : '',
  );
  const [erroForm, setErroForm] = useState<string | null>(null);

  const salvar = useMutation({
    mutationFn: (body: CriarCaminhaoRequest | AtualizarCaminhaoRequest) =>
      caminhao
        ? api.atualizarCaminhao(caminhao.id, body as AtualizarCaminhaoRequest)
        : api.criarCaminhao(body as CriarCaminhaoRequest),
    onSuccess: () => onSalvo(),
  });

  const enviando = salvar.isPending;
  const erro =
    erroForm ??
    (salvar.isError
      ? mensagemDeErro(salvar.error, 'Falha ao salvar o caminhão.')
      : null);

  function aoSubmeter(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;

    const toneladas = lerToneladas(capacidade);
    if (toneladas === null || toneladas <= 0) {
      setErroForm('Informe a capacidade em toneladas (maior que zero).');
      return;
    }
    setErroForm(null);

    const capacidadeKg = Math.round(toneladas * 1000);
    const placaLimpa = placa.trim().toUpperCase();
    salvar.mutate({
      nome: nome.trim(),
      placa: placaLimpa.length > 0 ? placaLimpa : null,
      capacidadeKg,
    });
  }

  const inputCls =
    'w-full rounded-lg border border-linha bg-creme-50 px-3 py-2 text-sm text-tinta outline-none transition placeholder:text-pedra focus:border-folha focus:bg-papel focus:ring-2 focus:ring-folha/25';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-mata-escuro/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={edicao ? 'Editar caminhão' : 'Novo caminhão'}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onFechar();
      }}
    >
      <div className="w-full max-w-md animate-sobe rounded-xl2 bg-papel p-5 shadow-flutua">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-folha-claro text-mata">
              <Truck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-display text-lg font-semibold text-mata-escuro">
                {edicao ? 'Editar caminhão' : 'Novo caminhão'}
              </h2>
              <p className="text-sm text-tinta-suave">
                A capacidade limita a carga de cada período na agenda.
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

        <form onSubmit={aoSubmeter}>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="caminhao-nome"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-tinta-suave"
              >
                Nome
              </label>
              <input
                id="caminhao-nome"
                type="text"
                required
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className={inputCls}
                placeholder="Ex.: Truck Branco"
              />
            </div>

            <div>
              <label
                htmlFor="caminhao-placa"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-tinta-suave"
              >
                Placa <span className="normal-case">(opcional)</span>
              </label>
              <input
                id="caminhao-placa"
                type="text"
                value={placa}
                onChange={(e) => setPlaca(e.target.value)}
                className={`${inputCls} uppercase`}
                placeholder="ABC1D23"
              />
            </div>

            <div>
              <label
                htmlFor="caminhao-capacidade"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-tinta-suave"
              >
                Capacidade (toneladas)
              </label>
              <input
                id="caminhao-capacidade"
                type="text"
                inputMode="decimal"
                required
                value={capacidade}
                onChange={(e) => setCapacidade(e.target.value)}
                className={inputCls}
                placeholder="10"
              />
              <p className="mt-1 text-xs text-pedra">
                Use vírgula para frações — ex.: 7,5 t.
              </p>
            </div>
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
              disabled={enviando}
              className="rounded-lg border border-linha px-4 py-2 text-sm font-semibold text-tinta-suave transition hover:bg-creme-50 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={enviando}
              className="rounded-lg bg-mata px-4 py-2 text-sm font-bold text-creme-50 transition hover:bg-mata-escuro disabled:cursor-not-allowed disabled:opacity-60"
            >
              {enviando ? 'Salvando…' : edicao ? 'Salvar' : 'Cadastrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
