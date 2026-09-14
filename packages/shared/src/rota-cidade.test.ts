import { describe, expect, it } from 'vitest';
import {
  chaveCidade,
  diaDaSemanaIso,
  expandirRotasCidade,
  rotasConflitam,
  type RotaCidadeConfig,
} from './rota-cidade.js';

function config(over: Partial<RotaCidadeConfig> = {}): RotaCidadeConfig {
  return {
    id: 'r1',
    cidade: 'Cabo Verde',
    diasSemana: [2], // terça
    periodos: ['manha'],
    validoDe: '2026-09-01',
    validoAte: null,
    ativo: true,
    ...over,
  };
}

/** Rótulo curto: o teste falha dizendo QUAL dia, não "objeto != objeto". */
const chaves = (r: ReturnType<typeof expandirRotasCidade>): string[] =>
  r.map((x) => `${x.data}|${x.periodo}|${x.cidade}`);

describe('diaDaSemanaIso', () => {
  // O TESTE DE FUSO. Em UTC-3, `new Date('2026-09-15').getDay()` devolve 1
  // (segunda) e a rota de terça apareceria na segunda, sem erro nenhum.
  it('15/09/2026 é terça-feira (2), e não segunda', () => {
    expect(diaDaSemanaIso('2026-09-15')).toBe(2);
  });

  it('conhece a semana inteira', () => {
    expect(diaDaSemanaIso('2026-09-13')).toBe(0); // domingo
    expect(diaDaSemanaIso('2026-09-14')).toBe(1);
    expect(diaDaSemanaIso('2026-09-16')).toBe(3);
    expect(diaDaSemanaIso('2026-09-17')).toBe(4);
    expect(diaDaSemanaIso('2026-09-18')).toBe(5);
    expect(diaDaSemanaIso('2026-09-19')).toBe(6); // sábado
  });

  it('atravessa a virada de ano sem escorregar', () => {
    expect(diaDaSemanaIso('2026-12-31')).toBe(4);
    expect(diaDaSemanaIso('2027-01-01')).toBe(5);
  });

  // Date.UTC(2027, 1, 30) rola para 02/03 sem reclamar.
  it('data que não existe devolve null, não rola para o mês seguinte', () => {
    expect(diaDaSemanaIso('2027-02-29')).toBeNull();
    expect(diaDaSemanaIso('2026-04-31')).toBeNull();
    expect(diaDaSemanaIso('2026-13-01')).toBeNull();
    expect(diaDaSemanaIso('15/09/2026')).toBeNull();
    expect(diaDaSemanaIso('')).toBeNull();
  });

  it('29/02 de ano bissexto é dia válido', () => {
    expect(diaDaSemanaIso('2028-02-29')).toBe(2);
  });
});

describe('chaveCidade', () => {
  it('iguala caixa, acento e espaço sobrando', () => {
    expect(chaveCidade('cabo verde')).toBe('CABO VERDE');
    expect(chaveCidade('  CABO   VERDE ')).toBe('CABO VERDE');
    expect(chaveCidade('São João')).toBe(chaveCidade('sao joao'));
  });

  it('cidade em branco vira chave vazia', () => {
    expect(chaveCidade('   ')).toBe('');
  });

  it('não normaliza para exibição: só compara', () => {
    // A grafia digitada é a que o chip mostra — quem exibe usa `cidade`, não isto.
    expect(chaveCidade('são joão del-rei')).toBe('SAO JOAO DEL-REI');
  });
});

