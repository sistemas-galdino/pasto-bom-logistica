// Página de AGENDA: calendário de entregas em mês / semana / dia.
//
// O domínio é SLOT = (data + período manhã/tarde) — a reunião de 25/06 decidiu
// planejar por turno, nunca por horário. Por isso não há timeline: cada dia se
// parte em dois blocos, e o que interessa em cada bloco é quanto de carga já
// está em cada caminhão (é assim que o vendedor decide se "cabe mais uma").
//
// SOMENTE LEITURA para todos os papéis: quem agenda é a logística, no quadro.
//
// Fuso: as datas vêm como 'YYYY-MM-DD'. Toda conversão passa por dataDeIso/
// isoDeData (Date local) — `new Date('YYYY-MM-DD')` viraria UTC e volta um dia.
//
// Os componentes do calendário moram em components/agenda/: a tela de Rota
// mostra as MESMAS visões do mesmo GET /api/agenda, e duplicá-las seria garantir
// que as duas telas divergissem na primeira correção. Aqui ficou só a montagem:
// a busca, o estado da visão/âncora e o mapa de slots.

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import type { AgendaSlot } from '@pastobom/shared';
import { api } from '../lib/api';
import { EntregaDetalheModal } from '../components/EntregaDetalheModal';
import {
  chaveSlot,
  NavegadorPeriodo,
  VisaoDia,
  VisaoMes,
  VisaoSemana,
} from '../components/agenda';
import type { Visao } from '../components/agenda';
import {
  addDias,
  addMeses,
  capitalizar,
  hojeLocal,
  inicioDaSemana,
  isoDeData,
} from '../lib/datas';

// --- datas (sempre locais; nunca `new Date('YYYY-MM-DD')`) -----------------

interface Intervalo {
  inicio: Date;
  fim: Date;
  dias: Date[];
}

function intervaloDaVisao(visao: Visao, ancora: Date): Intervalo {
  if (visao === 'dia') {
    return { inicio: ancora, fim: ancora, dias: [ancora] };
  }

  let inicio: Date;
  let fim: Date;
  if (visao === 'semana') {
    inicio = inicioDaSemana(ancora);
    fim = addDias(inicio, 6);
  } else {
    const primeiro = new Date(ancora.getFullYear(), ancora.getMonth(), 1);
    const ultimo = new Date(ancora.getFullYear(), ancora.getMonth() + 1, 0);
    inicio = inicioDaSemana(primeiro);
    fim = addDias(inicioDaSemana(ultimo), 6);
  }

  const dias: Date[] = [];
  for (let d = inicio; d <= fim; d = addDias(d, 1)) {
    dias.push(d);
  }
  return { inicio, fim, dias };
}

function tituloDoPeriodo(
  visao: Visao,
  intervalo: Intervalo,
  ancora: Date,
): string {
  if (visao === 'dia') {
    return capitalizar(
      ancora.toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }),
    );
  }
  if (visao === 'semana') {
    const curto = (d: Date) =>
      d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return `${curto(intervalo.inicio)} – ${curto(intervalo.fim)} de ${intervalo.fim.getFullYear()}`;
  }
  return capitalizar(
    ancora.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
  );
}

export default function Agenda(): React.ReactElement {
  const [visao, setVisao] = useState<Visao>('semana');
  const [ancora, setAncora] = useState<Date>(() => hojeLocal());

  const intervalo = useMemo(
    () => intervaloDaVisao(visao, ancora),
    [visao, ancora],
  );
  const de = isoDeData(intervalo.inicio);
  const ate = isoDeData(intervalo.fim);

  // Viagem cujo detalhe está aberto. A busca é sob demanda, dentro do modal.
  const [detalheId, setDetalheId] = useState<string | null>(null);

  const agendaQuery = useQuery({
    queryKey: ['agenda', de, ate],
    queryFn: ({ signal }) => api.agenda(de, ate, signal),
  });

  const porSlot = useMemo(() => {
    const mapa = new Map<string, AgendaSlot>();
    for (const slot of agendaQuery.data?.slots ?? []) {
      mapa.set(chaveSlot(slot.data, slot.periodo), slot);
    }
    return mapa;
  }, [agendaQuery.data]);

  const totalEntregas = (agendaQuery.data?.slots ?? []).reduce(
    (s, slot) => s + slot.entregas.length,
    0,
  );
  // As reservas contam separado: elas não são entrega, mas OCUPAM o período, e
  // é por isso que o aviso de vazio abaixo tem de olhar as duas coisas.
  const totalReservas = (agendaQuery.data?.slots ?? []).reduce(
    (s, slot) => s + slot.reservas.length,
    0,
  );

  const isoHoje = isoDeData(hojeLocal());
  const titulo = tituloDoPeriodo(visao, intervalo, ancora);

  function navegar(passo: -1 | 1) {
    if (visao === 'dia') setAncora((a) => addDias(a, passo));
    else if (visao === 'semana') setAncora((a) => addDias(a, passo * 7));
    else setAncora((a) => addMeses(a, passo));
  }

  return (
    <div className="flex h-full flex-col">
      <NavegadorPeriodo
        visao={visao}
        titulo={titulo}
        totalEntregas={totalEntregas}
        totalReservas={totalReservas}
        atualizando={agendaQuery.isFetching}
        onNavegar={navegar}
        onHoje={() => setAncora(hojeLocal())}
        onVisao={setVisao}
      />

      <main className="flex-1 overflow-auto scroll-suave">
        {agendaQuery.isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-tinta-suave">
            Carregando agenda…
          </div>
        ) : agendaQuery.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-tinta-suave">
            <p>
              {agendaQuery.error instanceof Error
                ? agendaQuery.error.message
                : 'Não foi possível carregar a agenda.'}
            </p>
            <button
              type="button"
              onClick={() => void agendaQuery.refetch()}
              className="rounded-lg border border-linha bg-papel px-3 py-1.5 text-xs font-semibold text-tinta-suave hover:border-mata/30 hover:text-mata"
            >
              Tentar novamente
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-[1600px] space-y-4 p-4 animate-sobe sm:p-6">
            {/* Só é "nenhuma entrega" quando também não há RESERVA. Contar só
                entregas fazia o período da oficina exibir o aviso de vazio e,
                logo embaixo, os cards da reserva — a mesma armadilha que o
                BlocoSlot já resolve um nível abaixo, reaparecendo aqui. */}
            {totalEntregas === 0 && totalReservas === 0 && (
              <p className="flex items-center justify-center gap-2 rounded-xl2 border border-dashed border-linha bg-papel/60 py-6 text-sm text-tinta-suave">
                <CalendarDays
                  className="h-4 w-4 text-pedra"
                  aria-hidden="true"
                />
                Nenhuma entrega agendada neste período.
              </p>
            )}

            {visao === 'mes' && (
              <VisaoMes
                dias={intervalo.dias}
                mesAtual={ancora.getMonth()}
                isoHoje={isoHoje}
                porSlot={porSlot}
              />
            )}

            {visao === 'semana' && (
              <VisaoSemana
                dias={intervalo.dias}
                isoHoje={isoHoje}
                porSlot={porSlot}
                onAbrir={setDetalheId}
              />
            )}

            {visao === 'dia' && (
              <VisaoDia
                data={isoDeData(ancora)}
                porSlot={porSlot}
                onAbrir={setDetalheId}
              />
            )}
          </div>
        )}
      </main>

      {detalheId !== null && (
        <EntregaDetalheModal
          entregaId={detalheId}
          onFechar={() => setDetalheId(null)}
        />
      )}
    </div>
  );
}
