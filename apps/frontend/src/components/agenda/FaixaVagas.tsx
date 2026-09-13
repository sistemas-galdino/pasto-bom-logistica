// A FAIXA DE VAGAS de um dia: quanto ainda cabe em cada caminhão, e o clique
// que leva ao agendamento já com data, período e caminhão escolhidos.
//
// É a ponta de tela do pedido da Natália (reunião de 27/08): o Johnny abria o
// Quadro, não sabia se o caminhão estava livre, ia até a Agenda, voltava e
// agendava. Aqui o "ver" e o "fazer" ficam no mesmo gesto.
//
// SEM `onAgendar`, TUDO VIRA TEXTO e nada vira botão. É assim que o vendedor e
// o almoxarifado veem a mesma faixa: eles precisam da informação (o vendedor
// promete data ao cliente) e não da ação. Não há um segundo componente
// "somente leitura" para não existirem duas faixas que podem divergir.
//
// A pílula é NAVEGAÇÃO, não autorização: ela diz onde vale a pena clicar. Quem
// recusa agendamento é o servidor (validarCargaDoAgendamento), e nenhuma trava
// de lá é afrouxada porque aqui apareceu "livre".

import React, { useMemo } from 'react';
import { Lock, Plus } from 'lucide-react';
import { vagasDoDia, rotuloDaVaga } from '@pastobom/shared';
import type {
  AgendaLimite,
  AgendaSlot,
  Caminhao,
  PeriodoEntrega,
  VagaCaminhaoDia,
} from '@pastobom/shared';

export interface AlvoVaga {
  data: string;
  caminhaoId: string;
  periodo: PeriodoEntrega;
}

export interface FaixaVagasProps {
  /** Dia desta faixa (ISO). */
  data: string;
  /**
   * Slots COMPLETOS do período carregado — nunca o resultado de
   * `filtrarSlotsPorCaminhao`, que descarta o slot sem entrega e sem reserva
   * daquele caminhão. O dia mais LIVRE é justamente o que some desse filtro, e
   * é o dia em que a faixa mais importa.
   */
  slots: readonly AgendaSlot[];
  limites: readonly AgendaLimite[];
  /** Frota ativa, na ordem em que as pílulas aparecem. */
  caminhoes: readonly Caminhao[];
  /** Ausente = faixa só de leitura (vendedor, almoxarifado). */
  onAgendar?: (alvo: AlvoVaga) => void;
  /** Ausente = sem atalho de reserva. Também só para quem escreve. */
  onReservar?: (alvo: { data: string; caminhaoId: string }) => void;
  /**
   * `compacta` é a coluna da visão de Semana (~140 px): uma linha por caminhão,
   * sem uma pílula por vaga — sete colunas × N caminhões × N pílulas viraria
   * ruído. `completa` é a visão de Dia, onde há largura para desenhar cada vaga
   * livre como um espaço vazio a preencher.
   */
  variante?: 'compacta' | 'completa';
  /** Dia no passado: some o convite, fica o número. Ninguém agenda para trás. */
  somenteLeitura?: boolean;
}

/** O período sugerido ao clicar: o primeiro que a reserva não bloqueou. */
function periodoSugerido(vaga: VagaCaminhaoDia): PeriodoEntrega {
  return vaga.periodosLivres[0] ?? 'manha';
}

function tituloDaVaga(vaga: VagaCaminhaoDia, nome: string): string {
  if (vaga.estado === 'bloqueado') {
    return `${nome}: reservado nos dois períodos deste dia.`;
  }
  if (vaga.estado === 'sem_teto') {
    return `${nome}: nenhum teto de entregas/dia cadastrado — o sistema não vai recusar agendamento nenhum neste caminhão. Cadastre em Caminhões.`;
  }
  const base = vaga.excedido
    ? `${nome}: ${vaga.usadas} viagens marcadas para um teto de ${vaga.max}. Baixar o teto não desmarca o que já estava agendado.`
    : `${nome}: ${vaga.usadas} de ${vaga.max} viagens do dia.`;
  if (vaga.periodosBloqueados.length > 0) {
    const rotulo = vaga.periodosBloqueados
      .map((p) => (p === 'manha' ? 'manhã' : 'tarde'))
      .join(' e ');
    return `${base} Reservado na ${rotulo}.`;
  }
  return base;
}

