import { describe, expect, it } from 'vitest';
import {
  avaliarLimiteEntregas,
  janelasSeSobrepoem,
  limiteVigente,
  type LimiteCaminhao,
} from './limite-entregas.js';

// O caso que a Natália descreveu: "Caminhão X, de 01/09 a 30/09, no máximo 5
// entregas por dia".
function janela(over: Partial<LimiteCaminhao> = {}): LimiteCaminhao {
  return {
    validoDe: '2026-09-01',
    validoAte: '2026-09-30',
    maxEntregasDia: 5,
    ...over,
  };
}

describe('limiteVigente', () => {
  it('caminhão sem nada cadastrado não tem janela vigente', () => {
    expect(limiteVigente([], '2026-09-10')).toBeNull();
  });

  it('acha a janela de setembro numa data de setembro', () => {
    const setembro = janela();
    expect(limiteVigente([setembro], '2026-09-10')).toBe(setembro);
  });

  it('agosto não é alcançado pela janela que começa em setembro', () => {
    expect(limiteVigente([janela()], '2026-08-31')).toBeNull();
  });

  it('outubro já está fora da janela que terminou em setembro', () => {
    expect(limiteVigente([janela()], '2026-10-01')).toBeNull();
  });

  // "01/09 a 30/09" para a cliente é setembro INTEIRO: o primeiro e o último dia
  // contam, senão ela perde dois dias de teto sem entender por quê.
  it('o primeiro dia da janela já vale', () => {
    expect(limiteVigente([janela()], '2026-09-01')).not.toBeNull();
  });

  it('o último dia da janela ainda vale', () => {
    expect(limiteVigente([janela()], '2026-09-30')).not.toBeNull();
  });

  it('janela sem data final vale para sempre, inclusive anos à frente', () => {
    const aberta = janela({ validoAte: null });
    expect(limiteVigente([aberta], '2031-12-25')).toBe(aberta);
  });

  it('janela sem data final também não vale antes de começar', () => {
    expect(limiteVigente([janela({ validoAte: null })], '2026-08-01')).toBeNull();
  });

  // Duas janelas em cima da mesma data não deveriam existir (a rota recusa), mas
  // dado importado tem; vale a última decisão que alguém tomou sobre aquele dia.
  it('com duas janelas na mesma data, vale a cadastrada para o período mais recente', () => {
    const antiga = janela({ validoDe: '2026-09-01', validoAte: '2026-09-30', maxEntregasDia: 5 });
    const nova = janela({ validoDe: '2026-09-15', validoAte: '2026-10-15', maxEntregasDia: 8 });
    expect(limiteVigente([antiga, nova], '2026-09-20')?.maxEntregasDia).toBe(8);
    // A ordem da lista não pode mudar a resposta.
    expect(limiteVigente([nova, antiga], '2026-09-20')?.maxEntregasDia).toBe(8);
  });

  it('fora da sobreposição, cada data continua na sua própria janela', () => {
    const antiga = janela({ validoDe: '2026-09-01', validoAte: '2026-09-30', maxEntregasDia: 5 });
    const nova = janela({ validoDe: '2026-09-15', validoAte: '2026-10-15', maxEntregasDia: 8 });
    expect(limiteVigente([antiga, nova], '2026-09-05')?.maxEntregasDia).toBe(5);
    expect(limiteVigente([antiga, nova], '2026-10-10')?.maxEntregasDia).toBe(8);
  });

  // Empate não tem "última decisão" para seguir, então fica o lado seguro: o
  // teto mais apertado, para não liberar mais do que a configuração mais
  // restritiva permitia.
  it('empatadas no início, vence o teto mais apertado', () => {
    const folgada = janela({ maxEntregasDia: 9 });
    const apertada = janela({ maxEntregasDia: 3 });
    expect(limiteVigente([folgada, apertada], '2026-09-10')?.maxEntregasDia).toBe(3);
    expect(limiteVigente([apertada, folgada], '2026-09-10')?.maxEntregasDia).toBe(3);
  });

  // Teto zero cadastrado por engano bloquearia o caminhão o mês inteiro; melhor
  // tratar como "não configurado" do que como "proibido agendar".
  it('teto zero é dado inválido e não bloqueia o caminhão', () => {
    expect(limiteVigente([janela({ maxEntregasDia: 0 })], '2026-09-10')).toBeNull();
  });

  it('teto negativo também é ignorado', () => {
    expect(limiteVigente([janela({ maxEntregasDia: -2 })], '2026-09-10')).toBeNull();
  });

  it('teto não numérico é ignorado', () => {
    expect(limiteVigente([janela({ maxEntregasDia: Number.NaN })], '2026-09-10')).toBeNull();
  });

  it('janela inválida não atropela a válida da mesma data', () => {
    const valida = janela({ maxEntregasDia: 4 });
    const invalida = janela({ maxEntregasDia: 0 });
    expect(limiteVigente([invalida, valida], '2026-09-10')?.maxEntregasDia).toBe(4);
  });
});

