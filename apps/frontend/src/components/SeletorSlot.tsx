// SELETOR DE SLOT: data · período · motorista · caminhão.
//
// Extraído do AgendarEntregaModal quando a reserva de caminhão apareceu. O
// Johnny pediu, com estas palavras, que o card avulso tivesse "os MESMOS
// seletores" do agendamento — e o risco de copiar o bloco é conhecido: os dois
// divergem na primeira mudança (um ganha o aviso de caminhão inativo, o outro
// não; um passa a ordenar motorista por nome, o outro fica).
//
// O QUE MORA AQUI: só a escolha do SLOT. Ou seja, quatro campos e o único aviso
// que é do próprio seletor — "nenhum caminhão ativo cadastrado", que fala da
// lista que ele mesmo desenha.
//
// O QUE NÃO MORA AQUI: qualquer regra de carga. Peso da viagem, capacidade do
// caminhão, teto de entregas por dia, propriedade do cliente — tudo isso é do
// AGENDAMENTO e continua no AgendarEntregaModal. A reserva não tem carga de
// cliente e não pode herdar avisos que não valem para ela; foi por isso que a
// extração parou nos quatro campos.
//
// O componente é CONTROLADO (o estado é de quem chama). Guardar data/período
// aqui dentro obrigaria o pai a espelhar tudo de volta para montar o PATCH da
// reserva, que manda só o que mudou.

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Caminhao, MotoristaResumo, PeriodoEntrega } from '@pastobom/shared';
import { api } from '../lib/api';

interface Props {
  /** Data ISO (YYYY-MM-DD) — o formato que o `<input type="date">` aceita. */
  data: string;
  periodo: PeriodoEntrega;
  motoristaId: string;
  caminhaoId: string;
  onData: (valor: string) => void;
  onPeriodo: (valor: PeriodoEntrega) => void;
  onMotorista: (valor: string) => void;
  onCaminhao: (valor: string) => void;
  /** Trava os quatro campos enquanto a mutação está no ar. */
  desabilitado?: boolean;
  /** Foca a data ao abrir. Fica opcional: na reserva o foco é do serviço. */
  autoFocoData?: boolean;
  /**
   * Motorista opcional — o caso da RESERVA: dá para mandar o caminhão à
   * oficina sem decidir quem leva. No agendamento ele é obrigatório e o rótulo
   * não ganha o "(opcional)".
   */
  motoristaOpcional?: boolean;
  /** Margem/posicionamento da grade, decidido por quem chama. */
  className?: string;
  /**
   * Campos extras DENTRO da mesma grade (a propriedade de entrega, no
   * agendamento). Ficam aqui para não quebrar o alinhamento de duas colunas —
   * um campo fora da grade desalinharia do resto do formulário.
   */
  children?: React.ReactNode;
}

function formatarT(kg: number): string {
  return `${(kg / 1000).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  })} t`;
}

const campoCls =
  'w-full rounded-lg border border-linha bg-creme-50 px-3 py-2 text-sm text-tinta outline-none transition focus:border-mata/40 focus:bg-papel disabled:opacity-60';

export function SeletorSlot({
  data,
  periodo,
  motoristaId,
  caminhaoId,
  onData,
  onPeriodo,
  onMotorista,
  onCaminhao,
  desabilitado = false,
  autoFocoData = false,
  motoristaOpcional = false,
  className = '',
  children,
}: Props): React.ReactElement {
  // As MESMAS queryKeys do resto do projeto, de propósito: o cache é
  // compartilhado, então abrir agendamento e reserva em seguida não refaz as
  // duas listas.
  const motoristasQuery = useQuery({
    queryKey: ['motoristas'],
    queryFn: ({ signal }) => api.listarMotoristas(signal),
  });
  const caminhoesQuery = useQuery({
    queryKey: ['caminhoes'],
    queryFn: ({ signal }) => api.listarCaminhoes(signal),
  });

  const motoristas: MotoristaResumo[] = motoristasQuery.data ?? [];
  // Caminhão inativo sai da lista: reservar o que está fora de frota só produz
  // um 422 depois.
  const caminhoes: Caminhao[] = (caminhoesQuery.data ?? []).filter(
    (c) => c.ativo,
  );

  return (
    <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${className}`}>
      <label className="block">
        <span className="text-sm font-semibold text-tinta">Data</span>
        <input
          type="date"
          value={data}
          disabled={desabilitado}
          autoFocus={autoFocoData}
          onChange={(e) => onData(e.target.value)}
          className={`mt-1 ${campoCls}`}
        />
      </label>

      <label className="block">
        <span className="text-sm font-semibold text-tinta">Período</span>
        <select
          value={periodo}
          disabled={desabilitado}
          onChange={(e) => onPeriodo(e.target.value as PeriodoEntrega)}
          className={`mt-1 ${campoCls}`}
        >
          <option value="manha">Manhã</option>
          <option value="tarde">Tarde</option>
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-semibold text-tinta">
          Motorista{' '}
          {motoristaOpcional && (
            <span className="font-normal text-pedra">(opcional)</span>
          )}
        </span>
        <select
          value={motoristaId}
          disabled={desabilitado}
          onChange={(e) => onMotorista(e.target.value)}
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
          disabled={desabilitado}
          onChange={(e) => onCaminhao(e.target.value)}
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

      {children}
    </div>
  );
}
