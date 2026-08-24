// Cartão de uma ENTREGA (uma viagem) — Onda 2.
//
// Diferença central em relação ao PedidoCard: aqui as quantidades são as DESTA
// VIAGEM, não as do pedido. Se a ordem de venda tem 180 sacos e este caminhão
// leva 100, o cartão mostra 100 — e o restante aparece como saldo na coluna
// Pendente, possivelmente em outro cartão saindo no mesmo dia.
//
// O número da OV continua em destaque porque é por ele que a equipe conversa
// com o cliente e com o Órix; duas viagens do mesmo pedido mostram o mesmo nº.

import React from 'react';
import type { Entrega, StatusEntrega } from '@pastobom/shared';
import {
  TRANSICOES_ENTREGA,
  REVERSOES_ENTREGA,
} from '@pastobom/shared';
import { formatarData } from '../lib/format';
import { STATUS_ENTREGA_META, rotuloAcaoEntrega } from './status';
import { ClimaResumo } from './ClimaResumo';
import type { PrevisaoClima } from '@pastobom/shared';

interface Props {
  entrega: Entrega;
  podeEscrever: boolean;
  podeSeparar: boolean;
  onTransicionar: (entrega: Entrega, para: StatusEntrega) => void;
  onSeparar: (entrega: Entrega) => void;
  /** Volta uma etapa (em rota -> agendada) — só logística. */
  onReverter?: (entrega: Entrega, para: StatusEntrega) => void;
  /** Muda data/período/motorista/caminhão sem desfazer o agendamento. */
  onReagendar?: (entrega: Entrega) => void;
  /** Marca a viagem como não realizada (cartões em rota) — só logística. */
  onNaoRealizado?: (entrega: Entrega) => void;
  clima?: PrevisaoClima | null;
}

function formatarQtd(qtd: number): string {
  return qtd.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function formatarPeso(kg: number): string {
  return `${(kg / 1000).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} t`;
}

function IconePin(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-pedra" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5c0 3.2 4.5 8.5 4.5 8.5s4.5-5.3 4.5-8.5A4.5 4.5 0 0 0 8 1.5Zm0 6.2a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4Z"
      />
    </svg>
  );
}

