// Normalização de números de telefone brasileiros para WhatsApp.
//
// FONTE ÚNICA de regra de número, usada por ingestão (worker), envio
// (transitions) e auditoria de cobertura. A partir de um campo de cadastro do
// Órix (texto livre, bagunçado) decide o número canônico que a Evolution API
// exige: dígitos "55DDD9XXXXXXXX" (sem "+"), ou null quando não houver um
// número MÓVEL alcançável (fixo não recebe WhatsApp).
//
// Trata o lixo comum do cadastro: zeros de tronco / DDI ("0", "00", "+055"),
// código de país 55, e celulares legados de 10 dígitos (sem o 9º dígito).
// A classificação móvel × fixo usa a base de numeração do libphonenumber-js.

import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

export type WhatsappTipo = 'movel' | 'fixo' | 'invalido' | 'vazio';

export interface NumeroWhatsapp {
  /** Número canônico p/ Evolution (dígitos "55DDD9XXXXXXXX"); null se não-móvel. */
  e164: string | null;
  tipo: WhatsappTipo;
}

export interface EscolhaWhatsapp extends NumeroWhatsapp {
  /** De qual campo do cadastro veio o resultado. */
  origem: 'celular' | 'telefone' | null;
}

const soDigitos = (s: string): string => s.replace(/\D+/g, '');

/**
 * Reduz um texto bagunçado a um número NACIONAL brasileiro (DDD + assinante).
 * Zeros à esquerda nunca compõem DDD/DDI no Brasil → são tronco/DDI e saem.
 * Remove o DDI 55 quando o tamanho indica número nacional. Retorna 10 ou 11
 * dígitos (DDD + 8/9) ou null se não der pra interpretar com segurança.
 */
function nacionalBR(raw: string): string | null {
  let d = soDigitos(raw).replace(/^0+/, '');
  if (!d) return null;
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    d = d.slice(2);
  }
  return d.length === 10 || d.length === 11 ? d : null;
}

/** Avalia um candidato nacional (DDD+assinante) via libphonenumber. */
function avaliar(nacional: string): NumeroWhatsapp | null {
  const pn = parsePhoneNumberFromString(nacional, 'BR');
  if (!pn || !pn.isValid()) return null;
  const tipo = pn.getType();
  const movel = tipo === 'MOBILE' || tipo === 'FIXED_LINE_OR_MOBILE';
  return {
    e164: movel ? soDigitos(pn.number) : null,
    tipo: movel ? 'movel' : 'fixo',
  };
}

/**
 * Normaliza UM campo de telefone para WhatsApp:
 *   vazio/sem dígitos        -> { e164: null, tipo: 'vazio' }
 *   móvel                    -> { e164: "55DDD9XXXXXXXX", tipo: 'movel' }
 *   fixo                     -> { e164: null, tipo: 'fixo' }
 *   irreconhecível           -> { e164: null, tipo: 'invalido' }
 * Recupera celular legado de 10 dígitos (sem o 9º) inserindo o 9.
 *
 * Exemplos:
 *   "(35) 99999-8888"     -> { e164: "5535999998888", tipo: 'movel' }
 *   "+055 35 99999-8888"  -> { e164: "5535999998888", tipo: 'movel' }
 *   "035 99999-8888"      -> { e164: "5535999998888", tipo: 'movel' }
 *   "(35) 3201-1234"      -> { e164: null,            tipo: 'fixo'  }
 *   ""                    -> { e164: null,            tipo: 'vazio' }
 */
export function normalizarWhatsApp(raw: string | null | undefined): NumeroWhatsapp {
  if (!raw || !soDigitos(raw)) return { e164: null, tipo: 'vazio' };

  const nacional = nacionalBR(raw);
  if (!nacional) return { e164: null, tipo: 'invalido' };

  const direto = avaliar(nacional);
  if (direto?.tipo === 'movel') return direto;

  // Recuperação do 9º dígito: 10 dígitos (DDD + 8) com assinante de faixa móvel.
  if (nacional.length === 10) {
    const ddd = nacional.slice(0, 2);
    const assinante = nacional.slice(2);
    if (/^[6-9]/.test(assinante)) {
      const com9 = avaliar(`${ddd}9${assinante}`);
      if (com9?.tipo === 'movel') return com9;
    }
  }

  return direto ?? { e164: null, tipo: 'invalido' };
}

/**
 * Escolhe o melhor número de WhatsApp entre os campos `celular` e `telefone`
 * do cadastro Órix (o móvel frequentemente está guardado no campo `telefone`).
 * Preferência: o primeiro que resultar em MÓVEL. Se nenhum for móvel, devolve o
 * primeiro resultado não-vazio (para registrar o tipo) com sua origem.
 */
export function escolherNumeroWhatsApp(
  celular: string | null | undefined,
  telefone: string | null | undefined,
): EscolhaWhatsapp {
  const campos: ReadonlyArray<readonly ['celular' | 'telefone', string | null | undefined]> = [
    ['celular', celular],
    ['telefone', telefone],
  ];

  let fallback: EscolhaWhatsapp | null = null;
  for (const [origem, raw] of campos) {
    if (!raw || !soDigitos(raw)) continue;
    const r = normalizarWhatsApp(raw);
    if (r.tipo === 'movel') return { ...r, origem };
    if (!fallback) fallback = { ...r, origem };
  }
  return fallback ?? { e164: null, tipo: 'vazio', origem: null };
}
