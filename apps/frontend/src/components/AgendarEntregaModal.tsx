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
//
// O PESO (áudios da Natália, 12/08/2026)
// ---------------------------------------------------------------------------
// Produto sem peso ganha campo AQUI. Antes da Onda 2 isso existia no
// TransicaoModal e se perdeu quando ele foi substituído — e ficou só a trava do
// servidor: o botão habilitado, a pessoa clicava, e o erro "falta o peso" não
// tinha onde ser resolvido.
//
// Peso 'manual' (digitado pela equipe) pede conferência a cada agendamento, que
// é o pedido do terceiro áudio: a soja "sempre vem com peso diferente", então o
// valor guardado é sugestão, não verdade. Peso 'auto' (extraído do nome do
// produto) passa direto — pedir confirmação de "CALCARIO ... 50T" todo dia
// ensinaria a equipe a clicar sem ler.

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
import {
  avaliarLimiteEntregas,
  avaliarPesoAgendamento,
  pesoDaCarga,
  validarQuantidades,
} from '@pastobom/shared';
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
    pesos?: Record<string, number>;
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

function formatarKg(kg: number): string {
  return `${kg.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kg`;
}

/** '2026-08-05T…' -> '05/08'. Só a data, que é o que importa na conferência. */
function dataCurta(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getDate()).padStart(2, '0')}/${String(
    d.getMonth() + 1,
  ).padStart(2, '0')}`;
}

/** Aceita vírgula decimal — a equipe digita 1,5 e não 1.5. */
function paraNumero(valor: string): number {
  return Number(valor.replace(',', '.'));
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

  // Peso digitado agora, como TEXTO: guardar número atrapalharia quem está no
  // meio de digitar "1," ou apagou o campo para redigitar.
  const [pesos, setPesos] = useState<Record<string, string>>({});
  /** Produtos cujo peso já foi conferido nesta tela (o checkbox da soja). */
  const [confirmados, setConfirmados] = useState<Set<string>>(new Set());

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

  /** Pesos digitados, já como números válidos (o que a regra pura consome). */
  const pesosInformados = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const [codigo, texto] of Object.entries(pesos)) {
      const n = paraNumero(texto);
      if (texto.trim() !== '' && Number.isFinite(n) && n > 0) mapa.set(codigo, n);
    }
    return mapa;
  }, [pesos]);

  // A MESMA regra que o backend aplica: o que falta de peso e o que pede
  // conferência. Repetir o `if` nos dois lados foi o que produziu o bug atual.
  const situacaoPeso = useMemo(
    () =>
      avaliarPesoAgendamento({
        linhas: comSaldo.map((s) => ({
          produtoCodigo: s.produtoCodigo,
          nomeProduto: s.nomeProduto,
          pesoUnitKg: s.pesoUnitKg,
          pesoOrigem: s.pesoOrigem ?? null,
        })),
        quantidades: new Map(Object.entries(quantidades)),
        pesosInformados,
        confirmados,
      }),
    [comSaldo, quantidades, pesosInformados, confirmados],
  );

  /** Peso do que está digitado agora — é o que a trava do caminhão vai medir. */
  const pesoSelecionado = useMemo(
    () =>
      pesoDaCarga(
        comSaldo.map((s) => ({
          qtd: quantidades[s.produtoCodigo] ?? 0,
          // O peso digitado vale mais que o cadastro: o total tem de reagir na
          // hora, senão ela digita o peso e continua vendo "peso desconhecido".
          pesoUnitKg: pesosInformados.get(s.produtoCodigo) ?? s.pesoUnitKg,
        })),
      ),
    [comSaldo, quantidades, pesosInformados],
  );

  const caminhaoEscolhido = caminhoes.find((c) => c.id === caminhaoId);

  // O que o caminhão escolhido JÁ tem no dia escolhido. Sem isso a tela só sabia
  // comparar o peso desta viagem contra a capacidade total, e um caminhão meio
  // cheio passava batido até o 422 do servidor.
  //
  // A janela é o dia inteiro (de = ate) porque as duas regras têm escopos
  // diferentes: a tonelagem é por SLOT (dia x turno) e o teto de entregas é por
  // DIA, somando manhã e tarde.
  const diaQuery = useQuery({
    queryKey: ['agenda', data, data],
    queryFn: ({ signal }) => api.agenda(data, data, signal),
    enabled: data !== '',
  });

  const limitesQuery = useQuery({
    queryKey: ['limites-caminhao', caminhaoId],
    queryFn: ({ signal }) => api.limitesDoCaminhao(caminhaoId, signal),
    enabled: caminhaoId !== '',
  });

  /** Ocupação do caminhão escolhido: kg no turno e nº de entregas no dia. */
  const ocupacaoAtual = useMemo(() => {
    const slots = diaQuery.data?.slots ?? [];
    let usadoKgNoSlot = 0;
    let entregasNoDia = 0;
    for (const slot of slots) {
      for (const o of slot.ocupacao) {
        if (o.caminhaoId !== caminhaoId) continue;
        entregasNoDia += o.entregas;
        if (slot.periodo === periodo) usadoKgNoSlot += o.usadoKg;
      }
    }
    return { usadoKgNoSlot, entregasNoDia };
  }, [diaQuery.data, caminhaoId, periodo]);

  const estouraCaminhao =
    caminhaoEscolhido !== undefined &&
    pesoSelecionado !== null &&
    ocupacaoAtual.usadoKgNoSlot + pesoSelecionado > caminhaoEscolhido.capacidadeKg;

  // Teto de QUANTIDADE de entregas no dia, a outra metade da regra que a
  // Natália pediu (as duas valem juntas). Mesma função do backend.
  const limiteDia = useMemo(
    () =>
      avaliarLimiteEntregas({
        limites: limitesQuery.data ?? [],
        data,
        entregasNoDia: ocupacaoAtual.entregasNoDia,
      }),
    [limitesQuery.data, data, ocupacaoAtual.entregasNoDia],
  );

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

  const bloqueado =
    enviando ||
    faltaCampo ||
    errosQtd.length > 0 ||
    !situacaoPeso.podeAgendar ||
    // O teto de entregas é contagem, não estimativa: se já sabemos que não
    // cabe, não faz sentido deixar clicar para colher o 422.
    !limiteDia.cabe;

  function definirQtd(codigo: string, valor: string): void {
    const n = paraNumero(valor);
    setQuantidades((atual) => ({
      ...atual,
      [codigo]: Number.isFinite(n) ? n : 0,
    }));
  }

  function definirPeso(codigo: string, valor: string): void {
    setPesos((atual) => ({ ...atual, [codigo]: valor }));
  }

  function alternarConfirmacao(codigo: string): void {
    setConfirmados((atual) => {
      const novo = new Set(atual);
      if (novo.has(codigo)) novo.delete(codigo);
      else novo.add(codigo);
      return novo;
    });
  }

  function confirmar(): void {
    if (bloqueado) return;
    // Só o que tem quantidade positiva vai para a viagem.
    const quantidadesEnviadas = Object.fromEntries(
      Object.entries(quantidades).filter(([, q]) => q > 0),
    );
    // Só os pesos que ela realmente digitou, e só dos produtos que vão nesta
    // viagem — mandar o resto mexeria no cadastro sem motivo.
    const pesosEnviados = Object.fromEntries(
      [...pesosInformados].filter(([codigo]) => codigo in quantidadesEnviadas),
    );

    onConfirmar({
      dataAgendada: data,
      periodo,
      motoristaId,
      caminhaoId,
      propriedadeCodigo: exigePropriedade ? propriedadeCodigo : undefined,
      quantidades: quantidadesEnviadas,
      pesos: Object.keys(pesosEnviados).length > 0 ? pesosEnviados : undefined,
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
              const codigo = item.produtoCodigo;
              const valor = quantidades[codigo] ?? 0;
              const excede = valor > item.qtdSaldo;
              const vaiNestaViagem = valor > 0;

              const semPeso = item.pesoUnitKg === null;
              const pesoManual = item.pesoOrigem === 'manual';
              // Campo de peso só para quem precisa: falta o peso, ou é peso da
              // equipe (que pode mudar de lote para lote).
              const pedePeso = vaiNestaViagem && (semPeso || pesoManual);
              const digitado = pesos[codigo] ?? '';
              const pesoValendo = pesosInformados.get(codigo) ?? item.pesoUnitKg;
              const precisaConfirmar = situacaoPeso.aConfirmar.some(
                (c) => c.produtoCodigo === codigo,
              );
              const falta = situacaoPeso.faltando.some(
                (f) => f.produtoCodigo === codigo,
              );
              const quando = dataCurta(item.pesoAtualizadoEm);

              return (
                <li
                  key={codigo}
                  className={`rounded-lg border px-3 py-2 ${
                    falta || precisaConfirmar
                      ? 'border-trigo/50 bg-trigo-claro/40'
                      : 'border-linha bg-creme-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-tinta">
                        {item.nomeProduto || codigo}
                      </p>
                      <p className="text-[11px] text-tinta-suave">
                        restam {formatarQtd(item.qtdSaldo)}
                        {item.qtdComprometida > 0 && (
                          <>
                            {' '}
                            · {formatarQtd(item.qtdComprometida)} já em viagem
                          </>
                        )}
                        {semPeso && (
                          <span className="text-trigo-escuro"> · sem peso</span>
                        )}
                        {!semPeso && pesoManual && (
                          <span className="text-trigo-escuro">
                            {' '}
                            · peso informado pela equipe
                            {quando ? ` em ${quando}` : ''}
                          </span>
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
                      onChange={(e) => definirQtd(codigo, e.target.value)}
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
                      onClick={() => definirQtd(codigo, String(item.qtdSaldo))}
                      title="Levar tudo o que resta deste produto"
                      className="shrink-0 rounded-md border border-linha px-2 py-1 text-[11px] font-semibold text-tinta-suave transition hover:border-mata/30 hover:text-mata"
                    >
                      tudo
                    </button>
                  </div>

                  {pedePeso && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-linha/70 pt-2">
                      <label className="flex items-center gap-2 text-[11px] text-tinta-suave">
                        <span>Peso de 1 unidade</span>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          inputMode="decimal"
                          value={digitado}
                          disabled={enviando}
                          onChange={(e) => definirPeso(codigo, e.target.value)}
                          placeholder={
                            item.pesoUnitKg === null
                              ? ''
                              : String(item.pesoUnitKg)
                          }
                          aria-label={`Peso unitário de ${item.nomeProduto || codigo} em quilos`}
                          className={`w-24 rounded-lg border bg-papel px-2 py-1 text-right text-sm outline-none transition ${
                            falta
                              ? 'border-trigo text-trigo-escuro'
                              : 'border-linha text-tinta focus:border-mata/40'
                          }`}
                        />
                        <span>kg</span>
                      </label>

                      {/* Confirmação: só para peso que a equipe digitou antes.
                          Some quando ela digita um peso novo — aí a conferência
                          já aconteceu. NÃO some ao ser marcado: o checkbox que
                          desaparece no clique deixa a pessoa sem saber se
                          pegou. */}
                      {pesoManual && !semPeso && !pesosInformados.has(codigo) && (
                        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-trigo-escuro">
                          <input
                            type="checkbox"
                            checked={confirmados.has(codigo)}
                            disabled={enviando}
                            onChange={() => alternarConfirmacao(codigo)}
                            className="h-3.5 w-3.5 rounded border-linha text-mata focus:ring-mata/30"
                          />
                          confirmo o peso
                        </label>
                      )}

                      <span className="ml-auto text-[11px] text-tinta-suave">
                        {falta
                          ? 'informe o peso para agendar'
                          : pesoValendo !== null &&
                            `${formatarQtd(valor)} × ${formatarKg(pesoValendo)} = ${formatarT(pesoValendo * valor)}`}
                      </span>
                    </div>
                  )}
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

        {/* O motivo da trava, escrito. O bug que estamos consertando era
            justamente o botão travar (no servidor) sem dizer por quê. */}
        {errosQtd.length === 0 && !situacaoPeso.podeAgendar && (
          <p className="mt-4 rounded-lg border border-trigo/40 bg-trigo-claro px-3 py-2 text-sm text-trigo-escuro">
            {situacaoPeso.faltando.length > 0
              ? `Falta o peso de: ${situacaoPeso.faltando
                  .map((f) => f.nomeProduto || f.produtoCodigo)
                  .join(', ')}. Sem o peso não dá para saber se a carga cabe no caminhão.`
              : `Confira o peso de: ${situacaoPeso.aConfirmar
                  .map((c) => c.nomeProduto || c.produtoCodigo)
                  .join(', ')}. Este peso foi informado pela equipe — confirme ou altere se este lote for diferente.`}
          </p>
        )}

        {estouraCaminhao && errosQtd.length === 0 && (
          <p className="mt-4 rounded-lg border border-trigo/40 bg-trigo-claro px-3 py-2 text-sm text-trigo-escuro">
            Esta carga passa da capacidade do caminhão escolhido
            {ocupacaoAtual.usadoKgNoSlot > 0
              ? `, que já leva ${formatarKg(ocupacaoAtual.usadoKgNoSlot)} neste período`
              : ''}
            . O sistema vai recusar — reduza a quantidade ou escolha outro
            caminhão.
          </p>
        )}

        {/* Teto de entregas do dia: o limite que ela pediu, avisado ANTES do
            clique. Sem janela cadastrada nada aparece — o caminhão segue
            limitado só pela tonelagem, como sempre foi. */}
        {!limiteDia.cabe && (
          <p className="mt-4 rounded-lg border border-terra/40 bg-terra-claro px-3 py-2 text-sm text-terra-escuro">
            Este caminhão já tem {limiteDia.entregasNoDia}{' '}
            {limiteDia.entregasNoDia === 1 ? 'entrega' : 'entregas'} neste dia e
            o limite configurado é {limiteDia.maxEntregasDia} por dia. Escolha
            outro caminhão ou outro dia.
          </p>
        )}

        {limiteDia.cabe &&
          limiteDia.maxEntregasDia !== null &&
          limiteDia.restantes !== null &&
          limiteDia.restantes <= 2 && (
            <p className="mt-4 rounded-lg border border-linha bg-creme-50 px-3 py-2 text-xs text-tinta-suave">
              Cabe {limiteDia.restantes}{' '}
              {limiteDia.restantes === 1 ? 'entrega' : 'entregas'} neste
              caminhão no dia escolhido (limite de {limiteDia.maxEntregasDia}{' '}
              por dia).
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
