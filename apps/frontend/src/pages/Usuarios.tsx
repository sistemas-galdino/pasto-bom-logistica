// Página de ADMINISTRAÇÃO de usuários (somente logística): diretório da equipe
// com papel, status e último acesso. Permite convidar novos usuários gerando
// um link de acesso (sem e-mail), trocar o papel e ativar/desativar o acesso.
//
// Auto-proteção (UX): na própria linha, o usuário não pode rebaixar o próprio
// papel nem desativar a si mesmo (o backend também barra com 422).

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Copy,
  Link2,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  AtualizarUsuarioRequest,
  ConviteUsuarioRequest,
  PapelUsuario,
  StatusUsuario,
  UsuarioAdmin,
} from '@pastobom/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { PAPEL_BADGE, PAPEL_ROTULO } from '../lib/papeis';

const PAPEIS: PapelUsuario[] = Object.keys(PAPEL_ROTULO) as PapelUsuario[];

const STATUS_ROTULO: Record<StatusUsuario, string> = {
  ativo: 'Ativo',
  pendente: 'Pendente',
  inativo: 'Inativo',
};

const STATUS_BADGE: Record<StatusUsuario, string> = {
  ativo: 'bg-mata-claro text-mata-escuro',
  pendente: 'bg-trigo-claro text-trigo-escuro',
  inativo: 'bg-terra-claro text-terra-escuro',
};

