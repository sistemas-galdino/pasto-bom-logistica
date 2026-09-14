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
  Pedido,
  PeriodoEntrega,
  Propriedade,
  SaldoItem,
} from '@pastobom/shared';
import {
  avaliarCapacidade,
  avaliarEstoque,
  avaliarLimiteEntregas,
  avaliarPesoAgendamento,
  horasDesde,
  intervaloDaVisao,
  ocupacaoDoCaminhaoNoDia,
  pesoDaCarga,
  validarQuantidades,
} from '@pastobom/shared';
import { api } from '../lib/api';
import { ClimaResumo } from './ClimaResumo';
import { MiniSemanaCaminhao } from './agenda/MiniSemanaCaminhao';
import { SeletorSlot } from './SeletorSlot';

interface Props {
  pedido: Pedido;
  saldo: SaldoItem[];
  enviando: boolean;
  erro: string | null;
  /**
   * Slot já escolhido, quando o modal foi aberto por uma VAGA da tela de
   * Agendamento: quem clicou em "quinta de manhã no Cargo 816" não deve ter de
   * redigitar as três coisas.
   *
   * Aplicado nos INICIALIZADORES de `useState`, sem `useEffect`. Isso vale
   * porque o modal é montado e desmontado a cada abertura (o pai renderiza
   * `{agendando && <AgendarEntregaModal .../>}`). Quem um dia mantiver este
   * modal montado trocando o `slotInicial` precisa dar a ele uma `key` — senão
   * o segundo slot é ignorado em silêncio.
   */
  slotInicial?: {
    data: string;
    periodo: PeriodoEntrega;
    caminhaoId?: string;
  };
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

/**
 * "atualizado agora", "há 2 h", "há 3 dias" — a idade do espelho de estoque.
 *
 * Fica na tela e não no shared porque é pt-BR: a regra pura devolve HORAS
 * (`horasDesde`), e escrever a frase é trabalho de interface.
 */
function textoIdade(horas: number): string {
  if (horas < 1) return 'atualizado agora';
  if (horas < 24) return `há ${Math.floor(horas)} h`;
  const dias = Math.floor(horas / 24);
  return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
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
  slotInicial,
  onCancelar,
  onConfirmar,
}: Props): React.ReactElement {
  // Só o que ainda tem o que entregar entra na tela; item zerado já foi.
  const comSaldo = useMemo(() => saldo.filter((s) => s.qtdSaldo > 0), [saldo]);

  const [data, setData] = useState(slotInicial?.data ?? hojeISO());
  const [periodo, setPeriodo] = useState<PeriodoEntrega>(
    slotInicial?.periodo ?? 'manha',
  );
  const [motoristaId, setMotoristaId] = useState('');
  const [caminhaoId, setCaminhaoId] = useState(slotInicial?.caminhaoId ?? '');
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

  // A lista de caminhões continua aqui, além de dentro do SeletorSlot, porque
  // ESTA tela precisa da CAPACIDADE do caminhão escolhido para avisar que a
  // carga não cabe. Mesma queryKey, mesmo cache: não é uma segunda requisição.
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
  // A janela é o dia inteiro (de = ate) porque os dois números têm escopos
  // diferentes: a tonelagem é por SLOT (dia x turno) e o teto de entregas é por
  // DIA, somando manhã e tarde.
  /**
   * A SEMANA do dia escolhido, e não só o dia.
   *
   * Duas razões: a mini-agenda abaixo mostra a semana do caminhão (pedido dela
   * na reunião de 27/08 — "ao escolher o caminhão, mostrar a agenda daquele
   * caminhão, ao menos a semana"), e a chave passa a ser a MESMA da visão de
   * semana, então quem clicou numa vaga na tela de Agendamento abre este modal
   * com o cache quente.
   *
   * `intervaloDaVisao` LANÇA em data impossível — e o campo é um <input
   * type="date"> em que dá para digitar 31/02. Por isso o try.
   */
  const semana = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
    try {
      return intervaloDaVisao('semana', data);
    } catch {
      return null;
    }
  }, [data]);

  const diaQuery = useQuery({
    queryKey: ['agenda', semana?.inicio ?? '', semana?.fim ?? ''],
    queryFn: ({ signal }) =>
      api.agenda(semana?.inicio ?? '', semana?.fim ?? '', signal),
    enabled: semana !== null,
  });

  const limitesQuery = useQuery({
    queryKey: ['limites-caminhao', caminhaoId],
    queryFn: ({ signal }) => api.limitesDoCaminhao(caminhaoId, signal),
    enabled: caminhaoId !== '',
  });

  // PREVISÃO DO TEMPO para a data e a propriedade escolhidas.
  //
  // Isto já existiu e se perdeu no commit 7343f9a (27/07/2026), que substituiu
  // o TransicaoModal por este modal — o backend nunca saiu do ar, só o
  // chamador. A Natália notou a falta em 11/09: "conforme a cidade que aquele
  // cliente está cadastrado, ele mostre pra gente a previsão do tempo daquele
  // dia... é que no começo você tinha colocado".
  //
  // A rota dá prioridade à data ESCOLHIDA sobre a salva, exatamente para este
  // preview. O serviço nunca lança: falha vira `disponivel: false` com motivo, e
  // o ClimaResumo já sabe dizer cada um deles.
  const climaQuery = useQuery({
    queryKey: ['clima', pedido.id, data, propriedadeCodigo],
    queryFn: ({ signal }) =>
      api.climaPedido(
        pedido.id,
        data,
        propriedadeCodigo.trim() || undefined,
        signal,
      ),
    enabled: data.trim().length > 0,
    staleTime: 30 * 60 * 1000,
  });

  /**
   * ESTOQUE dos produtos deste pedido — pedido da Natália na reunião de 27/08:
   * "é a quantidade de produto que vai me falar se eu tenho aquele produto para
   * entregar para aquele cliente ou não".
   *
   * É AVISO, JAMAIS BLOQUEIO — ela foi explícita, e `bloqueado` abaixo não
   * olha para cá. Travar o agendamento por estoque pararia a operação num ERP
   * que erra cadastro.
   *
   * A chave depende só dos CÓDIGOS, não das quantidades digitadas: o estoque do
   * produto não muda porque a pessoa mudou quanto vai mandar, e pôr a
   * quantidade na chave faria uma requisição por tecla.
   */
  const codigosEstoque = useMemo(
    () => comSaldo.map((s) => s.produtoCodigo).sort(),
    [comSaldo],
  );
  const codigosEstoqueKey = codigosEstoque.join(',');

  const estoqueQuery = useQuery({
    queryKey: ['estoque', codigosEstoqueKey],
    queryFn: ({ signal }) => api.estoqueProdutos(codigosEstoque, signal),
    enabled: codigosEstoque.length > 0,
    // O espelho roda a cada 3 h; 5 min de cache poupa a consulta a cada
    // reabertura do modal sem deixar o número envelhecer de forma perceptível.
    staleTime: 5 * 60 * 1000,
  });
  const estoquePorProduto = estoqueQuery.data ?? {};

  /**
   * Ocupação do caminhão escolhido: kg no turno e nº de entregas NO DIA.
   *
   * A REGRESSÃO QUE ESTA LINHA EVITA: isto já foi um laço aqui dentro que
   * somava `o.entregas` de TODOS os slots da resposta. Enquanto a consulta era
   * de um dia só (de = ate) dava no mesmo; agora que ela traz a semana, somar
   * tudo faria `entregasNoDia` virar "entregas na semana" e o teto começaria a
   * recusar agendamento legítimo, em silêncio, com uma mensagem que parece
   * correta. `ocupacaoDoCaminhaoNoDia` filtra por `slot.data`, e existe um
   * teste no shared só para isso.
   */
  const ocupacaoAtual = useMemo(
    () =>
      ocupacaoDoCaminhaoNoDia(diaQuery.data?.slots ?? [], {
        data,
        caminhaoId,
        periodo,
      }),
    [diaQuery.data, data, caminhaoId, periodo],
  );

  // Como o caminhão fica com esta viagem dentro. A MESMA função que a agenda
  // usa para pintar as barras — desde 27/08/2026 esta comparação é a informação
  // que decide, não mais uma trava, e ela não pode existir em duas versões.
  const capacidade = useMemo(
    () =>
      avaliarCapacidade({
        capacidadeKg: caminhaoEscolhido?.capacidadeKg ?? 0,
        usadoKg: ocupacaoAtual.usadoKgNoSlot,
        adicionalKg: pesoSelecionado ?? 0,
      }),
    [caminhaoEscolhido, ocupacaoAtual.usadoKgNoSlot, pesoSelecionado],
  );

  /** Só há o que sinalizar quando se sabe o caminhão E o peso da carga. */
  const mostraCapacidade =
    caminhaoEscolhido !== undefined && pesoSelecionado !== null;

  // Teto de QUANTIDADE de entregas no dia. Desde 27/08/2026 é a única regra que
  // recusa agendamento. Mesma função do backend.
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
    //
    // O PESO NÃO ENTRA AQUI, e isso é a decisão da Natália de 27/08/2026, não
    // um esquecimento: "que ele não seja um impeditivo de agendamento, mas que
    // ele sinalize". Passar da capacidade pinta a linha de peso e mostra o
    // aviso — e deixa agendar.
    //
    // O ESTOQUE TAMBÉM NÃO ENTRA, pela mesma decisão e por um motivo a mais: o
    // número vem de um ERP que erra cadastro e de um espelho que pode estar
    // horas atrasado. Bloquear com base nisso pararia a operação por causa de
    // um dado que a própria tela apresenta com ressalva ("há 5 h").
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

              // ESTOQUE: aviso, nunca bloqueio. `null` (produto não espelhado,
              // código que não casa, item de serviço) é "não sei" e não avisa.
              const estoque = estoquePorProduto[codigo] ?? null;
              const situacaoEstoque = avaliarEstoque({
                quantidadeEstoque: estoque?.quantidade ?? null,
                quantidadePedida: valor,
              });
              const idadeEstoque = horasDesde(estoque?.atualizadoEm, Date.now());

              return (
                <li
                  key={codigo}
                  // `trigo` é pendência que TRAVA (falta peso, falta conferir);
                  // `terra` é "passou do que tem, mas não impede" — a mesma
                  // semântica que a capacidade do caminhão já usa nesta tela.
                  // Cores diferentes porque as ações são diferentes: uma pede
                  // para digitar, a outra pede para conferir antes de mandar.
                  className={`rounded-lg border px-3 py-2 ${
                    falta || precisaConfirmar
                      ? 'border-trigo/50 bg-trigo-claro/40'
                      : situacaoEstoque.avisar
                        ? 'border-terra/40 bg-terra-claro/40'
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

                      {/* O AVISO DE ESTOQUE, com a IDADE do dado junto.
                          "estoque 40" sem idade é um palpite com cara de fato:
                          o espelho roda a cada 3 h e o Órix fica fora à noite,
                          então um número de ontem precisa se apresentar como
                          tal — senão o aviso vira falso alarme e perde a
                          credibilidade que ele existe para ter. */}
                      {situacaoEstoque.avisar && estoque !== null && (
                        <p className="mt-0.5 text-[11px] font-semibold text-terra-escuro">
                          {situacaoEstoque.nivel === 'negativo'
                            ? `Estoque negativo: ${formatarQtd(estoque.quantidade)}`
                            : `Estoque: ${formatarQtd(estoque.quantidade)}${
                                estoque.unidade ? ` ${estoque.unidade}` : ''
                              } — você está mandando ${formatarQtd(valor)}`}
                          {idadeEstoque !== null && (
                            <span className="font-normal text-tinta-suave">
                              {' '}
                              ({textoIdade(idadeEstoque)})
                            </span>
                          )}
                        </p>
                      )}
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

          {/* O SINALIZADOR. Desde 27/08/2026 é isto que a Natália pediu no
              lugar da trava: "que ele sinalize se aquele caminhão já tá lotado
              ou não". Por isso a linha diz como o caminhão FICA, e não só
              quanto pesa esta viagem — o número que decide é o total do turno.

              Cor `terra` e não `brasa`: brasa é a cor de impedimento no
              projeto (erro de quantidade, "não realizado"), e passar da
              capacidade deixou de impedir. */}
          <div className="mt-2 flex items-baseline justify-between gap-3 text-xs">
            <span className="shrink-0 text-tinta-suave">Peso desta viagem</span>
            <span
              className={`text-right font-display font-semibold ${
                !mostraCapacidade
                  ? 'text-mata-escuro'
                  : capacidade.nivel === 'excedido'
                    ? 'text-terra-escuro'
                    : capacidade.nivel === 'cheio'
                      ? 'text-trigo-escuro'
                      : 'text-mata-escuro'
              }`}
            >
              {pesoSelecionado === null
                ? 'peso desconhecido'
                : formatarT(pesoSelecionado)}
              {mostraCapacidade && caminhaoEscolhido && (
                <span className="font-normal">
                  {' · '}o caminhão fica com {formatarT(capacidade.totalKg)} de{' '}
                  {formatarT(caminhaoEscolhido.capacidadeKg)}
                </span>
              )}
            </span>
          </div>
        </div>

        {/* Quando e com quem — os MESMOS seletores da reserva de caminhão
            (SeletorSlot). A propriedade de entrega entra como campo extra
            DENTRO da grade dele: é específica do agendamento, mas precisa
            continuar alinhada com os outros quatro. */}
        <SeletorSlot
          className="mt-4"
          data={data}
          periodo={periodo}
          motoristaId={motoristaId}
          caminhaoId={caminhaoId}
          onData={setData}
          onPeriodo={setPeriodo}
          onMotorista={setMotoristaId}
          onCaminhao={setCaminhaoId}
          desabilitado={enviando}
        >
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
        </SeletorSlot>

        {/* A SEMANA DO CAMINHÃO, quando já se sabe qual é. Pedido dela:
            "ao escolher o caminhão, mostrar a agenda daquele caminhão, ao menos
            a semana" — para não empilhar tudo na terça com a quinta vazia.
            Os slots vão INTEIROS: quem filtra por caminhão é a regra pura, e
            filtrar antes esconderia justamente os dias livres. */}
        {caminhaoId !== '' && semana !== null && (
          <div className="mt-3">
            <MiniSemanaCaminhao
              dias={semana.dias}
              slots={diaQuery.data?.slots ?? []}
              limites={diaQuery.data?.limites ?? []}
              caminhaoId={caminhaoId}
              dataEscolhida={data}
              carregando={diaQuery.isLoading}
            />
          </div>
        )}

        {/* Fora do SeletorSlot de propósito: o cabeçalho dele diz que ali só
            moram os CAMPOS do slot, e ele é compartilhado com a reserva de
            caminhão, que não tem cliente nem previsão. Como `children` isto
            viraria a 5ª célula da grade de 2 colunas, colada no select de
            caminhão. */}
        {data.trim() !== '' && (
          <div className="mt-3">
            <ClimaResumo
              variant="completo"
              previsao={climaQuery.data}
              carregando={climaQuery.isLoading}
            />
          </div>
        )}

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
                  .join(', ')}. Sem ele esta viagem entra na agenda pesando zero e o caminhão vai parecer mais vazio do que está.`
              : `Confira o peso de: ${situacaoPeso.aConfirmar
                  .map((c) => c.nomeProduto || c.produtoCodigo)
                  .join(', ')}. Este peso foi informado pela equipe — confirme ou altere se este lote for diferente.`}
          </p>
        )}

        {/* AVISO DE CAPACIDADE — não bloqueia. Este texto já disse "O sistema
            vai recusar"; virou mentira em 27/08/2026 e foi reescrito. Se
            alguém voltar a fazer o peso recusar, é aqui e no `bloqueado` que a
            mudança aparece. */}
        {mostraCapacidade &&
          capacidade.nivel === 'excedido' &&
          errosQtd.length === 0 &&
          caminhaoEscolhido && (
            <p className="mt-4 rounded-lg border border-terra/40 bg-terra-claro px-3 py-2 text-sm text-terra-escuro">
              Caminhão lotado: o {caminhaoEscolhido.nome} comporta{' '}
              {formatarT(caminhaoEscolhido.capacidadeKg)} e ficaria com{' '}
              {formatarT(capacidade.totalKg)} neste período — passa{' '}
              {formatarT(capacidade.excedenteKg)}. Dá para agendar assim mesmo;
              confira a carga antes de mandar o caminhão.
            </p>
          )}

        {mostraCapacidade &&
          capacidade.nivel === 'cheio' &&
          errosQtd.length === 0 &&
          caminhaoEscolhido && (
            <p className="mt-4 rounded-lg border border-linha bg-creme-50 px-3 py-2 text-xs text-tinta-suave">
              Este caminhão fecha a capacidade neste período:{' '}
              {formatarT(capacidade.totalKg)} de{' '}
              {formatarT(caminhaoEscolhido.capacidadeKg)}. Ainda dá para
              agendar.
            </p>
          )}

        {/* Teto de entregas do dia: desde 27/08/2026 é a ÚNICA regra que recusa
            agendamento de cliente. Sem janela cadastrada não aparece nada aqui
            — e aí o caminhão não tem trava nenhuma, que é o que a nota logo
            abaixo diz com todas as letras. */}
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

        {/* O buraco que a decisão de 27/08 abriu, dito na cara. Até então a
            tonelagem segurava o caminhão sem janela cadastrada; agora não
            segura mais nada. Inventar um teto padrão seria pior — passaria a
            recusar agendamento com um número que ninguém configurou. */}
        {caminhaoId !== '' &&
          !limitesQuery.isLoading &&
          limiteDia.maxEntregasDia === null && (
            <p className="mt-4 rounded-lg border border-linha bg-creme-50 px-3 py-2 text-xs text-tinta-suave">
              Este caminhão não tem teto de entregas por dia cadastrado — nada
              limita a quantidade de viagens dele. Confira a carga pela linha de
              peso acima antes de confirmar.
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
