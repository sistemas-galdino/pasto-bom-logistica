// Cartão de pedido no kanban: cliente, bairro/cidade, valor, itens e propriedade.
// Mostra o progresso da separação (RF-2.2) nos estados pré-rota e, conforme o
// papel, as ações de transição (logística) e de separar (logística/almoxarifado).

import React from 'react';
import type { Pedido, PrevisaoClima, StatusLogistico } from '@pastobom/shared';
import { TRANSICOES, REVERSOES } from '@pastobom/shared';
import { formatarMoeda, formatarData, rotuloItens } from '../lib/format';
import { STATUS_META } from './status';
import { ClimaResumo } from './ClimaResumo';

interface Props {
  pedido: Pedido;
  podeEscrever: boolean;
  podeSeparar: boolean;
  onTransicionar: (pedido: Pedido, para: StatusLogistico) => void;
  onSeparar: (pedido: Pedido) => void;
  /** Reverte o status uma etapa (voltar/restaurar) — só logística. */
  onReverter?: (pedido: Pedido, para: StatusLogistico) => void;
  /** Previsão do clima para a data agendada (badge ao lado da data). */
  clima?: PrevisaoClima | null;
}

const PERIODO_ROTULO: Record<'manha' | 'tarde', string> = {
  manha: 'Manhã',
  tarde: 'Tarde',
};

/** Peso compacto para a pílula do cartão: kg abaixo de 1 t, toneladas acima. */
function pesoCurto(kg: number): string {
  if (kg < 1000) {
    return `${kg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`;
  }
  return `${(kg / 1000).toLocaleString('pt-BR', {
    maximumFractionDigits: 2,
  })} t`;
}

function IconePin(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-pedra" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 1.5a4 4 0 0 0-4 4c0 2.8 4 8 4 8s4-5.2 4-8a4 4 0 0 0-4-4Zm0 5.6a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2Z"
      />
    </svg>
  );
}

const pilulaCls =
  'rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide';

