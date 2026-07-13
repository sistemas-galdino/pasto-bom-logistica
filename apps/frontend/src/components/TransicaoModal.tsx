// Modal de confirmação de transição de status.
//
// RF-1.8: ao mover para 'agendada', se o cliente possui MAIS DE UMA propriedade,
// exige a seleção da propriedade.
// Reunião de 25/06: o agendamento é o momento em que se decide TUDO da carga —
// data, período (nunca horário), motorista, caminhão — e um pedido com item sem
// peso não pode ser agendado (o peso é digitado aqui mesmo e fica salvo no produto).
// RF-2.2: ao mover para 'em_rota', a separação precisa estar completa (o backend
// também valida); aqui avisamos e bloqueamos o botão se ainda faltar separar.

import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Caminhao,
  MotoristaResumo,
  Pedido,
  PeriodoEntrega,
  Propriedade,
  StatusLogistico,
} from '@pastobom/shared';
import { api } from '../lib/api';
import { STATUS_META } from './status';
import { ClimaResumo } from './ClimaResumo';

export interface TransicaoSubmit {
  para: StatusLogistico;
  propriedadeCodigo?: string;
  dataAgendada?: string;
  motoristaId?: string | null;
  periodo?: PeriodoEntrega;
  caminhaoId?: string | null;
}

interface Props {
  pedido: Pedido;
  para: StatusLogistico;
  enviando: boolean;
  erro: string | null;
  onCancelar: () => void;
  onConfirmar: (args: TransicaoSubmit) => void;
}

const PERIODOS: { valor: PeriodoEntrega; rotulo: string }[] = [
  { valor: 'manha', rotulo: 'Manhã' },
  { valor: 'tarde', rotulo: 'Tarde' },
];

