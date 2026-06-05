// Modal de confirmação de transição de status.
//
// Regra RF-1.8: ao mover para 'agendada', se o cliente possui MAIS DE UMA
// propriedade, exigir a seleção da propriedade + a data agendada. Com 0 ou 1
// propriedade, apenas a data agendada é pedida (a propriedade única é
// pré-selecionada quando existe).

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

export function TransicaoModal({
  pedido,
  para,
  enviando,
  erro,
  onCancelar,
  onConfirmar,
}: Props): React.ReactElement {
  const ehAgendamento = para === 'agendada';

  // Busca propriedades só quando vamos agendar.
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

  // Pré-seleciona quando há exatamente uma propriedade.
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
    enviando || carregandoProps || faltaPropriedade || faltaData;

  function aoConfirmar() {
    const args: TransicaoSubmit = { para };
    if (ehAgendamento) {
      args.dataAgendada = dataAgendada;
      // Envia a propriedade quando selecionada (obrigatória se >1; opcional
      // mas útil quando há exatamente uma e já foi pré-selecionada).
      if (propriedadeCodigo.trim() !== '') {
        args.propriedadeCodigo = propriedadeCodigo.trim();
      }
    }
    onConfirmar(args);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onCancelar();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">{titulo}</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Pedido nº {pedido.orixNumero || '—'} —{' '}
              {pedido.clienteNome || pedido.clienteCodigo}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${meta.badge}`}
          >
            → {meta.rotulo}
          </span>
        </div>

        {para === 'cancelada' ? (
          <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            Esta ação marca o pedido como cancelado e não pode ser desfeita pelo
            board. Nenhuma mensagem de WhatsApp é enviada.
          </p>
        ) : (
          <div className="space-y-4">
            {ehAgendamento && (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Propriedade de entrega
                    {exigeSelecao && (
                      <span className="ml-1 text-red-500">*</span>
                    )}
                  </label>

                  {carregandoProps ? (
                    <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-400">
                      Carregando propriedades…
                    </div>
                  ) : propsQuery.isError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                      Falha ao carregar propriedades do cliente.
                    </div>
                  ) : propriedades.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      Cliente sem propriedades cadastradas — a entrega usará o
                      endereço padrão.
                    </p>
                  ) : (
                    <select
                      value={propriedadeCodigo}
                      onChange={(e) => setPropriedadeCodigo(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
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
                    <p className="mt-1 text-xs text-slate-400">
                      Este cliente tem mais de uma propriedade; escolha onde
                      entregar.
                    </p>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Data agendada <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={dataAgendada}
                    min={hojeISO()}
                    onChange={(e) => setDataAgendada(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                  />
                </div>
              </>
            )}

            {para === 'em_rota' && (
              <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
                O cliente receberá um WhatsApp informando que o pedido saiu para
                entrega.
              </p>
            )}
            {para === 'entregue' && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
                O cliente receberá um WhatsApp confirmando a entrega.
              </p>
            )}
          </div>
        )}

        {erro && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {erro}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            disabled={enviando}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={aoConfirmar}
            disabled={bloqueado}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
              para === 'cancelada'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {enviando ? 'Aplicando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