export function PedidoCard({
  pedido,
  podeEscrever,
  podeSeparar,
  onTransicionar,
  onSeparar,
  onReverter,
  clima,
}: Props): React.ReactElement {
  const transicoes = TRANSICOES[pedido.statusLogistico];
  const avanco = transicoes.find((t) => t !== 'cancelada') ?? null;
  const podeCancelar = transicoes.includes('cancelada');
  // Reversão de uma etapa (voltar): agendada->pendente, em_rota->agendada e
  // cancelada->pendente (restaurar quem foi cancelado por engano).
  const reverso = REVERSOES[pedido.statusLogistico][0] ?? null;
  const ehCancelada = pedido.statusLogistico === 'cancelada';
  // Pedido pendente é "lixo" do Órix que ainda não virou compromisso: descartar
  // não avisa ninguém. Nos demais status a palavra certa é cancelar.
  const ehDescarte = pedido.statusLogistico === 'pendente';

  // RF-2.2: progresso da separação (apenas estados pré-rota).
  const tot = pedido.itens.length;
  const sep = pedido.itens.filter((i) => i.separado).length;
  const completa = tot > 0 && sep === tot;
  const preRota =
    pedido.statusLogistico === 'pendente' ||
    pedido.statusLogistico === 'agendada';
  const mostrarSeparacao = preRota && tot > 0;
  const pct = tot > 0 ? Math.round((sep / tot) * 100) : 0;

  // Entrega rural: o motorista se guia por bairro + cidade (não há rua/número).
  const local = [pedido.bairro, pedido.cidadeCliente]
    .filter((parte) => parte && parte.trim() !== '')
    .join(' · ');

  const temBadges =
    pedido.periodo !== null ||
    pedido.caminhaoNome !== null ||
    preRota ||
    pedido.pesoTotalKg !== null;

  return (
    <article className="animate-sobe rounded-xl border border-linha bg-papel p-3.5 shadow-carta transition duration-200 hover:-translate-y-0.5 hover:shadow-flutua">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display text-[15px] font-semibold leading-tight text-tinta">
          {pedido.clienteNome || pedido.clienteCodigo || 'Cliente'}
        </h3>
        <span className="shrink-0 rounded-md bg-creme-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-tinta-suave">
          nº {pedido.orixNumero || '—'}
        </span>
      </div>

      <p className="mt-1 flex items-center gap-1 text-xs text-tinta-suave">
        <IconePin />
        {local || '—'}
      </p>

      {temBadges && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {pedido.periodo && (
            <span className={`${pilulaCls} bg-folha-claro text-mata`}>
              {PERIODO_ROTULO[pedido.periodo]}
            </span>
          )}
          {pedido.caminhaoNome && (
            <span className={`${pilulaCls} bg-creme-100 text-tinta-suave`}>
              🚚 {pedido.caminhaoNome}
            </span>
          )}
          {pedido.pesoTotalKg !== null ? (
            <span className={`${pilulaCls} bg-creme-100 text-tinta-suave`}>
              {pesoCurto(pedido.pesoTotalKg)}
            </span>
          ) : (
            preRota && (
              <span
                className={`${pilulaCls} bg-trigo-claro text-trigo-escuro`}
                title="Algum item do pedido está sem peso cadastrado. Informe o peso no agendamento."
              >
                peso pendente
              </span>
            )
          )}
        </div>
      )}

      <div className="mt-2.5 flex items-end justify-between">
        <span className="font-display text-xl font-semibold text-mata-escuro">
          {formatarMoeda(pedido.valorTotal)}
        </span>
        <span className="text-xs text-tinta-suave">
          {rotuloItens(pedido.itens.length)}
        </span>
      </div>

      {mostrarSeparacao && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] font-medium">
            <span className="text-tinta-suave">Separação</span>
            <span className={completa ? 'text-mata' : 'text-trigo-escuro'}>
              {sep}/{tot}
              {completa ? ' · pronta ✓' : ''}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-creme-100">
            <div
              className={`h-full rounded-full transition-all ${
                completa ? 'bg-folha' : 'bg-trigo'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <dl className="mt-3 space-y-1 text-xs text-tinta-suave">
        <div className="flex justify-between gap-2">
          <dt>Propriedade</dt>
          <dd className="truncate text-right text-tinta">
            {pedido.propriedadeCodigo ?? '—'}
          </dd>
        </div>
        {pedido.motoristaId && (
          <div className="flex justify-between gap-2">
            <dt>Motorista</dt>
            <dd className="truncate text-right text-tinta">
              {pedido.motoristaNome || '—'}
            </dd>
          </div>
        )}
        {pedido.dataAgendada && (
          <div className="flex justify-between gap-2">
            <dt>Agendada</dt>
            <dd className="flex items-center justify-end gap-2 text-right text-tinta">
              <ClimaResumo variant="badge" previsao={clima} />
              <span>
                {formatarData(pedido.dataAgendada)}
                {pedido.periodo ? ` · ${PERIODO_ROTULO[pedido.periodo]}` : ''}
              </span>
            </dd>
          </div>
        )}
        {pedido.statusLogistico === 'entregue' && pedido.dataEntregue && (
          <div className="flex justify-between gap-2">
            <dt>Entregue</dt>
            <dd className="text-right text-tinta">
              {formatarData(pedido.dataEntregue)}
            </dd>
          </div>
        )}
      </dl>

      {(podeSeparar && mostrarSeparacao) ||
      (podeEscrever && (avanco || podeCancelar || reverso)) ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-linha/70 pt-3">
          {podeSeparar && mostrarSeparacao && (
            <button
              type="button"
              onClick={() => onSeparar(pedido)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                completa
                  ? 'border-folha/40 bg-folha-claro text-mata hover:bg-folha-claro/70'
                  : 'border-trigo/40 bg-trigo-claro text-trigo-escuro hover:bg-trigo-claro/70'
              }`}
            >
              {completa ? 'Separação concluída' : `Separar mercadorias (${sep}/${tot})`}
            </button>
          )}

          {podeEscrever && (avanco || podeCancelar) && (
            <div className="flex gap-2">
              {avanco && (
                <button
                  type="button"
                  onClick={() => onTransicionar(pedido, avanco)}
                  className="flex-1 rounded-lg bg-mata px-2.5 py-1.5 text-xs font-bold text-creme-50 transition hover:bg-mata-escuro"
                >
                  {STATUS_META[pedido.statusLogistico].acao}
                </button>
              )}
              {podeCancelar && (
                <button
                  type="button"
                  onClick={() => onTransicionar(pedido, 'cancelada')}
                  title={
                    ehDescarte
                      ? 'Tira o pedido do quadro (vai para Cancelados, de onde pode ser restaurado). O cliente NÃO é notificado.'
                      : 'Cancela o pedido. O cliente NÃO é notificado.'
                  }
                  className="rounded-lg border border-linha px-2.5 py-1.5 text-xs font-semibold text-tinta-suave transition hover:border-terra/40 hover:bg-terra-claro hover:text-terra-escuro"
                >
                  {ehDescarte ? 'Descartar' : 'Cancelar'}
                </button>
              )}
            </div>
          )}

          {podeEscrever &&
            reverso &&
            (ehCancelada ? (
              <button
                type="button"
                onClick={() => onReverter?.(pedido, reverso)}
                title="Devolve o pedido para Pendente. O cliente NÃO é notificado."
                className="rounded-lg border border-folha/40 bg-folha-claro px-2.5 py-1.5 text-xs font-bold text-mata transition hover:bg-folha-claro/70"
              >
                Restaurar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onReverter?.(pedido, reverso)}
                className="self-start rounded-lg px-2.5 py-1.5 text-xs font-semibold text-tinta-suave transition hover:bg-creme-100 hover:text-tinta"
              >
                ← Voltar para {STATUS_META[reverso].rotulo}
              </button>
            ))}
        </div>
      ) : null}
    </article>
  );
}