describe('avaliarLimiteEntregas', () => {
  it('sem janela cadastrada, o caminhão segue limitado só pela tonelagem', () => {
    const r = avaliarLimiteEntregas({ limites: [], data: '2026-09-10', entregasNoDia: 12 });
    expect(r.cabe).toBe(true);
    expect(r.maxEntregasDia).toBeNull();
    expect(r.restantes).toBeNull();
    expect(r.entregasNoDia).toBe(12);
  });

  it('com teto de 5 e 4 marcadas, ainda cabe uma', () => {
    const r = avaliarLimiteEntregas({
      limites: [janela()],
      data: '2026-09-10',
      entregasNoDia: 4,
    });
    expect(r.cabe).toBe(true);
    expect(r.maxEntregasDia).toBe(5);
    expect(r.restantes).toBe(1);
  });

  it('com teto de 5 e o dia cheio, a próxima entrega é recusada', () => {
    const r = avaliarLimiteEntregas({
      limites: [janela()],
      data: '2026-09-10',
      entregasNoDia: 5,
    });
    expect(r.cabe).toBe(false);
    expect(r.restantes).toBe(0);
  });

  // "Máximo de 5" inclui a quinta: chegar no teto é permitido, passar não.
  it('a quinta entrega cabe e a sexta não', () => {
    const base = { limites: [janela()], data: '2026-09-10' };
    expect(avaliarLimiteEntregas({ ...base, entregasNoDia: 4 }).cabe).toBe(true);
    expect(avaliarLimiteEntregas({ ...base, entregasNoDia: 5 }).cabe).toBe(false);
  });

  it('marcar três de uma vez estoura o teto quando já há três no dia', () => {
    const r = avaliarLimiteEntregas({
      limites: [janela()],
      data: '2026-09-10',
      entregasNoDia: 3,
      novasEntregas: 3,
    });
    expect(r.cabe).toBe(false);
    // Ainda cabem duas: o "não cabe" é do lote de três, não do dia estar cheio.
    expect(r.restantes).toBe(2);
  });

  it('marcar duas de uma vez cabe exatamente no que resta', () => {
    const r = avaliarLimiteEntregas({
      limites: [janela()],
      data: '2026-09-10',
      entregasNoDia: 3,
      novasEntregas: 2,
    });
    expect(r.cabe).toBe(true);
  });

  it('não informar quantas viagens equivale a agendar uma', () => {
    const base = { limites: [janela()], data: '2026-09-10', entregasNoDia: 4 };
    expect(avaliarLimiteEntregas(base)).toEqual(
      avaliarLimiteEntregas({ ...base, novasEntregas: 1 }),
    );
  });

  // Contagem estragada não pode virar crédito de entregas para o caminhão.
  it('contagem negativa do dia é tratada como dia vazio', () => {
    const r = avaliarLimiteEntregas({
      limites: [janela()],
      data: '2026-09-10',
      entregasNoDia: -4,
    });
    expect(r.entregasNoDia).toBe(0);
    expect(r.restantes).toBe(5);
    expect(r.cabe).toBe(true);
  });

  it('contagem não numérica do dia é tratada como dia vazio', () => {
    const r = avaliarLimiteEntregas({
      limites: [janela()],
      data: '2026-09-10',
      entregasNoDia: Number.NaN,
    });
    expect(r.entregasNoDia).toBe(0);
    expect(r.restantes).toBe(5);
  });

  it('fora da vigência a data volta a não ter teto de quantidade', () => {
    const r = avaliarLimiteEntregas({
      limites: [janela()],
      data: '2026-10-05',
      entregasNoDia: 30,
    });
    expect(r.cabe).toBe(true);
    expect(r.maxEntregasDia).toBeNull();
  });

  it('o teto aplicado é o da janela vigente daquela data', () => {
    const limites = [
      janela({ validoDe: '2026-09-01', validoAte: '2026-09-30', maxEntregasDia: 5 }),
      janela({ validoDe: '2026-10-01', validoAte: null, maxEntregasDia: 2 }),
    ];
    expect(
      avaliarLimiteEntregas({ limites, data: '2026-09-10', entregasNoDia: 3 }).cabe,
    ).toBe(true);
    expect(
      avaliarLimiteEntregas({ limites, data: '2026-10-10', entregasNoDia: 3 }).cabe,
    ).toBe(false);
  });
});

