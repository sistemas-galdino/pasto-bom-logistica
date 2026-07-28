// Modal de AGENDAR ENTREGA — o coração da Onda 2 no frontend.
//
// Substitui o antigo TransicaoModal para o caso do agendamento. A diferença que
// muda a operação é a coluna de QUANTIDADE: em vez de mandar o pedido inteiro,
// a logística decide quanto vai NESTA viagem.
//
// Foi o que a Natália descreveu na reunião de 16/07: "eu tenho 180, vou entregar
// 100, os 80 ficam para depois". E é também o que destrava a preocupação do
// Guto — o peso considerado é o da quantidade digitada, então um pedido de 100
// toneladas deixa de ser impossível de agendar: ele sai em várias viagens.
//
// RF-1.8 continua valendo: cliente com mais de uma propriedade exige escolher
// para qual delas a carga vai.

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  Caminhao,
  MotoristaResumo,
  Pedido,
  PeriodoEntrega,
  Propriedade,
  SaldoItem,
} from '@pastobom/shared';
import { pesoDaCarga, validarQuantidades } from '@pastobom/shared';
import { api } from '../lib/api';

interface Props {
  pedido: Pedido;
  saldo: SaldoItem[];
  enviando: boolean;
  erro: string | null;
  onCancelar: () => void;
  onConfirmar: (dados: {
    dataAgendada: string;
    periodo: PeriodoEntrega;
    motoristaId: string;
    caminhaoId: string;
    propriedadeCodigo?: string;
    quantidades: Record<string, number>;
  }) => void;
}

function hojeISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function formatarQtd(qtd: number): string {
  return qtd.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function formatarT(kg: number): string {
  return `${(kg / 1000).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  })} t`;
}

export function AgendarEntregaModal({
  pedido,
  saldo,
  enviando,
  erro,
  onCancelar,
  onConfirmar,
}: Props): React.ReactElement {
  // Só o que ainda tem o que entregar entra na tela; item zerado já foi.
  const comSaldo = useMemo(() => saldo.filter((s) => s.qtdSaldo > 0), [saldo]);

  const [data, setData] = useState(hojeISO());
  const [periodo, setPeriodo] = useState<PeriodoEntrega>('manha');
  const [motoristaId, setMotoristaId] = useState('');
  const [caminhaoId, setCaminhaoId] = useState('');
  const [propriedadeCodigo, setPropriedadeCodigo] = useState(
    pedido.propriedadeCodigo ?? '',
  );

  // Começa com o SALDO INTEIRO: o caso comum é levar tudo o que falta, e quem
  // vai fracionar edita. Digitar a quantidade toda vez seria trabalho à toa.
  const [quantidades, setQuantidades] = useState<Record<string, number>>(() =>
    Object.fromEntries(comSaldo.map((s) => [s.produtoCodigo, s.qtdSaldo])),
  );

  const motoristasQuery = useQuery({
    queryKey: ['motoristas'],
    queryFn: ({ signal }) => api.listarMotoristas(signal),
  });
  const caminhoesQuery = useQuery({
    queryKey: ['caminhoes'],
    queryFn: ({ signal }) => api.listarCaminhoes(signal),
  });
  const propriedadesQuery = useQuery({
    queryKey: ['propriedades', pedido.clienteCodigo],
    queryFn: ({ signal }) =>
      api.propriedadesDoCliente(pedido.clienteCodigo, signal),
    enabled: pedido.clienteCodigo !== '',
  });

  const motoristas: MotoristaResumo[] = motoristasQuery.data ?? [];
  const caminhoes: Caminhao[] = (caminhoesQuery.data ?? []).filter(
    (c) => c.ativo,
  );
  const propriedades: Propriedade[] = propriedadesQuery.data ?? [];
  const exigePropriedade = propriedades.length > 1;

  /** Peso do que está digitado agora — é o que a trava do caminhão vai medir. */
  const pesoSelecionado = useMemo(
    () =>
      pesoDaCarga(
        comSaldo.map((s) => ({
          qtd: quantidades[s.produtoCodigo] ?? 0,
          pesoUnitKg: s.pesoUnitKg,
        })),
      ),
    [comSaldo, quantidades],
  );

  const caminhaoEscolhido = caminhoes.find((c) => c.id === caminhaoId);
  const estouraCaminhao =
    caminhaoEscolhido !== undefined &&
    pesoSelecionado !== null &&
    pesoSelecionado > caminhaoEscolhido.capacidadeKg;

  // A MESMA função que o backend usa (@pastobom/shared): a tela não pode ser
  // mais permissiva nem mais rígida do que a regra de verdade.
  const errosQtd = useMemo(
    () => validarQuantidades(saldo, new Map(Object.entries(quantidades))),
    [saldo, quantidades],
  );

  const faltaCampo =
    data === '' ||
    motoristaId === '' ||
    caminhaoId === '' ||
    (exigePropriedade && propriedadeCodigo === '');

  const bloqueado = enviando || faltaCampo || errosQtd.length > 0;

  function definirQtd(codigo: string, valor: string): void {
    const n = Number(valor.replace(',', '.'));
    setQuantidades((atual) => ({
      ...atual,
      [codigo]: Number.isFinite(n) ? n : 0,
    }));
  }

  function confirmar(): void {
    if (bloqueado) return;
    onConfirmar({
      dataAgendada: data,
      periodo,
      motoristaId,
      caminhaoId,
      propriedadeCodigo: exigePropriedade ? propriedadeCodigo : undefined,
      // Só o que tem quantidade positiva vai para a viagem.
      quantidades: Object.fromEntries(
        Object.entries(quantidades).filter(([, q]) => q > 0),
      ),
    });
  }

  const campoCls =
    'w-full rounded-lg border border-linha bg-creme-50 px-3 py-2 text-sm text-tinta outline-none transition focus:border-mata/40 focus:bg-papel disabled:opacity-60';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-mata-escuro/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Agendar entrega"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onCancelar();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-2xl animate-sobe overflow-y-auto rounded-xl2 bg-papel p-5 shadow-flutua">
        <h2 className="font-display text-lg font-semibold text-mata-escuro">
          Agendar entrega
        </h2>
        <p className="mt-0.5 text-sm text-tinta-suave">
          Pedido nº {pedido.orixNumero || '—'} —{' '}
          {pedido.clienteNome || pedido.clienteCodigo}
        </p>

        {/* Quantidades */}
        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-tinta">
              O que vai nesta viagem
            </h3>
            <span className="text-[11px] text-pedra">
              o restante fica no pedido
            </span>
          </div>

          <ul className="mt-2 space-y-1.5">
            {comSaldo.map((item) => {
              const valor = quantidades[item.produtoCodigo] ?? 0;
              const excede = valor > item.qtdSaldo;
              return (
                <li
                  key={item.produtoCodigo}
                  className="flex items-center gap-3 rounded-lg border border-linha bg-creme-50 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-tinta">
                      {item.nomeProduto || item.produtoCodigo}
                    </p>
                    <p className="text-[11px] text-tinta-suave">
                      restam {formatarQtd(item.qtdSaldo)}
                      {item.qtdComprometida > 0 && (
                        <> · {formatarQtd(item.qtdComprometida)} já em viagem</>
                      )}
                      {item.pesoUnitKg === null && (
                        <span className="text-trigo-escuro"> · sem peso</span>
                      )}
                    </p>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={item.qtdSaldo}
                    step="any"
                    value={valor}
                    disabled={enviando}
                    onChange={(e) =>
                      definirQtd(item.produtoCodigo, e.target.value)
                    }
                    aria-label={`Quantidade de ${item.nomeProduto}`}
                    className={`w-24 shrink-0 rounded-lg border bg-papel px-2 py-1.5 text-right text-sm outline-none transition ${
                      excede
                        ? 'border-brasa text-brasa-escuro'
                        : 'border-linha text-tinta focus:border-mata/40'
                    }`}
                  />
                  <button
                    type="button"
                    disabled={enviando}
                    onClick={() =>
                      definirQtd(item.produtoCodigo, String(item.qtdSaldo))
                    }
                    title="Levar tudo o que resta deste produto"
                    className="shrink-0 rounded-md border border-linha px-2 py-1 text-[11px] font-semibold text-tinta-suave transition hover:border-mata/30 hover:text-mata"
                  >
                    tudo
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-tinta-suave">Peso desta viagem</span>
            <span
              className={`font-display font-semibold ${
                estouraCaminhao ? 'text-brasa' : 'text-mata-escuro'
              }`}
            >
              {pesoSelecionado === null
                ? 'peso desconhecido'
                : formatarT(pesoSelecionado)}
              {caminhaoEscolhido &&
                ` de ${formatarT(caminhaoEscolhido.capacidadeKg)}`}
            </span>
          </div>
        </div>

        {/* Quando e com quem */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold text-tinta">Data</span>
            <input
              type="date"
              value={data}
              disabled={enviando}
              onChange={(e) => setData(e.target.value)}
              className={`mt-1 ${campoCls}`}
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-tinta">Período</span>
            <select
              value={periodo}
              disabled={enviando}
              onChange={(e) => setPeriodo(e.target.value as PeriodoEntrega)}
              className={`mt-1 ${campoCls}`}
            >
              <option value="manha">Manhã</option>
              <option value="tarde">Tarde</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-tinta">Motorista</span>
            <select
              value={motoristaId}
              disabled={enviando}
              onChange={(e) => setMotoristaId(e.target.value)}
              className={`mt-1 ${campoCls}`}
            >
              <option value="">Escolha…</option>
              {motoristas.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome || m.id}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-tinta">Caminhão</span>
            <select
              value={caminhaoId}
              disabled={enviando}
              onChange={(e) => setCaminhaoId(e.target.value)}
              className={`mt-1 ${campoCls}`}
            >
              <option value="">Escolha…</option>
              {caminhoes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} ({formatarT(c.capacidadeKg)})
                </option>
              ))}
            </select>
            {caminhoes.length === 0 && !caminhoesQuery.isLoading && (
              <span className="mt-1 block text-[11px] text-trigo-escuro">
                Nenhum caminhão ativo cadastrado.
              </span>
            )}
          </label>

          {exigePropriedade && (
            <label className="block sm:col-span-2">
              <span className="text-sm font-semibold text-tinta">
                Propriedade de entrega
              </span>
              <select
                value={propriedadeCodigo}
                disabled={enviando}
                onChange={(e) => setPropriedadeCodigo(e.target.value)}
                className={`mt-1 ${campoCls}`}
              >
                <option value="">Escolha…</option>
                {propriedades.map((p) => (
                  <option key={p.codigo} value={p.codigo}>
                    {p.nome || p.codigo} — {p.cidade}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-pedra">
                Este cliente tem mais de uma propriedade.
              </span>
            </label>
          )}
        </div>

        {/* Avisos */}
        {errosQtd.length > 0 && (
          <ul className="mt-4 space-y-1 rounded-lg border border-brasa/30 bg-brasa-claro px-3 py-2 text-sm text-brasa-escuro">
            {errosQtd.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}

        {estouraCaminhao && errosQtd.length === 0 && (
          <p className="mt-4 rounded-lg border border-trigo/40 bg-trigo-claro px-3 py-2 text-sm text-trigo-escuro">
            Esta carga passa da capacidade do caminhão escolhido. O sistema vai
            recusar — reduza a quantidade ou escolha outro caminhão.
          </p>
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
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={bloqueado}
            className="rounded-lg bg-mata px-4 py-2 text-sm font-bold text-creme-50 transition hover:bg-mata-escuro disabled:cursor-not-allowed disabled:opacity-60"
          >
            {enviando ? 'Agendando…' : 'Agendar entrega'}
          </button>
        </div>
      </div>
    </div>
  );
}
