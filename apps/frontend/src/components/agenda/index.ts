// Barril dos componentes de calendário da agenda.
//
// Existe para que uma tela nova (a aba "Agenda do caminhão" da Rota) monte o
// calendário com um import só, sem precisar saber em qual arquivo cada peça
// caiu.

export { BlocoSlot } from './BlocoSlot';
export type { BlocoSlotProps } from './BlocoSlot';
export { BarraOcupacao, GrupoCaminhao } from './GrupoCaminhao';
export type { BarraOcupacaoProps, GrupoCaminhaoProps } from './GrupoCaminhao';
export { CardEntrega } from './CardEntrega';
export type { CardEntregaProps } from './CardEntrega';
export { CardReserva } from './CardReserva';
export type { CardReservaProps } from './CardReserva';
export { Legenda } from './Legenda';
export { NavegadorPeriodo } from './NavegadorPeriodo';
export type { NavegadorPeriodoProps } from './NavegadorPeriodo';
export { VisaoDia, VisaoMes, VisaoSemana } from './Visoes';
export type { VisaoDiaProps, VisaoMesProps, VisaoSemanaProps } from './Visoes';
export { chaveSlot, PERIODO_ROTULO, PERIODOS } from './slots';
export type { Visao } from './slots';
