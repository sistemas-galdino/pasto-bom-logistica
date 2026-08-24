// Cartão de uma RESERVA DE CAMINHÃO no QUADRO.
//
// TRACEJADO e sem cor de status, de propósito: a reserva não é entrega. Ela não
// tem ciclo de viagem (não é separada, não vai em rota, não é entregue), então
// pintá-la com a faixa de um status seria dizer que ela caminha junto das
// entregas — e a primeira pessoa a arrastar mentalmente uma reserva para "em
// rota" perderia a confiança no quadro. A borda tracejada é o MESMO desenho do
// card de reserva da agenda: o mesmo objeto tem de se reconhecer nas duas telas.
//
// Este componente é do QUADRO e vive na faixa acima das colunas. O da agenda
// (pages/Agenda.tsx) é outro: lá o card é só leitura, cabe num slot estreito e
// tem modo compacto; aqui ele carrega as ações de Editar e Cancelar, que só a
// logística vê.
//
// O CADEADO não é enfeite. É a diferença entre "o caminhão está reservado" e "o
// caminhão vai fazer isso e ainda entrega" — quem lê o quadro para prometer
// data ao cliente decide por esse ícone.

import React from 'react';
import type { Reserva } from '@pastobom/shared';
import { Lock, MapPin, Truck, User } from 'lucide-react';
import { formatarData } from '../lib/format';

interface Props {
  reserva: Reserva;
  /** Só a logística edita e cancela — mesma regra dos outros cards. */
  podeEscrever: boolean;
  onEditar: (reserva: Reserva) => void;
  onCancelar: (reserva: Reserva) => void;
}

const PERIODO_ROTULO: Record<Reserva['periodo'], string> = {
  manha: 'manhã',
  tarde: 'tarde',
};

function formatarT(kg: number): string {
  return `${(kg / 1000).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  })} t`;
}

export function ReservaCard({
  reserva,
  podeEscrever,
  onEditar,
  onCancelar,
}: Props): React.ReactElement {
  // Fornecedor manda quando existe: ele é mais específico que a cidade (que
  // veio dele, na maioria dos casos). Sem os dois, não há destino a mostrar —
  // reserva de oficina na própria sede é assim.
  const destino =
    reserva.fornecedorNome?.trim() || reserva.cidade?.trim() || '';

  return (
    <article className="animate-sobe w-full min-w-[260px] max-w-[320px] shrink-0 rounded-xl border border-dashed border-pedra bg-creme-50 p-3.5 transition duration-200 hover:-translate-y-0.5 hover:shadow-carta">
      <div className="flex items-start justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-1.5 font-display text-[15px] font-semibold leading-tight text-tinta">
          {reserva.bloqueiaCaminhao && (
            <Lock
              className="h-3.5 w-3.5 shrink-0 text-terra-escuro"
              aria-label="Caminhão indisponível neste período"
            />
          )}
          <span className="truncate">{reserva.servico}</span>
        </h3>
        <span className="shrink-0 rounded-md border border-dashed border-pedra px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-tinta-suave">
          Reserva
        </span>
      </div>

      <p className="mt-1 text-xs text-tinta-suave">
        {formatarData(reserva.dataAgendada)} · {PERIODO_ROTULO[reserva.periodo]}
      </p>

      <p className="mt-1.5 flex items-center gap-1 text-xs text-tinta-suave">
        <User className="h-3.5 w-3.5 shrink-0 text-pedra" aria-hidden="true" />
        {/* Motorista é opcional na reserva: dizer "a definir" é honesto e evita
            a leitura de que faltou preencher. */}
        <span className="truncate">
          {reserva.motoristaNome?.trim() || 'Motorista a definir'}
        </span>
      </p>

      {destino !== '' && (
        <p className="mt-0.5 flex items-center gap-1 text-xs text-tinta-suave">
          <MapPin
            className="h-3.5 w-3.5 shrink-0 text-pedra"
            aria-hidden="true"
          />
          <span className="truncate">{destino}</span>
        </p>
      )}

      {reserva.produtos && reserva.produtos.trim() !== '' && (
        <p className="mt-1.5 line-clamp-2 text-xs text-tinta-suave">
          {reserva.produtos}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-linha/70 pt-2 text-xs">
        <span className="flex min-w-0 items-center gap-1 text-tinta-suave">
          <Truck
            className="h-3.5 w-3.5 shrink-0 text-pedra"
            aria-hidden="true"
          />
          <span className="truncate">{reserva.caminhaoNome || '—'}</span>
        </span>
        {/* Sem peso a reserva ocupa o caminhão sem contar tonelagem — o caso da
            oficina, contra o da coleta de adubo. Dizer isso no card evita a
            leitura de que "faltou cadastrar o peso". */}
        {reserva.pesoPrevistoKg === null ? (
          <span
            className="shrink-0 text-pedra"
            title="Reserva sem peso: ocupa o caminhão, mas não conta tonelagem."
          >
            sem peso
          </span>
        ) : (
          <span className="shrink-0 font-semibold text-tinta-suave">
            {formatarT(reserva.pesoPrevistoKg)}
          </span>
        )}
      </div>

      {reserva.bloqueiaCaminhao && (
        <p className="mt-2 rounded-lg border border-terra/30 bg-terra-claro px-2.5 py-1.5 text-[11px] text-terra-escuro">
          Nenhuma entrega entra neste caminhão neste período.
        </p>
      )}

      {podeEscrever && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-linha/70 pt-3">
          <button
            type="button"
            onClick={() => onEditar(reserva)}
            title="Muda serviço, destino, dia, período, motorista ou caminhão."
            className="rounded-lg border border-linha bg-papel px-2.5 py-1.5 text-xs font-semibold text-tinta-suave transition hover:border-mata/30 hover:text-mata"
          >
            Editar
          </button>
          <button
            type="button"
            onClick={() => onCancelar(reserva)}
            title="Libera o caminhão neste período. A reserva fica no histórico."
            className="rounded-lg border border-linha bg-papel px-2.5 py-1.5 text-xs font-semibold text-tinta-suave transition hover:border-terra/40 hover:text-terra-escuro"
          >
            Cancelar
          </button>
        </div>
      )}
    </article>
  );
}
