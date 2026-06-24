// Exibe a previsão do clima de uma entrega.
//
//   variant="completo"  -> bloco do modal de agendar (ícone, descrição, máx/mín, chuva)
//   variant="badge"     -> selo compacto p/ card do pedido e parada da rota
//
// O ícone vem do mapeamento WMO do @pastobom/shared (fonte única). Tempo ruim
// (chuva forte / tempestade) ganha cor de alerta para saltar aos olhos.

import React from 'react';
import type { IconeClima, PrevisaoClima } from '@pastobom/shared';
import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudOff,
  CloudRain,
  CloudRainWind,
  CloudSun,
  Snowflake,
  Sun,
  type LucideIcon,
} from 'lucide-react';

const ICONE: Record<IconeClima, LucideIcon> = {
  sol: Sun,
  poucas_nuvens: CloudSun,
  nublado: Cloud,
  nevoeiro: CloudFog,
  chuva: CloudRain,
  chuva_forte: CloudRainWind,
  tempestade: CloudLightning,
  neve: Snowflake,
  desconhecido: CloudOff,
};

/** Cor do ícone: alerta para tempo ruim, neutro para o resto. */
function corIcone(icone: IconeClima): string {
  if (icone === 'chuva_forte' || icone === 'tempestade') return 'text-terra';
  if (icone === 'sol') return 'text-trigo-escuro';
  return 'text-tinta-suave';
}

const MOTIVO_TEXTO: Record<NonNullable<PrevisaoClima['motivo']>, string> = {
  fora_do_horizonte: 'Sem previsão para esta data (até ~16 dias).',
  sem_localizacao: 'Sem localização para prever o clima.',
  erro: 'Clima indisponível no momento.',
};

const temp = (v: number | null): string => (v === null ? '—' : `${Math.round(v)}°`);

function localLabel(p: PrevisaoClima): string {
  if (!p.cidade) return '';
  return p.uf ? `${p.cidade}-${p.uf}` : p.cidade;
}

interface Props {
  previsao: PrevisaoClima | null | undefined;
  carregando?: boolean;
  variant?: 'completo' | 'badge';
}

export function ClimaResumo({
  previsao,
  carregando = false,
  variant = 'completo',
}: Props): React.ReactElement | null {
  // ---- Selo compacto (card / rota): só aparece quando há previsão ----------
  if (variant === 'badge') {
    if (!previsao || !previsao.disponivel) return null;
    const Icone = ICONE[previsao.icone];
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-tinta-suave"
        title={`${previsao.descricao}${
          previsao.precipitacaoProb !== null
            ? ` · chuva ${previsao.precipitacaoProb}%`
            : ''
        }`}
      >
        <Icone className={`h-3.5 w-3.5 shrink-0 ${corIcone(previsao.icone)}`} aria-hidden />
        <span className="font-semibold text-tinta">{temp(previsao.tempMax)}</span>
        {previsao.precipitacaoProb !== null && (
          <span className="text-tinta-suave">· {previsao.precipitacaoProb}%</span>
        )}
      </span>
    );
  }

  // ---- Bloco completo (modal) ----------------------------------------------
  if (carregando) {
    return (
      <div className="rounded-lg border border-linha bg-creme-50 px-3 py-2 text-xs text-tinta-suave">
        Consultando o clima…
      </div>
    );
  }
  if (!previsao) return null;

  if (!previsao.disponivel) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-linha bg-creme-50 px-3 py-2 text-xs text-tinta-suave">
        <CloudOff className="h-4 w-4 shrink-0" aria-hidden />
        <span>{MOTIVO_TEXTO[previsao.motivo ?? 'erro']}</span>
      </div>
    );
  }

  const Icone = ICONE[previsao.icone];
  const local = localLabel(previsao);
  return (
    <div className="flex items-center gap-3 rounded-lg border border-linha bg-creme-50 px-3 py-2">
      <Icone className={`h-6 w-6 shrink-0 ${corIcone(previsao.icone)}`} aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-tinta">{previsao.descricao}</p>
        {local && <p className="truncate text-xs text-tinta-suave">{local}</p>}
      </div>
      <div className="ml-auto shrink-0 text-right">
        <p className="text-sm font-semibold text-tinta">
          {temp(previsao.tempMax)}{' '}
          <span className="font-normal text-tinta-suave">/ {temp(previsao.tempMin)}</span>
        </p>
        {previsao.precipitacaoProb !== null && (
          <p className="text-xs text-tinta-suave">Chuva {previsao.precipitacaoProb}%</p>
        )}
      </div>
    </div>
  );
}
