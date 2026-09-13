// A SEMANA DO CAMINHÃO dentro do modal de agendar.
//
// Pedido da Natália na reunião de 27/08, item 8 do documento: "ao escolher o
// caminhão, mostrar a agenda daquele caminhão, ao menos a semana". Quem está
// agendando precisa ver se está empilhando tudo na terça enquanto a quinta está
// vazia — sem sair do formulário, que é a queixa que abriu a rodada inteira.
//
// NÃO É CLICÁVEL, de propósito. Abrir um detalhe por cima de um formulário meio
// preenchido perde o que já foi digitado; e trocar o dia por aqui esconderia a
// troca de quem está olhando o campo de data logo acima. Ela informa.
//
// E não reusa a `VisaoSemana`: aquela tem `min-w-[1040px]` e estouraria o
// `max-w-2xl` do modal. São sete caixinhas — o custo de escrevê-las é menor que
// o de tornar a visão de semana responsiva a um contexto que ela não tem.

import React from 'react';
import { vagasDoDia } from '@pastobom/shared';
import type { AgendaLimite, AgendaSlot } from '@pastobom/shared';
import { DIAS_CURTOS, dataDeIso } from '../../lib/datas';
import { ocupacaoDoCaminhaoNoDia } from '@pastobom/shared';

export interface MiniSemanaCaminhaoProps {
  /** Os 7 dias (ISO) da semana mostrada. */
  dias: readonly string[];
  /** Slots COMPLETOS da semana — não filtre por caminhão antes. */
  slots: readonly AgendaSlot[];
  limites: readonly AgendaLimite[];
  caminhaoId: string;
  /** Dia escolhido no formulário, destacado. */
  dataEscolhida: string;
  carregando?: boolean;
}

export function MiniSemanaCaminhao({
  dias,
  slots,
  limites,
  caminhaoId,
  dataEscolhida,
  carregando = false,
}: MiniSemanaCaminhaoProps): React.ReactElement {
  return (
    <div className="rounded-xl2 border border-linha bg-creme-50/50 p-2.5">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-tinta-suave">
          A semana deste caminhão
        </p>
        {carregando && <span className="text-[10px] text-pedra">lendo…</span>}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {dias.map((iso) => {
          const vaga = vagasDoDia(slots, limites, iso, [caminhaoId])[0];
          const ocupacao = ocupacaoDoCaminhaoNoDia(slots, {
            data: iso,
            caminhaoId,
          });
          const escolhido = iso === dataEscolhida;
          const dia = dataDeIso(iso);

          // O corpo da caixinha responde "cabe mais?" em uma olhada. Dia
          // bloqueado por reserva diz isso em vez de um número que convidaria a
          // agendar num caminhão que está na oficina.
          const corpo =
            vaga === undefined
              ? '–'
              : vaga.estado === 'bloqueado'
                ? 'res.'
                : vaga.estado === 'sem_teto'
                  ? String(ocupacao.entregasNoDia)
                  : `${vaga.usadas}/${vaga.max}`;

          const cor = escolhido
            ? 'border-mata bg-folha-claro text-mata-escuro'
            : vaga?.estado === 'bloqueado'
              ? 'border-dashed border-pedra bg-creme-50 text-pedra'
              : vaga?.estado === 'cheio'
                ? 'border-terra/40 bg-terra-claro text-terra-escuro'
                : 'border-linha bg-papel text-tinta-suave';

          return (
            <div
              key={iso}
              className={`rounded-lg border px-1 py-1 text-center ${cor}`}
              title={`${dia.toLocaleDateString('pt-BR')} · ${
                ocupacao.entregasNoDia
              } ${ocupacao.entregasNoDia === 1 ? 'entrega' : 'entregas'}${
                vaga?.max !== null && vaga?.max !== undefined
                  ? ` de um teto de ${vaga.max}`
                  : ' · sem teto cadastrado'
              }`}
            >
              <p className="text-[9px] font-semibold uppercase tracking-wide">
                {DIAS_CURTOS[dia.getDay()]}
              </p>
              <p className="font-display text-sm font-semibold leading-tight">
                {dia.getDate()}
              </p>
              <p className="text-[10px] leading-tight tabular-nums">{corpo}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
