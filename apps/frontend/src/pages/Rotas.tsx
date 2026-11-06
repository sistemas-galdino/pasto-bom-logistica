// Página de ROTA — o dia de cada motorista, num bloco só por motorista: o
// resumo (viagens por status, toneladas, onde ele está) e, logo abaixo, as
// entregas que ele leva na estrada NESTE momento, na sequência de paradas que
// ele informou.
//
// Ela já teve uma segunda aba, "Agenda do caminhão". Em 09/2026 essa aba virou
// a página /agendamento: a Natália pediu o menu na ordem do processo, e as duas
// respondem a perguntas diferentes — esta é "onde ele está AGORA?" (a pergunta
// do telefone tocando), a outra é "o que ainda vai acontecer?" (planejamento, e
// agora também o lugar de agendar).
//
// Em 06/11/2026 ela absorveu a antiga tela de Motoristas, que somava PEDIDOS em
// rota — e desde a Onda 2 o pedido nunca fica em rota (quem anda é a viagem),
// então mostrava zero para todo mundo. O resumo e a lista em rota ficaram
// primeiro em duas seções; a Natália pediu tudo junto, por motorista.
//
// A ORDEM DAS PARADAS (item 11 da Natália) aparece aqui SOMENTE LEITURA: quem
// informa é o motorista, na Rota do dia, porque é ele que acabou de descarregar
// e conhece a estrada. Esta tela é o outro lado do pedido — a logística ver, ao
// ligar para o cliente, em que posição da rota ele está.

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarDays, MapPin, Users } from 'lucide-react';
import { ordenarParadas } from '@pastobom/shared';
import type { Entrega } from '@pastobom/shared';
import { api } from '../lib/api';
import { hojeLocal, isoDeData } from '../lib/datas';
import { emToneladas } from '../lib/format';
import { EntregaCard } from '../components/EntregaCard';
import { pilulaFiltro } from '../lib/pilula';

const SEM_MOTORISTA = 'Sem motorista';

interface BlocoMotorista {
  /** Id do motorista; o nome quando a viagem não tem motorista. */
  chave: string;
  nome: string;
  agendadas: number;
  emRota: number;
  entregues: number;
  naoRealizadas: number;
  /** Reservas do dia dadas como feitas (0026): contam como viagem. */
  reservas: number;
  /** Peso do dia (todas as viagens que não foram canceladas). */
  pesoKg: number;
  /** Entregas na estrada agora, na ordem das paradas. */
  naEstrada: Entrega[];
}

function totalDoDia(b: BlocoMotorista): number {
  return b.agendadas + b.emRota + b.entregues + b.naoRealizadas + b.reservas;
}