describe('expandirRotasCidade', () => {
  it('toda terça de manhã, na semana pedida', () => {
    const r = expandirRotasCidade([config()], '2026-09-13', '2026-09-19');
    expect(chaves(r)).toEqual(['2026-09-15|manha|Cabo Verde']);
  });

  it('duas terças e duas quintas no mês', () => {
    const r = expandirRotasCidade(
      [config({ diasSemana: [2, 4] })],
      '2026-09-13',
      '2026-09-26',
    );
    expect(r.map((x) => x.data)).toEqual([
      '2026-09-15',
      '2026-09-17',
      '2026-09-22',
      '2026-09-24',
    ]);
  });

  it('dia inteiro gera manhã e tarde, nessa ordem', () => {
    const r = expandirRotasCidade(
      [config({ periodos: ['tarde', 'manha'] })],
      '2026-09-15',
      '2026-09-15',
    );
    expect(r.map((x) => x.periodo)).toEqual(['manha', 'tarde']);
  });

  // A grade 27/09–03/10, que é a semana que a tela desenha de verdade.
  it('semana que atravessa a virada de mês não perde nem duplica dia', () => {
    const r = expandirRotasCidade(
      [config({ diasSemana: [0, 1, 2, 3, 4, 5, 6] })],
      '2026-09-27',
      '2026-10-03',
    );
    expect(r.map((x) => x.data)).toEqual([
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
  });

  // A grade do MÊS inclui dias do mês anterior e do seguinte.
  it('grade de mês com dias de fora do mês funciona igual', () => {
    const r = expandirRotasCidade(
      [config({ diasSemana: [2], validoDe: '2026-01-01' })],
      '2026-08-30',
      '2026-10-03',
    );
    expect(r.map((x) => x.data)).toEqual([
      '2026-09-01',
      '2026-09-08',
      '2026-09-15',
      '2026-09-22',
      '2026-09-29',
    ]);
  });

  it('atravessa a virada de ano', () => {
    const r = expandirRotasCidade(
      [config({ diasSemana: [5], validoDe: '2026-01-01' })],
      '2026-12-27',
      '2027-01-02',
    );
    expect(r.map((x) => x.data)).toEqual(['2027-01-01']);
  });

  it('inclui 29/02 em ano bissexto', () => {
    const r = expandirRotasCidade(
      [config({ diasSemana: [2], validoDe: '2028-01-01' })],
      '2028-02-27',
      '2028-03-04',
    );
    expect(r.map((x) => x.data)).toEqual(['2028-02-29']);
  });

  it('a borda da vigência é inclusiva nas duas pontas', () => {
    const r = expandirRotasCidade(
      [
        config({
          diasSemana: [1, 2, 3, 4, 5],
          validoDe: '2026-09-15',
          validoAte: '2026-09-17',
        }),
      ],
      '2026-09-13',
      '2026-09-19',
    );
    expect(r.map((x) => x.data)).toEqual([
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
    ]);
  });

  it('a borda da janela consultada também é inclusiva', () => {
    const r = expandirRotasCidade([config()], '2026-09-15', '2026-09-15');
    expect(r).toHaveLength(1);
  });

  it('vigência aberta vale anos à frente', () => {
    const r = expandirRotasCidade([config()], '2029-05-01', '2029-05-08');
    expect(r.map((x) => x.data)).toEqual(['2029-05-01', '2029-05-08']);
  });

  it('vigência que ainda não começou não aparece', () => {
    const r = expandirRotasCidade(
      [config({ validoDe: '2026-10-01' })],
      '2026-09-13',
      '2026-09-19',
    );
    expect(r).toEqual([]);
  });

  it('vigência vencida não aparece', () => {
    const r = expandirRotasCidade(
      [config({ validoAte: '2026-08-31' })],
      '2026-09-13',
      '2026-09-19',
    );
    expect(r).toEqual([]);
  });

  it('configuração PAUSADA não aparece, mas continua existindo', () => {
    const pausada = config({ ativo: false });
    expect(expandirRotasCidade([pausada], '2026-09-13', '2026-09-19')).toEqual([]);
    expect(pausada.cidade).toBe('Cabo Verde');
  });

  it('duas cidades no mesmo dia, em períodos diferentes, convivem', () => {
    const r = expandirRotasCidade(
      [
        config(),
        config({ id: 'r2', cidade: 'Boa Esperança', periodos: ['tarde'] }),
      ],
      '2026-09-15',
      '2026-09-15',
    );
    expect(chaves(r)).toEqual([
      '2026-09-15|manha|Cabo Verde',
      '2026-09-15|tarde|Boa Esperança',
    ]);
  });

  it('duas cidades no MESMO período convivem — é o uso, não o problema', () => {
    const r = expandirRotasCidade(
      [config(), config({ id: 'r2', cidade: 'Alfenas' })],
      '2026-09-15',
      '2026-09-15',
    );
    expect(r.map((x) => x.cidade)).toEqual(['Alfenas', 'Cabo Verde']);
  });

  // Duas defesas para dois problemas: a 409 evita o cadastro bobo, a dedup
  // protege de corrida de dois cliques e de edição direta no banco.
  it('a mesma cidade em duas configurações gera UM chip, não dois', () => {
    const r = expandirRotasCidade(
      [config(), config({ id: 'r2', cidade: 'CABO  verde' })],
      '2026-09-15',
      '2026-09-15',
    );
    expect(r).toHaveLength(1);
  });

  it('dia da semana fora de 0..6 é ignorado, e os válidos ao lado valem', () => {
    const r = expandirRotasCidade(
      [config({ diasSemana: [2, 9, -1, 3.5] })],
      '2026-09-13',
      '2026-09-19',
    );
    expect(r.map((x) => x.data)).toEqual(['2026-09-15']);
  });

  it('configuração sem dia nenhum válido é ignorada, e as outras seguem', () => {
    const r = expandirRotasCidade(
      [
        config({ id: 'lixo', diasSemana: [99], cidade: 'Lixo' }),
        config({ id: 'boa' }),
      ],
      '2026-09-13',
      '2026-09-19',
    );
    expect(r.map((x) => x.cidade)).toEqual(['Cabo Verde']);
  });

  it('período inválido no array é ignorado', () => {
    const r = expandirRotasCidade(
      [config({ periodos: ['manha', 'noite' as never] })],
      '2026-09-15',
      '2026-09-15',
    );
    expect(r.map((x) => x.periodo)).toEqual(['manha']);
  });

  it('cidade em branco é ignorada', () => {
    const r = expandirRotasCidade(
      [config({ cidade: '   ' })],
      '2026-09-15',
      '2026-09-15',
    );
    expect(r).toEqual([]);
  });

  it('data impossível na vigência é ignorada sem derrubar as outras', () => {
    const r = expandirRotasCidade(
      [
        config({ id: 'ruim', validoDe: '2027-02-29', cidade: 'Ruim' }),
        config({ id: 'boa' }),
      ],
      '2026-09-13',
      '2026-09-19',
    );
    expect(r.map((x) => x.cidade)).toEqual(['Cabo Verde']);
  });

  it('janela consultada invertida devolve vazio', () => {
    expect(expandirRotasCidade([config()], '2026-09-19', '2026-09-13')).toEqual([]);
  });

  it('janela consultada inválida devolve vazio', () => {
    expect(expandirRotasCidade([config()], 'ontem', '2026-09-19')).toEqual([]);
  });

  it('lista vazia devolve vazio', () => {
    expect(expandirRotasCidade([], '2026-09-13', '2026-09-19')).toEqual([]);
  });

  it('a ocorrência carrega o id da configuração e a grafia digitada', () => {
    const r = expandirRotasCidade(
      [config({ id: 'abc', cidade: 'cabo verde' })],
      '2026-09-15',
      '2026-09-15',
    );
    expect(r[0]?.configId).toBe('abc');
    expect(r[0]?.cidade).toBe('cabo verde');
  });

  it('ordena por data, depois manhã antes de tarde, depois cidade', () => {
    const r = expandirRotasCidade(
      [
        config({ id: 'z', cidade: 'Zacarias', periodos: ['manha', 'tarde'] }),
        config({ id: 'a', cidade: 'Alfenas', periodos: ['tarde'] }),
      ],
      '2026-09-15',
      '2026-09-15',
    );
    expect(chaves(r)).toEqual([
      '2026-09-15|manha|Zacarias',
      '2026-09-15|tarde|Alfenas',
      '2026-09-15|tarde|Zacarias',
    ]);
  });
});

describe('rotasConflitam', () => {
  it('mesma cidade, mesmo dia, mesmo período e vigências cruzadas conflita', () => {
    expect(rotasConflitam(config(), config({ id: 'r2' }))).toBe(true);
  });

  it('grafia diferente da mesma cidade conflita', () => {
    expect(
      rotasConflitam(config(), config({ id: 'r2', cidade: 'CABO VERDE' })),
    ).toBe(true);
  });

  it('cidades diferentes nunca conflitam', () => {
    expect(
      rotasConflitam(config(), config({ id: 'r2', cidade: 'Alfenas' })),
    ).toBe(false);
  });

  it('dias sem interseção não conflitam', () => {
    expect(
      rotasConflitam(config({ diasSemana: [2] }), config({ id: 'r2', diasSemana: [4] })),
    ).toBe(false);
  });

  it('um dia em comum entre vários já conflita', () => {
    expect(
      rotasConflitam(
        config({ diasSemana: [1, 2, 3] }),
        config({ id: 'r2', diasSemana: [3, 5] }),
      ),
    ).toBe(true);
  });

  it('períodos sem interseção não conflitam', () => {
    expect(
      rotasConflitam(config(), config({ id: 'r2', periodos: ['tarde'] })),
    ).toBe(false);
  });

  it('vigências que não se cruzam não conflitam', () => {
    expect(
      rotasConflitam(
        config({ validoDe: '2026-09-01', validoAte: '2026-09-30' }),
        config({ id: 'r2', validoDe: '2026-10-01', validoAte: null }),
      ),
    ).toBe(false);
  });

  // Bordas inclusivas: janelas que só se tocam colidem.
  it('vigências que só se tocam conflitam', () => {
    expect(
      rotasConflitam(
        config({ validoDe: '2026-09-01', validoAte: '2026-09-30' }),
        config({ id: 'r2', validoDe: '2026-09-30', validoAte: null }),
      ),
    ).toBe(true);
  });

  it('a configuração não conflita com ela mesma (edição)', () => {
    expect(rotasConflitam(config(), config())).toBe(false);
  });
});