export function EntregaCard({
  entrega,
  podeEscrever,
  podeSeparar,
  onTransicionar,
  onSeparar,
  onReverter,
  onReagendar,
  onNaoRealizado,
  clima,
}: Props): React.ReactElement {
  const meta = STATUS_ENTREGA_META[entrega.status];

  const total = entrega.itens.length;
  const separados = entrega.itens.filter((i) => i.separado).length;
  const separacaoCompleta = total > 0 && separados === total;
  const podeMostrarSeparacao = entrega.status === 'agendada' && total > 0;

  // Entregas rurais: o motorista se guia por bairro + cidade.
  const local = [entrega.bairro, entrega.cidadeCliente]
    .filter((p) => p && p.trim() !== '')
    .join(' · ');

  const motivo = entrega.motivoNaoEntrega?.trim() ?? '';

  // 'em_rota' sai da lista de avanço: ele tem botões próprios (entregue e não
  // realizado), tratados logo abaixo com destaques diferentes.
  const avancos = TRANSICOES_ENTREGA[entrega.status].filter(
    (p) => p !== 'nao_realizado' && p !== 'cancelada',
  );
  const reversoes = REVERSOES_ENTREGA[entrega.status];

  return (
    <article className="animate-sobe rounded-xl border border-linha bg-papel p-3.5 shadow-carta transition duration-200 hover:-translate-y-0.5 hover:shadow-flutua">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display text-[15px] font-semibold leading-tight text-tinta">
          {entrega.clienteNome || entrega.clienteCodigo || 'Cliente'}
        </h3>
        <span className="shrink-0 rounded-md bg-creme-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-tinta-suave">
          nº {entrega.orixNumero || '—'}
        </span>
      </div>

      <p className="mt-1 flex items-center gap-1 text-xs text-tinta-suave">
        <IconePin />
        {local || '—'}
      </p>

      {entrega.dataPedido && (
        <p className="mt-1.5 text-[10px] text-pedra">
          Entrada:{' '}
          <span className="font-semibold text-tinta-suave">
            {formatarData(entrega.dataPedido)}
          </span>
        </p>
      )}

      {/* Itens DESTA viagem */}
      {total > 0 && (
        <ul className="mt-2.5 space-y-0.5 border-t border-linha/70 pt-2 text-xs text-tinta-suave">
          {entrega.itens.slice(0, 4).map((item) => (
            <li key={item.id} className="flex items-baseline gap-1.5">
              <span className="font-bold text-tinta">
                {formatarQtd(item.qtd)}×
              </span>
              <span className="truncate">
                {item.nomeProduto || item.produtoCodigo}
              </span>
            </li>
          ))}
          {total > 4 && (
            <li className="text-[11px] text-pedra">
              + {total - 4} outro{total - 4 > 1 ? 's' : ''}
            </li>
          )}
        </ul>
      )}

      {/* Motorista · caminhão · peso */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-linha/70 pt-2 text-[11px] text-tinta-suave">
        <span className="truncate">
          {entrega.motoristaNome || 'Sem motorista'}
        </span>
        <span className="truncate">{entrega.caminhaoNome || '—'}</span>
        {entrega.pesoTotalKg !== null && (
          <span className="font-semibold text-mata-escuro">
            {formatarPeso(entrega.pesoTotalKg)}
          </span>
        )}
      </div>

      {clima?.disponivel && (
        <div className="mt-2">
          <ClimaResumo variant="badge" previsao={clima} />
        </div>
      )}

      {/* Progresso da separação */}
      {podeMostrarSeparacao && (
        <div className="mt-2.5">
          <div className="flex items-center justify-between text-[11px] text-tinta-suave">
            <span>Separação</span>
            <span className={separacaoCompleta ? 'font-semibold text-mata' : ''}>
              {separados}/{total}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-creme-100">
            <div
              className={`h-full rounded-full transition-all ${
                separacaoCompleta ? 'bg-folha' : 'bg-trigo'
              }`}
              style={{ width: `${total > 0 ? (separados / total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* O motivo é O dado do cartão não realizado: diz o que resolver antes de
          marcar outra viagem. O saldo já voltou para a fila sozinho. */}
      {entrega.status === 'nao_realizado' && (
        <div className="mt-2.5 rounded-lg border border-brasa/30 bg-brasa-claro px-2.5 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-brasa">
            Motivo da não entrega
          </p>
          <p className="mt-0.5 text-xs text-brasa-escuro">
            {motivo || 'Não informado.'}
          </p>
          <p className="mt-1.5 text-[10px] text-brasa-escuro/80">
            A carga voltou para a fila. Agende uma nova entrega pelo pedido.
          </p>
        </div>
      )}

      <span
        className={`mt-2.5 inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${meta.badge}`}
      >
        {meta.rotulo}
      </span>

      {/* Ações */}
      {podeEscrever && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-linha/70 pt-3">
          {podeMostrarSeparacao && podeSeparar && (
            <button
              type="button"
              onClick={() => onSeparar(entrega)}
              className="rounded-lg border border-linha px-2.5 py-1.5 text-xs font-semibold text-tinta-suave transition hover:border-mata/30 hover:text-mata"
            >
              Separar
            </button>
          )}

          {avancos.map((para) => {
            // Sem a carga conferida o backend recusa (422); melhor o botão já
            // dizer isso do que a pessoa clicar e tomar erro.
            const travadoPorSeparacao =
              para === 'em_rota' && total > 0 && !separacaoCompleta;
            return (
              <button
                key={para}
                type="button"
                disabled={travadoPorSeparacao}
                title={
                  travadoPorSeparacao
                    ? 'Conclua a separação para liberar a saída.'
                    : undefined
                }
                onClick={() => onTransicionar(entrega, para)}
                className="rounded-lg bg-mata px-2.5 py-1.5 text-xs font-bold text-creme-50 transition hover:bg-mata-escuro disabled:cursor-not-allowed disabled:opacity-50"
              >
                {rotuloAcaoEntrega(entrega.status, para)}
              </button>
            );
          })}

          {entrega.status === 'em_rota' && onNaoRealizado && (
            <button
              type="button"
              onClick={() => onNaoRealizado(entrega)}
              className="rounded-lg border border-brasa/40 px-2.5 py-1.5 text-xs font-semibold text-brasa transition hover:bg-brasa-claro"
            >
              {rotuloAcaoEntrega(entrega.status, 'nao_realizado')}
            </button>
          )}

          {/* Reagendar antes de Desfazer: remarcar é o caminho comum, desfazer é
              o excepcional. A separação conferida sobrevive ao reagendamento —
              foi o motivo do pedido. */}
          {entrega.status === 'agendada' && onReagendar && (
            <button
              type="button"
              onClick={() => onReagendar(entrega)}
              title="Muda data, período, motorista ou caminhão. A separação é mantida."
              className="rounded-lg border border-linha px-2.5 py-1.5 text-xs font-semibold text-tinta-suave transition hover:border-mata/30 hover:text-mata"
            >
              Reagendar
            </button>
          )}

          {entrega.status === 'agendada' && (
            <button
              type="button"
              onClick={() => onTransicionar(entrega, 'cancelada')}
              title="Desfaz o agendamento: a carga volta para a fila e a vaga do caminhão é liberada."
              className="rounded-lg border border-linha px-2.5 py-1.5 text-xs font-semibold text-tinta-suave transition hover:border-terra/40 hover:text-terra-escuro"
            >
              {rotuloAcaoEntrega(entrega.status, 'cancelada')}
            </button>
          )}

          {onReverter &&
            reversoes.map((para) => (
              <button
                key={`rev-${para}`}
                type="button"
                onClick={() => onReverter(entrega, para)}
                className="rounded-lg border border-linha px-2.5 py-1.5 text-xs font-semibold text-tinta-suave transition hover:border-mata/30 hover:text-mata"
              >
                Voltar
              </button>
            ))}
        </div>
      )}
    </article>
  );
}