function PainelRota(): React.ReactElement {
  const hoje = isoDeData(hojeLocal());

  // null = "Todos os motoristas". Guarda a CHAVE do bloco.
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const motoristasQuery = useQuery({
    queryKey: ['motoristas'],
    queryFn: ({ signal }) => api.listarMotoristas(signal),
  });

  // O dia inteiro (todos os status) mais o que está na estrada de dias
  // anteriores — caminhão em rota com data de ontem é viagem em curso.
  const doDiaQuery = useQuery({
    queryKey: ['entregas', 'do-dia', hoje],
    queryFn: ({ signal }) => api.listarEntregas({ de: hoje, ate: hoje }, signal),
    refetchInterval: 60_000,
  });
  // Rotas lista VIAGENS em rota: o mesmo pedido em dois caminhões aparece nas
  // duas rotas, cada uma com a sua parte da carga.
  const emRotaQuery = useQuery({
    queryKey: ['entregas', 'em-rota'],
    queryFn: ({ signal }) => api.listarEntregas({ status: ['em_rota'] }, signal),
    refetchInterval: 60_000,
  });

  // Reservas do dia: só as CONCLUÍDAS entram na conta do motorista (06/11).
  // Acessório — se falhar, os blocos seguem só com as entregas.
  const reservasQuery = useQuery({
    queryKey: ['reservas-dia', hoje],
    queryFn: ({ signal }) => api.listarReservas({ de: hoje, ate: hoje }, signal),
    refetchInterval: 60_000,
  });

  const blocos = useMemo<BlocoMotorista[]>(() => {
    const porId = new Map<string, Entrega>();
    for (const e of doDiaQuery.data ?? []) porId.set(e.id, e);
    for (const e of emRotaQuery.data ?? []) porId.set(e.id, e);

    // O nome vem do cadastro quando houver; a viagem também traz o nome, e é
    // ele que vale se o cadastro não carregou (papel sem leitura).
    const nomes = new Map(
      (motoristasQuery.data ?? []).map((m) => [m.id, m.nome] as const),
    );

    const mapa = new Map<string, BlocoMotorista>();
    const blocoDe = (motoristaId: string | null, nomeNaViagem: string | null) => {
      const chave = motoristaId ?? SEM_MOTORISTA;
      let b = mapa.get(chave);
      if (!b) {
        b = {
          chave,
          nome: motoristaId
            ? (nomes.get(motoristaId) ?? nomeNaViagem ?? 'Sem nome')
            : SEM_MOTORISTA,
          agendadas: 0,
          emRota: 0,
          entregues: 0,
          naoRealizadas: 0,
          reservas: 0,
          pesoKg: 0,
          naEstrada: [],
        };
        mapa.set(chave, b);
      }
      return b;
    };

    for (const r of reservasQuery.data ?? []) {
      if (!r.concluidaEm || !r.motoristaId) continue;
      const b = blocoDe(r.motoristaId, r.motoristaNome);
      b.reservas += 1;
      b.pesoKg += r.pesoPrevistoKg ?? 0;
    }

    for (const e of porId.values()) {
      // Cancelada não é trabalho do dia; o card do restante recusado não é viagem.
      if (e.status === 'cancelada' || e.encerraSaldo) continue;
      const b = blocoDe(e.motoristaId, e.motoristaNome);
      if (e.status === 'agendada') b.agendadas += 1;
      else if (e.status === 'em_rota') {
        b.emRota += 1;
        b.naEstrada.push(e);
      } else if (e.status === 'entregue') b.entregues += 1;
      else if (e.status === 'nao_realizado') b.naoRealizadas += 1;
      b.pesoKg += e.pesoTotalKg ?? 0;
    }

    // Mesma função da tela do motorista: a logística lê a rota na sequência
    // que ELE informou, não em ordem de banco — senão as duas telas
    // divergiriam e a pergunta "onde ele está?" teria duas respostas.
    for (const b of mapa.values()) b.naEstrada = ordenarParadas(b.naEstrada);

    // Só quem tem viagem no dia (06/11): motorista sem nada só ocupava espaço.
    // Quem está na estrada vem primeiro; "Sem motorista" sempre por último.
    return [...mapa.values()]
      .filter((b) => totalDoDia(b) > 0)
      .sort((a, b) => {
        if (a.chave === SEM_MOTORISTA) return 1;
        if (b.chave === SEM_MOTORISTA) return -1;
        return (
          Number(b.emRota > 0) - Number(a.emRota > 0) ||
          a.nome.localeCompare(b.nome, 'pt-BR')
        );
      });
  }, [motoristasQuery.data, doDiaQuery.data, emRotaQuery.data, reservasQuery.data]);

  // Filtro EFETIVO: se o motorista escolhido sumiu (o dia virou, por exemplo),
  // cai de volta para "Todos" em vez de mostrar uma tela vazia. Derivado na
  // renderização para não piscar vazio antes do efeito.
  const filtroAtivo =
    selecionado !== null && blocos.some((b) => b.chave === selecionado)
      ? selecionado
      : null;

  // Sincroniza o estado com o filtro efetivo, senão o motorista voltaria a ser
  // filtrado sozinho caso reaparecesse num refetch posterior.
  useEffect(() => {
    if (selecionado !== null && filtroAtivo === null) setSelecionado(null);
  }, [selecionado, filtroAtivo]);

  const visiveis = useMemo(
    () =>
      filtroAtivo === null ? blocos : blocos.filter((b) => b.chave === filtroAtivo),
    [blocos, filtroAtivo],
  );

  const naEstrada = blocos.filter((b) => b.emRota > 0).length;

  if (doDiaQuery.isLoading || emRotaQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-tinta-suave">
        Carregando rotas…
      </div>
    );
  }

  if (doDiaQuery.isError || emRotaQuery.isError) {
    const erro = doDiaQuery.error ?? emRotaQuery.error;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-tinta-suave">
        <p>
          {erro instanceof Error ? erro.message : 'Não foi possível carregar as rotas.'}
        </p>
        <button
          type="button"
          onClick={() => {
            void doDiaQuery.refetch();
            void emRotaQuery.refetch();
          }}
          className="rounded-lg border border-linha bg-papel px-3 py-1.5 text-xs font-semibold text-tinta-suave hover:border-mata/30 hover:text-mata"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scroll-suave">
      <div className="w-full space-y-6 p-4 animate-sobe sm:p-6 lg:p-8">
        {blocos.length === 0 ? (
          <p className="py-16 text-center text-sm text-tinta-suave">
            Nenhum motorista com viagem hoje.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div
                role="group"
                aria-label="Filtrar por motorista"
                className="flex flex-wrap items-center gap-2"
              >
                <button
                  type="button"
                  onClick={() => setSelecionado(null)}
                  aria-pressed={filtroAtivo === null}
                  className={pilulaFiltro(filtroAtivo === null)}
                >
                  Todos os motoristas ({blocos.length})
                </button>
                {blocos.map((b) => (
                  <button
                    key={b.chave}
                    type="button"
                    onClick={() => setSelecionado(b.chave)}
                    aria-pressed={filtroAtivo === b.chave}
                    className={pilulaFiltro(filtroAtivo === b.chave)}
                  >
                    {b.nome} ({totalDoDia(b)})
                  </button>
                ))}
              </div>
              <span className="text-xs text-tinta-suave">
                {naEstrada === 1 ? '1 na estrada' : `${naEstrada} na estrada`}
              </span>
            </div>

            {visiveis.map((b) => (
              <BlocoDoMotorista key={b.chave} bloco={b} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/** Um motorista: o resumo do dia em cima e as entregas na estrada embaixo. */
function BlocoDoMotorista({ bloco: b }: { bloco: BlocoMotorista }): React.ReactElement {
  const agora = b.naEstrada[0] ?? null;
  // Nenhuma parada sequenciada: o recado vai UMA vez, no cabeçalho, e os
  // cartões não repetem "sem sequência" n vezes. Rota mista (algumas
  // informadas) é o oposto: aí cada cartão precisa dizer se está na fila.
  const semSequencia = b.naEstrada.every((p) => p.ordemRota === null);

  return (
    <section className="rounded-xl2 border border-linha bg-papel p-4 shadow-carta sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-folha-claro text-mata">
            <Users className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg font-semibold text-mata-escuro">
              {b.nome}
            </h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-tinta-suave">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-pedra" aria-hidden="true" />
              <span className="truncate">
                {agora
                  ? `Agora: ${agora.clienteNome || agora.clienteCodigo}${
                      agora.cidadeCliente ? ` · ${agora.cidadeCliente}` : ''
                    }`
                  : b.agendadas > 0
                    ? 'Ainda não saiu'
                    : 'Rota do dia concluída'}
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
          <span className="rounded-full bg-folha-claro px-2.5 py-0.5 text-mata">
            {b.agendadas} agendada{b.agendadas === 1 ? '' : 's'}
          </span>
          <span className="rounded-full bg-trigo-claro px-2.5 py-0.5 text-trigo-escuro">
            {b.emRota} em rota
          </span>
          <span className="rounded-full bg-mata-claro px-2.5 py-0.5 text-mata-escuro">
            {b.entregues} entregue{b.entregues === 1 ? '' : 's'}
          </span>
          {b.naoRealizadas > 0 && (
            <span className="rounded-full bg-brasa-claro px-2.5 py-0.5 text-brasa-escuro">
              {b.naoRealizadas} não realizada{b.naoRealizadas === 1 ? '' : 's'}
            </span>
          )}
          {/* Tracejado como o card de reserva: é viagem do motorista, mas não
              é entrega a cliente. */}
          {b.reservas > 0 && (
            <span className="rounded-full border border-dashed border-pedra bg-limao-claro px-2.5 py-0.5 text-limao-escuro">
              {b.reservas} reserva{b.reservas === 1 ? '' : 's'}
            </span>
          )}
          {/* Peso, não dinheiro: a viagem carrega parte do pedido, e o que
              importa para quem olha a rota é quanto o caminhão leva no dia. */}
          {b.pesoKg > 0 && (
            <span className="ml-1 text-sm font-bold text-tinta">
              {emToneladas(b.pesoKg)} t
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-linha pt-4">
        {b.naEstrada.length === 0 ? (
          <p className="text-xs text-tinta-suave">Nenhuma entrega na estrada agora.</p>
        ) : (
          <>
            {/*
              Aviso neutro quando NINGUÉM sequenciou: não é falha nem pendência
              da logística — é só o motorista que ainda não informou.
            */}
            {semSequencia && (
              <p className="mb-3 text-xs text-pedra">
                Sem sequência definida — o motorista ainda não informou a ordem
                das paradas.
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {b.naEstrada.map((p) => (
                <div key={p.id} className="flex flex-col">
                  {/*
                    A posição vem ACIMA do cartão em vez de dentro dele: o
                    EntregaCard é compartilhado com o quadro e com a agenda,
                    onde "parada 2" não significa nada.
                  */}
                  {!semSequencia && (
                    <div className="mb-1.5 flex items-center gap-2">
                      {p.ordemRota !== null ? (
                        <>
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-mata font-display text-xs font-bold text-creme-50">
                            {p.ordemRota}
                          </span>
                          <span className="text-xs font-semibold text-tinta-suave">
                            {p.ordemRota}ª parada
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-pedra">Sem sequência definida</span>
                      )}
                    </div>
                  )}
                  <EntregaCard
                    entrega={p}
                    podeEscrever={false}
                    podeSeparar={false}
                    onTransicionar={() => {}}
                    onSeparar={() => {}}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// A página
// ---------------------------------------------------------------------------

export function Rotas(): React.ReactElement {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* PONTE para quem decorou o caminho antigo. A agenda do caminhão era a
          aba 2 desta tela até 09/2026; quem usa o sistema todo dia vai clicar
          em "Rota" procurando por ela. Não cabe redirect: a aba vivia em
          `useState`, nunca teve URL própria.

          remover após ~2 meses (≈11/2026). */}
      <div className="flex items-center gap-2 border-b border-linha bg-creme-50/70 px-4 py-2 text-xs text-tinta-suave sm:px-6">
        <CalendarDays className="h-3.5 w-3.5 text-pedra" aria-hidden="true" />
        <span>
          A agenda do caminhão virou uma tela só dela:{' '}
          <Link
            to="/agendamento"
            className="font-semibold text-mata hover:underline"
          >
            Agendamento
          </Link>
          .
        </span>
      </div>

      <div className="min-h-0 flex-1">
        <PainelRota />
      </div>
    </div>
  );
}