describe('janelasSeSobrepoem', () => {
  it('setembro e novembro podem conviver', () => {
    const a = janela({ validoDe: '2026-09-01', validoAte: '2026-09-30' });
    const b = janela({ validoDe: '2026-11-01', validoAte: '2026-11-30' });
    expect(janelasSeSobrepoem(a, b)).toBe(false);
    expect(janelasSeSobrepoem(b, a)).toBe(false);
  });

  it('cadastrar 15/09–15/10 em cima de 01/09–30/09 é recusado', () => {
    const a = janela({ validoDe: '2026-09-01', validoAte: '2026-09-30' });
    const b = janela({ validoDe: '2026-09-15', validoAte: '2026-10-15' });
    expect(janelasSeSobrepoem(a, b)).toBe(true);
    expect(janelasSeSobrepoem(b, a)).toBe(true);
  });

  it('uma semana dentro do mês já é sobreposição', () => {
    const mes = janela({ validoDe: '2026-09-01', validoAte: '2026-09-30' });
    const semana = janela({ validoDe: '2026-09-10', validoAte: '2026-09-16' });
    expect(janelasSeSobrepoem(mes, semana)).toBe(true);
    expect(janelasSeSobrepoem(semana, mes)).toBe(true);
  });

  it('vigência aberta engole qualquer período futuro', () => {
    const aberta = janela({ validoDe: '2026-09-01', validoAte: null });
    const futura = janela({ validoDe: '2027-03-01', validoAte: '2027-03-31' });
    expect(janelasSeSobrepoem(aberta, futura)).toBe(true);
    expect(janelasSeSobrepoem(futura, aberta)).toBe(true);
  });

  it('vigência aberta convive com período que terminou antes de ela começar', () => {
    const aberta = janela({ validoDe: '2026-09-01', validoAte: null });
    const passada = janela({ validoDe: '2026-07-01', validoAte: '2026-08-31' });
    expect(janelasSeSobrepoem(aberta, passada)).toBe(false);
    expect(janelasSeSobrepoem(passada, aberta)).toBe(false);
  });

  // As bordas são inclusivas: no dia 30/09 as duas janelas valeriam, e ninguém
  // saberia qual teto usar naquele dia.
  it('duas janelas que se tocam no mesmo dia colidem nesse dia', () => {
    const a = janela({ validoDe: '2026-09-01', validoAte: '2026-09-30' });
    const b = janela({ validoDe: '2026-09-30', validoAte: '2026-10-31' });
    expect(janelasSeSobrepoem(a, b)).toBe(true);
    expect(janelasSeSobrepoem(b, a)).toBe(true);
  });

  it('emendar no dia seguinte é o jeito certo de encostar duas janelas', () => {
    const a = janela({ validoDe: '2026-09-01', validoAte: '2026-09-30' });
    const b = janela({ validoDe: '2026-10-01', validoAte: '2026-10-31' });
    expect(janelasSeSobrepoem(a, b)).toBe(false);
  });

  it('duas vigências abertas sempre colidem', () => {
    const a = janela({ validoDe: '2026-09-01', validoAte: null });
    const b = janela({ validoDe: '2028-01-01', validoAte: null });
    expect(janelasSeSobrepoem(a, b)).toBe(true);
  });

  it('a janela se sobrepõe a si mesma', () => {
    const a = janela();
    expect(janelasSeSobrepoem(a, a)).toBe(true);
  });
});
