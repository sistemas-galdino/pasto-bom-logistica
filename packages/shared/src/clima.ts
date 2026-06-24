// Previsão do clima para o dia da entrega.
//
// FONTE ÚNICA do mapeamento de código meteorológico → ícone + descrição,
// usada pelo backend (monta o DTO a partir do Open-Meteo) e pelo frontend
// (escolhe o ícone a exibir). O Open-Meteo classifica o tempo com os códigos
// WMO 4677 (weather_code); aqui traduzimos para um conjunto pequeno de ícones
// e uma descrição curta em PT-BR.

/** Conjunto de ícones que o frontend sabe renderizar (mapeia p/ Lucide). */
export type IconeClima =
  | 'sol'
  | 'poucas_nuvens'
  | 'nublado'
  | 'nevoeiro'
  | 'chuva'
  | 'chuva_forte'
  | 'tempestade'
  | 'neve'
  | 'desconhecido';

/** Por que não há previsão (quando `disponivel` é false). */
export type MotivoSemClima = 'fora_do_horizonte' | 'sem_localizacao' | 'erro';

/**
 * Previsão diária de um pedido/entrega. Quando `disponivel` é false, os campos
 * numéricos vêm nulos e `motivo` explica o porquê (a UI mostra um traço discreto).
 */
export interface PrevisaoClima {
  /** Dia da previsão (ISO `YYYY-MM-DD`). */
  data: string;
  /** Cidade de entrega usada na consulta. */
  cidade: string;
  /** UF da cidade (pode ser ''). */
  uf: string;
  disponivel: boolean;
  motivo?: MotivoSemClima;
  /** Temperatura máxima (°C) prevista; null se indisponível. */
  tempMax: number | null;
  /** Temperatura mínima (°C) prevista; null se indisponível. */
  tempMin: number | null;
  /** Probabilidade de precipitação (0–100); null se indisponível. */
  precipitacaoProb: number | null;
  /** Código WMO bruto (weather_code) do Open-Meteo; null se indisponível. */
  codigoWmo: number | null;
  /** Descrição curta em PT-BR (ex.: "Chuva forte"). */
  descricao: string;
  icone: IconeClima;
}

/**
 * Traduz um código WMO (weather_code do Open-Meteo) para ícone + descrição
 * em PT-BR. Códigos desconhecidos caem em `desconhecido`.
 *
 * Referência (WMO 4677, faixas usadas pelo Open-Meteo):
 *   0      céu limpo
 *   1–2    poucas nuvens / parcialmente nublado
 *   3      nublado
 *   45,48  nevoeiro
 *   51–57  garoa            61,63  chuva leve/moderada   65 chuva forte
 *   66,67  chuva congelante 80,81  pancadas              82 pancadas fortes
 *   71–77  neve             85,86  pancadas de neve
 *   95     trovoada         96,99  trovoada com granizo
 */
export function mapearWmo(codigo: number): {
  descricao: string;
  icone: IconeClima;
} {
  switch (codigo) {
    case 0:
      return { descricao: 'Céu limpo', icone: 'sol' };
    case 1:
      return { descricao: 'Predominantemente limpo', icone: 'sol' };
    case 2:
      return { descricao: 'Parcialmente nublado', icone: 'poucas_nuvens' };
    case 3:
      return { descricao: 'Nublado', icone: 'nublado' };
    case 45:
    case 48:
      return { descricao: 'Nevoeiro', icone: 'nevoeiro' };
    case 51:
    case 53:
    case 55:
      return { descricao: 'Garoa', icone: 'chuva' };
    case 56:
    case 57:
      return { descricao: 'Garoa congelante', icone: 'chuva' };
    case 61:
      return { descricao: 'Chuva fraca', icone: 'chuva' };
    case 63:
      return { descricao: 'Chuva', icone: 'chuva' };
    case 65:
      return { descricao: 'Chuva forte', icone: 'chuva_forte' };
    case 66:
    case 67:
      return { descricao: 'Chuva congelante', icone: 'chuva' };
    case 71:
    case 73:
    case 75:
    case 77:
      return { descricao: 'Neve', icone: 'neve' };
    case 80:
    case 81:
      return { descricao: 'Pancadas de chuva', icone: 'chuva' };
    case 82:
      return { descricao: 'Pancadas fortes', icone: 'chuva_forte' };
    case 85:
    case 86:
      return { descricao: 'Pancadas de neve', icone: 'neve' };
    case 95:
      return { descricao: 'Trovoada', icone: 'tempestade' };
    case 96:
    case 99:
      return { descricao: 'Trovoada com granizo', icone: 'tempestade' };
    default:
      return { descricao: 'Indefinido', icone: 'desconhecido' };
  }
}
