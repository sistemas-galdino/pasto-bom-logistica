// [AGENTE API] Link curto de acesso — rotas PÚBLICAS (sem token de sessão).
//
//   GET  /api/acesso/:token  -> {valido,nome?,motivo?}  (só consulta, não gasta)
//   POST /api/acesso/:token  -> {url}                   (gera o link do Supabase)
//
// A separação entre GET e POST é o coração da correção. O robô de
// pré-visualização do WhatsApp faz GET ao encontrar uma URL numa mensagem — e o
// GET aqui não consome nada. Só o POST, disparado pelo botão que a pessoa
// clica, gera o link do Supabase. Era exatamente isso que queimava o link antes
// de a pessoa abrir.
//
// Estas rotas ficam num escopo SEM o hook de autenticação (ver server.ts): quem
// vai usá-las ainda não tem senha.

import type { FastifyInstance } from 'fastify';

import type {
  AcessoConfirmadoResposta,
  EstadoLinkAcesso,
} from '@pastobom/shared';

import { env } from '../../config/env.js';
import { supabase } from '../../db/supabase.js';
import { log } from '../../log.js';
import {
  marcarUso,
  situacaoDoToken,
} from '../../services/link-acesso.js';

// Limitador simples em memória. O token tem 128 bits — força bruta é inviável —,
// então isto é contra martelada (cada POST dispara uma chamada ao Supabase), não
// contra adivinhação. Em memória basta: o serviço roda com 1 réplica.
const TETO_POR_MINUTO = 20;
const tentativas = new Map<string, { contagem: number; janelaMs: number }>();

function excedeuLimite(ip: string): boolean {
  const agora = Date.now();
  const atual = tentativas.get(ip);
  if (!atual || agora - atual.janelaMs >= 60_000) {
    tentativas.set(ip, { contagem: 1, janelaMs: agora });
    return false;
  }
  atual.contagem += 1;
  // Poda oportunista: sem isto o Map cresceria para sempre num processo longo.
  if (tentativas.size > 5_000) {
    for (const [chave, v] of tentativas) {
      if (agora - v.janelaMs >= 60_000) tentativas.delete(chave);
    }
  }
  return atual.contagem > TETO_POR_MINUTO;
}

/** Primeiro nome: a página cumprimenta sem expor o nome completo de ninguém. */
function primeiroNome(nome: string | null): string | undefined {
  const limpo = (nome ?? '').trim();
  if (!limpo) return undefined;
  return limpo.split(/\s+/)[0];
}

export async function acessoRoutes(app: FastifyInstance): Promise<void> {
  // Consulta o estado do link. NÃO consome nada — é o que torna a
  // pré-visualização do WhatsApp inofensiva.
  app.get('/acesso/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const { situacao, perfil } = await situacaoDoToken(token);

    const resposta: EstadoLinkAcesso =
      situacao === 'valido'
        ? { valido: true, nome: primeiroNome(perfil?.nome ?? null) }
        : { valido: false, motivo: situacao };

    // Sem cache: o estado muda quando a senha é criada, e um intermediário
    // guardando "válido" atrapalharia mais do que ajuda.
    return reply.header('cache-control', 'no-store').send(resposta);
  });

  // Confirma: gera o link do Supabase AGORA e devolve para onde ir.
  app.post('/acesso/:token', async (req, reply) => {
    if (excedeuLimite(req.ip)) {
      return reply
        .code(429)
        .send({ error: 'muitas_tentativas', message: 'Tente de novo em um minuto.' });
    }

    const { token } = req.params as { token: string };
    const { situacao, perfil } = await situacaoDoToken(token);

    if (situacao !== 'valido' || !perfil) {
      return reply.code(410).send({
        error: 'link_invalido',
        message:
          situacao === 'expirado'
            ? 'Este link expirou. Peça um novo à logística.'
            : 'Este link não é mais válido. Peça um novo à logística.',
      });
    }

    const { data: alvo, error: erroBusca } =
      await supabase.auth.admin.getUserById(perfil.id);
    if (erroBusca || !alvo?.user?.email) {
      log.error(
        `[acesso] Usuário ${perfil.id} tem link válido mas não foi encontrado no Auth.`,
      );
      return reply.code(410).send({
        error: 'link_invalido',
        message: 'Este link não é mais válido. Peça um novo à logística.',
      });
    }

    // O link do Supabase nasce aqui, com a pessoa na tela: o prazo dele começa
    // a correr agora e é consumido em segundos.
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email: alvo.user.email,
      options: { redirectTo: `${env.APP_URL}/definir-senha` },
    });

    const url = data?.properties?.action_link ?? '';
    if (error || !url) {
      log.error(
        `[acesso] Falha ao gerar link do Supabase para ${perfil.id}: ${error?.message ?? 'sem action_link'}`,
      );
      return reply.code(502).send({
        error: 'erro_link',
        message: 'Não foi possível abrir o acesso agora. Tente de novo.',
      });
    }

    // Carimbo de auditoria; NÃO invalida o link (se o redirecionamento falhar,
    // a pessoa precisa poder tentar outra vez).
    await marcarUso(perfil.id);

    const resposta: AcessoConfirmadoResposta = { url };
    return reply.send(resposta);
  });
}