function mensagemDeErro(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

function formatarAcesso(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR');
}

export function Usuarios(): React.ReactElement {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [modalAberto, setModalAberto] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [linkRegerado, setLinkRegerado] = useState<{
    nome: string;
    link: string;
  } | null>(null);

  const usuariosQuery = useQuery({
    queryKey: ['usuarios'],
    queryFn: ({ signal }) => api.listarUsuarios(signal),
  });

  function aoSucesso() {
    void queryClient.invalidateQueries({ queryKey: ['usuarios'] });
  }

  const papelMutacao = useMutation({
    mutationFn: ({ id, body }: { id: string; body: AtualizarUsuarioRequest }) =>
      api.atualizarUsuario(id, body),
    onSuccess: () => {
      setErroAcao(null);
      aoSucesso();
    },
    onError: (err) => setErroAcao(mensagemDeErro(err, 'Falha ao trocar o papel.')),
  });

  const statusMutacao = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      api.definirStatusUsuario(id, ativo),
    onSuccess: () => {
      setErroAcao(null);
      aoSucesso();
    },
    onError: (err) =>
      setErroAcao(mensagemDeErro(err, 'Falha ao alterar o acesso.')),
  });

  const linkMutacao = useMutation({
    mutationFn: ({ id }: { id: string; nome: string }) =>
      api.regenerarLink(id),
    onSuccess: (resp, variaveis) => {
      setErroAcao(null);
      setLinkRegerado({ nome: variaveis.nome, link: resp.link });
    },
    onError: (err) =>
      setErroAcao(mensagemDeErro(err, 'Falha ao regerar o link.')),
  });

  const isLoading = usuariosQuery.isLoading;
  const isError = usuariosQuery.isError;
  const usuarios = usuariosQuery.data ?? [];

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-tinta-suave">
        Carregando usuários…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-tinta-suave">
        <p>
          {usuariosQuery.error instanceof Error
            ? usuariosQuery.error.message
            : 'Não foi possível carregar os usuários.'}
        </p>
        <button
          type="button"
          onClick={() => void usuariosQuery.refetch()}
          className="rounded-lg border border-linha bg-papel px-3 py-1.5 text-xs font-semibold text-tinta-suave hover:border-mata/30 hover:text-mata"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scroll-suave">
      <div className="mx-auto max-w-7xl space-y-5 p-4 animate-sobe sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-tinta-suave">
            {usuarios.length === 1
              ? '1 usuário no sistema'
              : `${usuarios.length} usuários no sistema`}
          </p>
          <button
            type="button"
            onClick={() => setModalAberto(true)}
            className="flex items-center gap-2 rounded-lg bg-mata px-4 py-2 text-sm font-bold text-creme-50 shadow-sm transition hover:bg-mata-escuro"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Convidar usuário
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

        {usuarios.length === 0 ? (
          <p className="py-16 text-center text-sm text-tinta-suave">
            Nenhum usuário cadastrado.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl2 border border-linha bg-papel shadow-carta">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-linha text-[11px] font-semibold uppercase tracking-wide text-tinta-suave">
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">E-mail</th>
                  <th className="px-4 py-3">Papel</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Último acesso</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u) => {
                  const ehVoce = u.id === user?.id;
                  const estaInativo = u.status === 'inativo';
                  const papelOcupado =
                    papelMutacao.isPending && papelMutacao.variables?.id === u.id;
                  const statusOcupado =
                    statusMutacao.isPending &&
                    statusMutacao.variables?.id === u.id;
                  const linkOcupado =
                    linkMutacao.isPending && linkMutacao.variables?.id === u.id;

                  return (
                    <tr
                      key={u.id}
                      className="border-b border-linha/70 last:border-0 hover:bg-creme-50/60"
                    >
                      <td className="px-4 py-3 font-medium text-tinta">
                        {u.nome || '—'}
                        {ehVoce && (
                          <span className="ml-1.5 text-xs font-normal text-tinta-suave">
                            (você)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-tinta-suave">{u.email}</td>
                      <td className="px-4 py-3">
                        {u.papel ? (
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${PAPEL_BADGE[u.papel]}`}
                          >
                            {PAPEL_ROTULO[u.papel]}
                          </span>
                        ) : (
                          <span className="text-tinta-suave">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_BADGE[u.status]}`}
                        >
                          {STATUS_ROTULO[u.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-tinta-suave">
                        {formatarAcesso(u.ultimoAcesso)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <select
                            aria-label={`Papel de ${u.nome || u.email}`}
                            value={u.papel ?? ''}
                            disabled={papelOcupado}
                            onChange={(e) => {
                              const novo = e.target.value as PapelUsuario;
                              if (novo === u.papel) return;
                              setErroAcao(null);
                              papelMutacao.mutate({
                                id: u.id,
                                body: { papel: novo },
                              });
                            }}
                            className="rounded-lg border border-linha bg-creme-50 px-2.5 py-1.5 text-xs font-semibold text-tinta outline-none transition focus:border-folha focus:bg-papel focus:ring-2 focus:ring-folha/25 disabled:opacity-60"
                          >
                            {u.papel === null && (
                              <option value="" disabled>
                                Definir papel…
                              </option>
                            )}
                            {PAPEIS.map((p) => (
                              <option
                                key={p}
                                value={p}
                                // Auto-proteção: na própria linha só permite manter 'logistica'.
                                disabled={ehVoce && p !== 'logistica'}
                              >
                                {PAPEL_ROTULO[p]}
                              </option>
                            ))}
                          </select>

                          {u.status === 'pendente' && (
                            <button
                              type="button"
                              disabled={linkOcupado}
                              title="Gerar um novo link de acesso (o anterior pode ter expirado)."
                              onClick={() => {
                                setErroAcao(null);
                                linkMutacao.mutate({
                                  id: u.id,
                                  nome: u.nome || u.email,
                                });
                              }}
                              className="flex items-center gap-1.5 rounded-lg border border-folha/50 px-3 py-1.5 text-xs font-semibold text-mata transition hover:bg-folha-claro disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                              {linkOcupado ? '…' : 'Regerar link'}
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={ehVoce || statusOcupado}
                            title={
                              ehVoce
                                ? 'Você não pode desativar a si mesmo.'
                                : undefined
                            }
                            onClick={() => {
                              setErroAcao(null);
                              statusMutacao.mutate({
                                id: u.id,
                                ativo: estaInativo,
                              });
                            }}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                              estaInativo
                                ? 'border-mata/30 text-mata hover:bg-mata-claro'
                                : 'border-terra/30 text-terra-escuro hover:bg-terra-claro'
                            }`}
                          >
                            {statusOcupado
                              ? '…'
                              : estaInativo
                                ? 'Ativar'
                                : 'Desativar'}
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
        <ConviteModal
          onFechar={() => setModalAberto(false)}
          onCriado={() =>
            void queryClient.invalidateQueries({ queryKey: ['usuarios'] })
          }
        />
      )}

      {linkRegerado && (
        <LinkModal
          nome={linkRegerado.nome}
          link={linkRegerado.link}
          onFechar={() => setLinkRegerado(null)}
        />
      )}
    </div>
  );
}

interface ConviteModalProps {
  onFechar: () => void;
  onCriado: () => void;
}

function ConviteModal({
  onFechar,
  onCriado,
}: ConviteModalProps): React.ReactElement {
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [papel, setPapel] = useState<PapelUsuario>('vendedor');
  const [linkGerado, setLinkGerado] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const convite = useMutation({
    mutationFn: (body: ConviteUsuarioRequest) => api.convidarUsuario(body),
    onSuccess: (resposta) => {
      setLinkGerado(resposta.link);
      // O usuário já foi criado (status 'pendente'); atualiza o diretório atrás do modal.
      onCriado();
    },
  });

  const erro = convite.isError
    ? mensagemDeErro(convite.error, 'Falha ao gerar o link de acesso.')
    : null;
  const enviando = convite.isPending;

  function aoSubmeter(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    convite.mutate({ email: email.trim(), nome: nome.trim(), papel });
  }

  async function copiarLink() {
    if (!linkGerado) return;
    try {
      await navigator.clipboard.writeText(linkGerado);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }

  function convidarOutro() {
    setLinkGerado(null);
    setCopiado(false);
    setEmail('');
    setNome('');
    setPapel('vendedor');
    convite.reset();
  }

  const inputCls =
    'w-full rounded-lg border border-linha bg-creme-50 px-3 py-2 text-sm text-tinta outline-none transition placeholder:text-pedra focus:border-folha focus:bg-papel focus:ring-2 focus:ring-folha/25';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-mata-escuro/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Convidar usuário"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onFechar();
      }}
    >
      <div className="w-full max-w-md animate-sobe rounded-xl2 bg-papel p-5 shadow-flutua">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-folha-claro text-mata">
              <UserPlus className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-display text-lg font-semibold text-mata-escuro">
                Convidar usuário
              </h2>
              <p className="text-sm text-tinta-suave">
                {linkGerado
                  ? 'Link gerado — envie ao colaborador.'
                  : 'A pessoa criará a própria senha pelo link.'}
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

        {linkGerado ? (
          <div className="space-y-4">
            <p className="text-sm text-tinta-suave">
              Envie este link ao colaborador (ex.: WhatsApp). Ao abri-lo, ele
              cria a própria senha e entra. O link tem validade limitada —
              envie logo.
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={linkGerado}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Link de acesso gerado"
                className={`${inputCls} font-mono text-xs`}
              />
              <button
                type="button"
                onClick={() => void copiarLink()}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-mata px-3 py-2 text-xs font-bold text-creme-50 transition hover:bg-mata-escuro"
              >
                {copiado ? (
                  <>
                    <Check className="h-4 w-4" aria-hidden="true" />
                    Copiado!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    Copiar link
                  </>
                )}
              </button>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={convidarOutro}
                className="rounded-lg border border-linha px-4 py-2 text-sm font-semibold text-tinta-suave transition hover:bg-creme-50"
              >
                Convidar outro
              </button>
              <button
                type="button"
                onClick={onFechar}
                className="rounded-lg bg-mata px-4 py-2 text-sm font-bold text-creme-50 transition hover:bg-mata-escuro"
              >
                Concluir
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={aoSubmeter}>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-tinta-suave">
                  E-mail
                </label>
                <input
                  type="email"
                  required
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputCls}
                  placeholder="pessoa@pastobom.com.br"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-tinta-suave">
                  Nome
                </label>
                <input
                  type="text"
                  required
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className={inputCls}
                  placeholder="Nome completo"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-tinta-suave">
                  Papel
                </label>
                <select
                  value={papel}
                  onChange={(e) => setPapel(e.target.value as PapelUsuario)}
                  className={inputCls}
                >
                  {PAPEIS.map((p) => (
                    <option key={p} value={p}>
                      {PAPEL_ROTULO[p]}
                    </option>
                  ))}
                </select>
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
                className="flex items-center gap-2 rounded-lg bg-mata px-4 py-2 text-sm font-bold text-creme-50 transition hover:bg-mata-escuro disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                {enviando ? 'Gerando…' : 'Gerar link'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

interface LinkModalProps {
  nome: string;
  link: string;
  onFechar: () => void;
}

// Exibe um link de acesso já gerado (ex.: ao regerar para um usuário pendente),
// com botão de copiar. Reaproveita o visual do estado de sucesso do convite.
function LinkModal({
  nome,
  link,
  onFechar,
}: LinkModalProps): React.ReactElement {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }

  const inputCls =
    'w-full rounded-lg border border-linha bg-creme-50 px-3 py-2 text-sm text-tinta outline-none transition placeholder:text-pedra focus:border-folha focus:bg-papel focus:ring-2 focus:ring-folha/25';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-mata-escuro/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Link de acesso"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onFechar();
      }}
    >
      <div className="w-full max-w-md animate-sobe rounded-xl2 bg-papel p-5 shadow-flutua">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-folha-claro text-mata">
              <Link2 className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-display text-lg font-semibold text-mata-escuro">
                Novo link de acesso
              </h2>
              <p className="text-sm text-tinta-suave">{nome}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="shrink-0 rounded-lg p-1.5 text-tinta-suave transition hover:bg-creme-50 hover:text-tinta"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-4 text-sm text-tinta-suave">
          Envie este link ao colaborador (ex.: WhatsApp). Ao abri-lo, ele define
          a senha e entra. O link tem validade limitada — envie logo.
        </p>

        <div className="flex items-center gap-2">
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Link de acesso"
            className={`${inputCls} font-mono text-xs`}
          />
          <button
            type="button"
            onClick={() => void copiar()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-mata px-3 py-2 text-xs font-bold text-creme-50 transition hover:bg-mata-escuro"
          >
            {copiado ? (
              <>
                <Check className="h-4 w-4" aria-hidden="true" />
                Copiado!
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" aria-hidden="true" />
                Copiar link
              </>
            )}
          </button>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onFechar}
            className="rounded-lg bg-mata px-4 py-2 text-sm font-bold text-creme-50 transition hover:bg-mata-escuro"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
}
