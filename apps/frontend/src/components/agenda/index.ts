// Barril dos componentes de calendário da agenda.
//
// Existe para que uma tela nova (a aba "Agenda do caminhão" da Rota) monte o
// calendário com um import só, sem precisar saber em qual arquivo cada peça
// caiu.

export { AcaoRotasCidade } from './AcaoRotasCidade';
export type { AcaoRotasCidadeProps } from './AcaoRotasCidade';
export { BlocoSlot } from './BlocoSlot';
export { ChipRotaCidade, FaixaRotasCidade } from './ChipRotaCidade';
export type { ChipRotaCidadeProps, FaixaRotasCidadeProps } from './ChipRotaCidade';
export type { BlocoSlotProps } from './BlocoSlot';
export { BarraOcupacao, GrupoCaminhao } from './GrupoCaminhao';
export type { BarraOcupacaoProps, GrupoCaminhaoProps } from './GrupoCaminhao';
export { CardEntrega } from './CardEntrega';
export type { CardEntregaProps } from './CardEntrega';
export { CardReserva } from './CardReserva';
export type { CardReservaProps } from './CardReserva';
export { Legenda } from './Legenda';
export { MiniSemanaCaminhao } from './MiniSemanaCaminhao';
export type { MiniSemanaCaminhaoProps } from './MiniSemanaCaminhao';
export { NavegadorPeriodo } from './NavegadorPeriodo';
export type { NavegadorPeriodoProps } from './NavegadorPeriodo';
export { VisaoDia, VisaoMes, VisaoSemana } from './Visoes';
export type { VisaoDiaProps, VisaoMesProps, VisaoSemanaProps } from './Visoes';
export {
  chaveSlot,
  indexarRotasPorSlot,
  PERIODO_ROTULO,
  PERIODOS,
  rotasDoDia,
} from './slots';
export type { Visao } from './slots';
export { FaixaVagas } from './FaixaVagas';
export type { AlvoVaga, FaixaVagasProps } from './FaixaVagas';
export { intervaloParaTela, tituloDoPeriodo } from './periodo';
export type { IntervaloDesenhavel } from './periodo';