function hojeISO(): string {
  const d = new Date();
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

/** Peso em kg com as toneladas ao lado (a frota raciocina em toneladas). */
function formatarPeso(kg: number): string {
  const emKg = kg.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  if (kg < 1000) return `${emKg} kg`;
  const emT = (kg / 1000).toLocaleString('pt-BR', {
    maximumFractionDigits: 2,
  });
  return `${emKg} kg (${emT} t)`;
}

function formatarToneladas(kg: number): string {
  return `${(kg / 1000).toLocaleString('pt-BR', {
    maximumFractionDigits: 2,
  })} t`;
}

const inputCls =
  'w-full rounded-lg border border-linha bg-creme-50 px-3 py-2 text-sm text-tinta outline-none transition focus:border-folha focus:bg-papel focus:ring-2 focus:ring-folha/25';

const rotuloCls =
  'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-tinta-suave';

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
  const ehDescarte = para === 'cancelada' && pedido.statusLogistico === 'pendente';
  const queryClient = useQueryClient();

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
  const [periodo, setPeriodo] = useState<PeriodoEntrega | ''>(
    pedido.periodo ?? '',
  );

  // Motorista e caminhão são escolhidos no AGENDAMENTO (não mais no despacho).
  const motoristasQuery = useQuery({
    queryKey: ['motoristas'],
    queryFn: ({ signal }) => api.listarMotoristas(signal),
    enabled: ehAgendamento,
    staleTime: 5 * 60 * 1000,
  });
  const motoristas: MotoristaResumo[] = useMemo(
    () => motoristasQuery.data ?? [],
    [motoristasQuery.data],
  );
  const [motoristaId, setMotoristaId] = useState<string>(
    pedido.motoristaId ?? '',
  );

  const caminhoesQuery = useQuery({
    queryKey: ['caminhoes'],
    queryFn: ({ signal }) => api.listarCaminhoes(signal),
    enabled: ehAgendamento,
    staleTime: 5 * 60 * 1000,
  });
  const caminhoes: Caminhao[] = useMemo(
    () => (caminhoesQuery.data ?? []).filter((c) => c.ativo),
    [caminhoesQuery.data],
  );
  const [caminhaoId, setCaminhaoId] = useState<string>(pedido.caminhaoId ?? '');
  const caminhaoEscolhido = useMemo(
    () => caminhoes.find((c) => c.id === caminhaoId) ?? null,
    [caminhoes, caminhaoId],
  );

  // Previsão do clima para a data/propriedade escolhidas (preview do modal).
  // Refaz quando a data ou a propriedade muda; clima muda devagar → staleTime alto.
  const climaQuery = useQuery({
    queryKey: ['clima', pedido.id, dataAgendada, propriedadeCodigo],
    queryFn: ({ signal }) =>
      api.climaPedido(
        pedido.id,
        dataAgendada,
        propriedadeCodigo.trim() || undefined,
        signal,
      ),
    enabled: ehAgendamento && dataAgendada.trim().length > 0,
    staleTime: 30 * 60 * 1000,
  });

  useEffect(() => {
    if (!ehAgendamento) return;
    if (propriedades.length === 1 && !propriedadeCodigo) {
      const unica = propriedades[0];
      if (unica) setPropriedadeCodigo(unica.codigo);
    }
  }, [ehAgendamento, propriedades, propriedadeCodigo]);

  // Produtos do pedido ainda sem peso conhecido (deduplicados por código: o
  // peso é do PRODUTO, não da linha do pedido).
  const produtosSemPeso = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const item of pedido.itens) {
      if (item.pesoUnitKg === null && !mapa.has(item.produtoCodigo)) {
        mapa.set(item.produtoCodigo, item.nomeProduto);
      }
    }
    return [...mapa.entries()].map(([codigo, nome]) => ({ codigo, nome }));
  }, [pedido.itens]);

  const pesoPendente = produtosSemPeso.length > 0;

  const [pesos, setPesos] = useState<Record<string, string>>({});
  const [erroPeso, setErroPeso] = useState<string | null>(null);

  const pesoMutacao = useMutation({
    mutationFn: ({
      produtoCodigo,
      pesoKg,
    }: {
      produtoCodigo: string;
      pesoKg: number;
    }) => api.definirPesoProduto(produtoCodigo, pesoKg),
    onSuccess: (_dado, vars) => {
      setErroPeso(null);
      setPesos((atual) => {
        const copia = { ...atual };
        delete copia[vars.produtoCodigo];
        return copia;
      });
      void queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      void queryClient.invalidateQueries({ queryKey: ['agenda'] });
    },
    onError: (err: unknown) => {
      setErroPeso(
        err instanceof Error
          ? err.message
          : 'Falha ao salvar o peso do produto.',
      );
    },
  });

  function salvarPeso(produtoCodigo: string) {
    const bruto = (pesos[produtoCodigo] ?? '').trim().replace(',', '.');
    const kg = Number(bruto);
    if (bruto === '' || !Number.isFinite(kg) || kg <= 0) {
      setErroPeso('Informe um peso em kg maior que zero.');
      return;
    }
    pesoMutacao.mutate({ produtoCodigo, pesoKg: kg });
  }

  const meta = STATUS_META[para];
  const titulo =
    para === 'cancelada'
      ? ehDescarte
        ? 'Descartar pedido'
        : 'Cancelar pedido'
      : `${meta.rotulo}: confirmar transição`;

  const carregandoProps = ehAgendamento && propsQuery.isLoading;

  // Motivo do bloqueio explicado ao usuário — nada de botão morto sem explicação.
  const faltas: string[] = [];
  if (ehAgendamento) {
    if (dataAgendada.trim() === '') faltas.push('data');
    if (periodo === '') faltas.push('período');
    if (motoristaId.trim() === '') faltas.push('motorista');
    if (caminhaoId.trim() === '') faltas.push('caminhão');
    if (exigeSelecao && propriedadeCodigo.trim() === '') {
      faltas.push('propriedade');
    }
  }
  const pesoBloqueia = ehAgendamento && pesoPendente;

  let motivo: string | null = null;
  if (pesoBloqueia) {
    motivo =
      produtosSemPeso.length === 1
        ? 'Informe o peso do produto que falta para poder agendar.'
        : `Informe o peso dos ${produtosSemPeso.length} produtos que faltam para poder agendar.`;
  } else if (faltas.length > 0) {
    motivo = `Falta escolher: ${faltas.join(', ')}.`;
  } else if (separacaoBloqueia) {
    motivo = `Separação incompleta (${sepItens}/${totItens}).`;
  }

  const bloqueado =
    enviando ||
    carregandoProps ||
    pesoBloqueia ||
    faltas.length > 0 ||
    separacaoBloqueia;

  function aoConfirmar() {
    const args: TransicaoSubmit = { para };
    if (ehAgendamento) {
      args.dataAgendada = dataAgendada;
      if (periodo !== '') args.periodo = periodo;
      args.motoristaId = motoristaId.trim();
      args.caminhaoId = caminhaoId.trim();
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
      <div className="max-h-[90vh] w-full max-w-md animate-sobe overflow-y-auto rounded-xl2 bg-papel p-5 shadow-flutua">
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
            {ehDescarte
              ? 'O pedido sai do quadro e vai para a aba de cancelados (de onde pode ser restaurado). Nenhuma mensagem de WhatsApp é enviada ao cliente.'
              : 'Esta ação marca o pedido como cancelado. Nenhuma mensagem de WhatsApp é enviada ao cliente.'}
          </p>
        ) : (
          <div className="space-y-4">
            {ehAgendamento && (
              <>
                <div>
                  <label className={rotuloCls}>
                    Data agendada <span className="text-terra">*</span>
                  </label>
                  <input
                    type="date"
                    value={dataAgendada}
                    min={hojeISO()}
                    onChange={(e) => setDataAgendada(e.target.value)}
                    className={inputCls}
                  />
                  {dataAgendada.trim() && (
                    <div className="mt-2">
                      <ClimaResumo
                        variant="completo"
                        previsao={climaQuery.data}
                        carregando={climaQuery.isLoading}
                      />
                    </div>
                  )}
                </div>

                <div>
                  <label className={rotuloCls}>
                    Período <span className="text-terra">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {PERIODOS.map((p) => {
                      const ativo = periodo === p.valor;
                      return (
                        <button
                          key={p.valor}
                          type="button"
                          aria-pressed={ativo}
                          onClick={() => setPeriodo(p.valor)}
                          className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                            ativo
                              ? 'border-folha bg-folha-claro text-mata'
                              : 'border-linha bg-creme-50 text-tinta-suave hover:border-folha/40 hover:text-mata'
                          }`}
                        >
                          {p.rotulo}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1 text-xs text-tinta-suave">
                    A entrega é planejada por turno — não se marca horário com o
                    cliente.
                  </p>
                </div>

                <div>
                  <label className={rotuloCls}>
                    Motorista <span className="text-terra">*</span>
                  </label>
                  {motoristasQuery.isLoading ? (
                    <div className="rounded-lg border border-linha px-3 py-2 text-sm text-tinta-suave">
                      Carregando motoristas…
                    </div>
                  ) : motoristasQuery.isError ? (
                    <div className="rounded-lg border border-terra/30 bg-terra-claro px-3 py-2 text-sm text-terra-escuro">
                      Falha ao carregar motoristas.
                    </div>
                  ) : (
                    <select
                      value={motoristaId}
                      onChange={(e) => setMotoristaId(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">Selecione o motorista…</option>
                      {motoristas.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nome || m.id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className={rotuloCls}>
                    Caminhão <span className="text-terra">*</span>
                  </label>
                  {caminhoesQuery.isLoading ? (
                    <div className="rounded-lg border border-linha px-3 py-2 text-sm text-tinta-suave">
                      Carregando caminhões…
                    </div>
                  ) : caminhoesQuery.isError ? (
                    <div className="rounded-lg border border-terra/30 bg-terra-claro px-3 py-2 text-sm text-terra-escuro">
                      Falha ao carregar os caminhões.
                    </div>
                  ) : caminhoes.length === 0 ? (
                    <p className="rounded-lg border border-trigo/40 bg-trigo-claro px-3 py-2 text-sm text-trigo-escuro">
                      Nenhum caminhão ativo cadastrado. Cadastre a frota antes
                      de agendar.
                    </p>
                  ) : (
                    <select
                      value={caminhaoId}
                      onChange={(e) => setCaminhaoId(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">Selecione o caminhão…</option>
                      {caminhoes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome} — {formatarToneladas(c.capacidadeKg)}
                          {c.placa ? ` · ${c.placa}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  <p className="mt-1 text-xs text-tinta-suave">
                    O motorista e o caminhão ficam reservados neste período.
                  </p>
                </div>

                <div>
                  <label className={rotuloCls}>
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

                <div className="rounded-lg border border-linha bg-creme-50 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">
                      Carga do pedido
                    </span>
                    <span
                      className={`font-display text-sm font-semibold ${
                        pesoPendente ? 'text-trigo-escuro' : 'text-mata-escuro'
                      }`}
                    >
                      {pedido.pesoTotalKg === null
                        ? 'peso pendente'
                        : formatarPeso(pedido.pesoTotalKg)}
                    </span>
                  </div>

                  {caminhaoEscolhido && (
                    <p className="mt-1 text-xs text-tinta-suave">
                      {caminhaoEscolhido.nome} leva até{' '}
                      {formatarToneladas(caminhaoEscolhido.capacidadeKg)}. O
                      servidor confere o que já está carregado neste período.
                    </p>
                  )}

                  {pesoPendente ? (
                    <div className="mt-3 space-y-3">
                      <p className="text-xs text-trigo-escuro">
                        Não dá para agendar sem saber o peso. Informe o peso{' '}
                        <strong>unitário</strong> (kg) de cada produto abaixo —
                        ele fica salvo <strong>no produto</strong> e vale para
                        os próximos pedidos.
                      </p>
                      {produtosSemPeso.map((prod) => {
                        const salvando =
                          pesoMutacao.isPending &&
                          pesoMutacao.variables?.produtoCodigo === prod.codigo;
                        return (
                          <div key={prod.codigo}>
                            <p className="truncate text-xs font-medium text-tinta">
                              {prod.nome || prod.codigo}
                            </p>
                            <div className="mt-1 flex items-center gap-2">
                              <input
                                type="number"
                                min="0"
                                step="0.1"
                                inputMode="decimal"
                                placeholder="kg por unidade"
                                aria-label={`Peso unitário de ${prod.nome || prod.codigo}`}
                                value={pesos[prod.codigo] ?? ''}
                                onChange={(e) =>
                                  setPesos((atual) => ({
                                    ...atual,
                                    [prod.codigo]: e.target.value,
                                  }))
                                }
                                className={inputCls}
                              />
                              <button
                                type="button"
                                onClick={() => salvarPeso(prod.codigo)}
                                disabled={pesoMutacao.isPending}
                                className="shrink-0 rounded-lg bg-mata px-3 py-2 text-xs font-bold text-creme-50 transition hover:bg-mata-escuro disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {salvando ? 'Salvando…' : 'Salvar'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {erroPeso && (
                        <p
                          role="alert"
                          className="rounded-lg border border-terra/30 bg-terra-claro px-3 py-2 text-xs text-terra-escuro"
                        >
                          {erroPeso}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-tinta-suave">
                      Todos os itens têm peso cadastrado.
                    </p>
                  )}
                </div>
              </>
            )}

            {ehEmRota && (
              <>
                <dl className="space-y-1.5 rounded-lg border border-linha bg-creme-50 p-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-tinta-suave">Motorista</dt>
                    <dd className="truncate text-right font-medium text-tinta">
                      {pedido.motoristaNome || '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-tinta-suave">Caminhão</dt>
                    <dd className="truncate text-right font-medium text-tinta">
                      {pedido.caminhaoNome || '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-tinta-suave">Carga</dt>
                    <dd className="text-right font-medium text-tinta">
                      {pedido.pesoTotalKg === null
                        ? '—'
                        : formatarPeso(pedido.pesoTotalKg)}
                    </dd>
                  </div>
                </dl>
                <p className="text-xs text-tinta-suave">
                  Motorista e caminhão foram definidos no agendamento. Para
                  trocar, volte o pedido para Pendente e agende de novo.
                </p>

                {separacaoBloqueia ? (
                  <p className="rounded-lg border border-trigo/40 bg-trigo-claro px-3 py-2.5 text-sm text-trigo-escuro">
                    <strong>
                      Separação incompleta ({sepItens}/{totItens}).
                    </strong>{' '}
                    Conclua a separação das mercadorias antes de pôr o pedido em
                    rota.
                  </p>
                ) : (
                  <p className="rounded-lg bg-trigo-claro px-3 py-2.5 text-sm text-trigo-escuro">
                    O cliente receberá um WhatsApp informando que o pedido saiu
                    para entrega.
                  </p>
                )}
              </>
            )}

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

        <div className="mt-5 flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
          {motivo && !enviando && (
            <p className="mr-auto text-xs text-trigo-escuro">{motivo}</p>
          )}
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
            {enviando
              ? 'Aplicando…'
              : para === 'cancelada' && ehDescarte
                ? 'Descartar'
                : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