const COR_ESTADO: Record<VagaCaminhaoDia['estado'], string> = {
  livre: 'border-linha bg-papel text-tinta-suave',
  cheio: 'border-terra/40 bg-terra-claro text-terra-escuro',
  bloqueado: 'border-dashed border-pedra bg-creme-50 text-pedra',
  // Âmbar, o mesmo da tela de Caminhões: não é erro, é configuração faltando.
  sem_teto: 'border-trigo/50 bg-trigo-claro/50 text-trigo-escuro',
};

export function FaixaVagas({
  data,
  slots,
  limites,
  caminhoes,
  onAgendar,
  onReservar,
  variante = 'compacta',
  somenteLeitura = false,
}: FaixaVagasProps): React.ReactElement | null {
  const vagas = useMemo(
    () =>
      vagasDoDia(
        slots,
        limites,
        data,
        caminhoes.map((c) => c.id),
      ),
    [slots, limites, data, caminhoes],
  );

  if (caminhoes.length === 0) return null;

  const nomes = new Map(caminhoes.map((c) => [c.id, c.nome || 'Caminhão']));
  const podeAgendar = onAgendar !== undefined && !somenteLeitura;

  return (
    <ul
      className={
        variante === 'compacta'
          ? 'mt-1.5 space-y-1'
          : 'flex flex-wrap items-center gap-2'
      }
    >
      {vagas.map((vaga) => {
        const nome = nomes.get(vaga.caminhaoId) ?? 'Caminhão';
        const clicavel = podeAgendar && (vaga.estado === 'livre' || vaga.estado === 'sem_teto');
        const alvo: AlvoVaga = {
          data,
          caminhaoId: vaga.caminhaoId,
          periodo: periodoSugerido(vaga),
        };
        // Quantas pílulas de vaga desenhar. Sem teto desenha UMA: o caminhão
        // aceita, mas desenhar N seria inventar um número que ninguém
        // configurou. Teto de 9 desenha 4 e o resto vira "+5" — nove quadradinhos
        // viram ruído mesmo na visão de Dia.
        const pilulas =
          vaga.estado === 'sem_teto'
            ? 1
            : Math.min(vaga.livres, variante === 'completa' ? 4 : 0);

        return (
          <li
            key={vaga.caminhaoId}
            className={`flex items-center gap-1.5 rounded-lg border px-1.5 py-1 text-[10px] font-semibold leading-none ${COR_ESTADO[vaga.estado]}`}
            title={tituloDaVaga(vaga, nome)}
          >
            {vaga.estado === 'bloqueado' && (
              <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1 truncate">{nome}</span>
            <span className="shrink-0 tabular-nums">
              {vaga.estado === 'sem_teto'
                ? 'sem teto'
                : vaga.estado === 'bloqueado'
                  ? 'reservado'
                  : rotuloDaVaga(vaga)}
            </span>

            {clicavel &&
              Array.from({ length: Math.max(pilulas, 1) }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onAgendar?.(alvo)}
                  aria-label={`Agendar entrega em ${nome}`}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-dashed border-mata/40 text-mata transition hover:border-mata hover:bg-folha-claro"
                >
                  <Plus className="h-2.5 w-2.5" aria-hidden="true" />
                </button>
              ))}

            {onReservar !== undefined && !somenteLeitura && variante === 'completa' && (
              <button
                type="button"
                onClick={() => onReservar({ data, caminhaoId: vaga.caminhaoId })}
                className="shrink-0 rounded px-1 text-[10px] font-semibold text-pedra transition hover:text-mata"
                title={`Reservar ${nome} neste dia`}
              >
                reservar
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
