// Página de MOTORISTAS: lista os motoristas cadastrados com um resumo das
// entregas em rota (quantidade + valor total) atribuídas a cada um.
//
// Combina a lista de motoristas com a query ['pedidos'] (mesma do quadro),
// agregando client-side apenas os pedidos em rota. Modo leitura.

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Truck, Users } from 'lucide-react';
import { api } from '../lib/api';
import { formatarMoeda } from '../lib/format';
import { TODOS_STATUS } from '../components/status';

interface ResumoMotorista {
  entregas: number;
  valor: number;
}

export function Motoristas(): React.ReactElement {
  const motoristasQuery = useQuery({
    queryKey: ['motoristas'],
    queryFn: ({ signal }) => api.listarMotoristas(signal),
  });

  const pedidosQuery = useQuery({
    queryKey: ['pedidos'],
    queryFn: ({ signal }) => api.listarPedidos(TODOS_STATUS, signal),
    refetchInterval: 60_000,
  });

  const porMotorista = useMemo(() => {
    const mapa = new Map<string, ResumoMotorista>();
    for (const p of pedidosQuery.data ?? []) {
      if (p.statusLogistico !== 'em_rota' || !p.motoristaId) continue;
      const atual = mapa.get(p.motoristaId) ?? { entregas: 0, valor: 0 };
      atual.entregas += 1;
      atual.valor += p.valorTotal;
      mapa.set(p.motoristaId, atual);
    }
    return mapa;
  }, [pedidosQuery.data]);

  const motoristas = motoristasQuery.data ?? [];
  // Só a lista de motoristas derruba a página: o resumo vem de ['pedidos'] e,
  // se essa query falhar, os cartões seguem visíveis sem o resumo em rota.
  const semPedidos = pedidosQuery.isError;

  if (motoristasQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-tinta-suave">
        Carregando motoristas…
      </div>
    );
  }

  if (motoristasQuery.isError) {
    const erro = motoristasQuery.error;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-tinta-suave">
        <p>
          {erro instanceof Error
            ? erro.message
            : 'Não foi possível carregar os motoristas.'}
        </p>
        <button
          type="button"
          onClick={() => {
            void motoristasQuery.refetch();
            void pedidosQuery.refetch();
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
      <div className="mx-auto max-w-7xl space-y-6 p-4 animate-sobe sm:p-6">
        {motoristas.length === 0 ? (
          <p className="py-16 text-center text-sm text-tinta-suave">
            Nenhum motorista cadastrado.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {motoristas.map((m) => {
              const resumo = porMotorista.get(m.id) ?? {
                entregas: 0,
                valor: 0,
              };
              return (
                <article
                  key={m.id}
                  className="animate-sobe rounded-xl2 border border-linha bg-papel p-4 shadow-carta transition duration-200 hover:-translate-y-0.5 hover:shadow-flutua"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-folha-claro text-mata">
                      <Users className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h3 className="font-display text-base font-semibold leading-tight text-tinta">
                      {m.nome || 'Motorista'}
                    </h3>
                  </div>
                  <div className="mt-4 flex items-end justify-between border-t border-linha/70 pt-3">
                    <span className="flex items-center gap-1.5 text-sm text-tinta-suave">
                      <Truck
                        className="h-4 w-4 text-trigo-escuro"
                        aria-hidden="true"
                      />
                      {semPedidos
                        ? 'Entregas indisponíveis'
                        : resumo.entregas === 1
                          ? '1 entrega em rota'
                          : `${resumo.entregas} entregas em rota`}
                    </span>
                    <span className="font-display text-lg font-semibold text-mata-escuro">
                      {semPedidos ? '—' : formatarMoeda(resumo.valor)}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
