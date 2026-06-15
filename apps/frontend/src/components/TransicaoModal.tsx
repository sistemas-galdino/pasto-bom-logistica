// Modal de confirmação de transição de status.
//
// RF-1.8: ao mover para 'agendada', se o cliente possui MAIS DE UMA propriedade,
// exige a seleção da propriedade + a data agendada.
// RF-2.2: ao mover para 'em_rota', a separação precisa estar completa (o backend
// também valida); aqui avisamos e bloqueamos o botão se ainda faltar separar.

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Pedido, Propriedade, StatusLogistico } from '@pastobom/shared';
import { api } from '../lib/api';
import { STATUS_META } from './status';

export interface TransicaoSubmit {
  para: StatusLogistico;
  propriedadeCodigo?: string;
  dataAgendada?: string;
}

interface Props {
  pedido: Pedido;
  para: StatusLogistico;
  enviando: boolean;
  erro: string | null;
  onCancelar: () => void;
  onConfirmar: (args: TransicaoSubmit) => void;
}

function hojeISO(): string {
  const d = new Date();
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

const inputCls =
  'w-full rounded-lg border border-linha bg-creme-50 px-3 py-2 text-sm text-tinta outline-none transition focus:border-folha focus:bg-papel focus:ring-2 focus:ring-folha/25';

export function TransicaoModal({
  pedido,
  para,
  enviando,
  erro,
  onCancelar,
  onConfirmar,
}: Props): React.ReactElement {
  const ehAgendamento = para === 'agendada';
  const ehEmRota = para === 'em_rota';

  // RF-2.2: separação precisa estar completa para liberar à rota.
  const totItens = pedido.itens.length;
  const sepItens = pedido.itens.filter((i) => i.separado).length;
  const separacaoCompleta = totItens === 0 || sepItens === totItens;
  const separacaoBloqueia = ehEmRota && !separacaoCompleta;

  const propsQuery = useQuery({
    queryKey: ['propriedades', pedido.clienteCodigo],
    queryFn: ({ signal }) =>
      api.propriedadesDoCliente(pedido.clienteCodigo, signal),
    enabled: ehAgendamento && pedido.clienteCodigo.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const propriedades: Propriedade[] = useMemo(
    () => propsQuery.data ?? [],
    [propsQuery.data],
  );
  const exigeSelecao = ehAgendamento && propriedades.length > 1;

  const [propriedadeCodigo, setPropriedadeCodigo] = useState<string>(
    pedido.propriedadeCodigo ?? '',
  );
  const [dataAgendada, setDataAgendada] = useState<string>(
    pedido.dataAgendada ?? hojeISO(),
  );

  useEffect(() => {
    if (!ehAgendamento) return;
    if (propriedades.length === 1 && !propriedadeCodigo) {
      const unica = propriedades[0];
      if (unica) setPropriedadeCodigo(unica.codigo);
    }
  }, [ehAgendamento, propriedades, propriedadeCodigo]);

  const meta = STATUS_META[para];
  const titulo =
    para === 'cancelada'
      ? 'Cancelar pedido'
      : `${meta.rotulo}: confirmar transição`;

  const faltaPropriedade = exigeSelecao && propriedadeCodigo.trim() === '';
  const faltaData = ehAgendamento && dataAgendada.trim() === '';
  const carregandoProps = ehAgendamento && propsQuery.isLoading;
  const bloqueado =
    enviando ||
    carregandoProps ||
    faltaPropriedade ||
    faltaData ||
    separacaoBloqueia;

  function aoConfirmar() {
    const args: TransicaoSubmit = { para };
    if (ehAgendamento) {
      args.dataAgendada = dataAgendada;
      if (propriedadeCodigo.trim() !== '') {
        args.propriedadeCodigo = propriedadeCodigo.trim();
      }
    }
    onConfirmar(args);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-mata-escuro/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onCancelar();
      }}
    >
      <div className="w-full max-w-md animate-sobe rounded-xl2 bg-papel p-5 shadow-flutua">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-mata-escuro">
              {titulo}
            </h2>
            <p className="mt-0.5 text-sm text-tinta-suave">
              Pedido nº {pedido.orixNumero || '—'} —{' '}
              {pedido.clienteNome || pedido.clienteCodigo}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${meta.badge}`}
          >
            → {meta.rotulo}
          </span>
        </div>

        {para === 'cancelada' ? (
          <p className="rounded-lg border border-terra/30 bg-terra-claro px-3 py-2.5 text-sm text-terra-escuro">
            Esta ação marca o pedido como cancelado e não pode ser desfeita pelo
            quadro. Nenhuma mensagem de WhatsApp é enviada.
          </p>
        ) : (
          <div className="space-y-4">
            {ehAgendamento && (
              <>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-tinta-suave">
                    Propriedade de entrega
                    {exigeSelecao && <span className="ml-1 text-terra">*</span>}
                  </label>

                  {carregandoProps ? (
                    <div className="rounded-lg border border-linha px-3 py-2 text-sm text-tinta-suave">
                      Carregando propriedades…
                    </div>
                  ) : propsQuery.isError ? (
                    <div className="rounded-lg border border-terra/30 bg-terra-claro px-3 py-2 text-sm text-terra-escuro">
                      Falha ao carregar propriedades do cliente.
                    </div>
                  ) : propriedades.length === 0 ? (
                    <p className="text-xs text-tinta-suave">
                      Cliente sem propriedades cadastradas — a entrega usará o
                      endereço padrão.
                    </p>
                  ) : (
                    <select
                      value={propriedadeCodigo}
                      onChange={(e) => setPropriedadeCodigo(e.target.value)}
                      className={inputCls}
                    >
                      {(!exigeSelecao || propriedadeCodigo === '') && (
                        <option value="">
                          {exigeSelecao
                            ? 'Selecione a propriedade…'
                            : 'Endereço padrão'}
                        </option>
                      )}
                      {propriedades.map((prop) => (
                        <option key={prop.codigo} value={prop.codigo}>
                          {prop.nome || prop.codigo}
                          {prop.cidade ? ` — ${prop.cidade}/${prop.uf}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  {exigeSelecao && (
                    <p className="mt-1 text-xs text-tinta-suave">
                      Este cliente tem mais de uma propriedade; escolha onde
                      entregar.
                    </p>
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-tinta-suave">
                    Data agendada <span className="text-terra">*</span>
                  </label>
                  <input
                    type="date"
                    value={dataAgendada}
                    min={hojeISO()}
                    onChange={(e) => setDataAgendada(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </>
            )}

            {ehEmRota &&
              (separacaoBloqueia ? (
                <p className="rounded-lg border border-trigo/40 bg-trigo-claro px-3 py-2.5 text-sm text-trigo-escuro">
                  <strong>Separação incompleta ({sepItens}/{totItens}).</strong>{' '}
                  Conclua a separação das mercadorias antes de pôr o pedido em
                  rota.
                </p>
              ) : (
                <p className="rounded-lg bg-trigo-claro px-3 py-2.5 text-sm text-trigo-escuro">
                  O cliente receberá um WhatsApp informando que o pedido saiu
                  para entrega.
                </p>
              ))}

            {para === 'entregue' && (
              <p className="rounded-lg bg-mata-claro px-3 py-2.5 text-sm text-mata-escuro">
                O cliente receberá um WhatsApp confirmando a entrega.
              </p>
            )}
          </div>
        )}

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
            onClick={onCancelar}
            disabled={enviando}
            className="rounded-lg border border-linha px-4 py-2 text-sm font-semibold text-tinta-suave transition hover:bg-creme-50 disabled:opacity-60"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={aoConfirmar}
            disabled={bloqueado}
            className={`rounded-lg px-4 py-2 text-sm font-bold text-creme-50 transition disabled:cursor-not-allowed disabled:opacity-60 ${
              para === 'cancelada'
                ? 'bg-terra hover:bg-terra-escuro'
                : 'bg-mata hover:bg-mata-escuro'
            }`}
          >
            {enviando ? 'Aplicando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
