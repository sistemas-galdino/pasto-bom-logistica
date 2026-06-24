// [AGENTE API] Console de administração de usuários (somente logística).
//
//   GET   /api/usuarios              -> UsuarioAdmin[]   (diretório completo)
//   POST  /api/usuarios/convite      -> {usuario,link}   (gera link de acesso; sem e-mail)
//   PATCH /api/usuarios/:id          -> UsuarioAdmin     (papel e/ou nome)
//   PATCH /api/usuarios/:id/status   -> UsuarioAdmin     (ativar/desativar)
//   POST  /api/usuarios/:id/link     -> {link}           (regera link de acesso)
//
// Cruza o Auth (supabase.auth.admin) com a tabela `profiles` (papel/nome).
// O prefixo /api é aplicado no registro do plugin (server.ts).

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import type {
  ConviteUsuarioResposta,
  LinkAcessoResposta,
  PapelUsuario,
  StatusUsuario,
  UsuarioAdmin,
} from '@pastobom/shared';

import { env } from '../../config/env.js';
import { supabase } from '../../db/supabase.js';
import { log } from '../../log.js';
import { exigirLogistica } from '../guards.js';

// ---------------------------------------------------------------------------
// Schemas de validação (zod)
// ---------------------------------------------------------------------------

const papelEnum = z.enum([
  'logistica',
  'almoxarifado',
  'vendedor',
  'motorista',
]);

const conviteSchema = z.object({
  email: z.string().email(),
  nome: z.string().min(1),
  papel: papelEnum,
});

const atualizarSchema = z.object({
  papel: papelEnum.optional(),
  nome: z.string().min(1).optional(),
});

const statusSchema = z.object({
  ativo: z.boolean(),
});

// ---------------------------------------------------------------------------
// Helpers de montagem (Auth + profiles -> UsuarioAdmin)
// ---------------------------------------------------------------------------

/**
 * Subconjunto dos campos do usuário do Auth que usamos. Alguns vêm em
 * snake_case e podem não estar no tipo do SDK — daí o cast seguro nos usos.
 */
interface AuthUserParcial {
  id: string;
  email?: string | null;
  created_at: string;
  last_sign_in_at?: string | null;
  email_confirmed_at?: string | null;
  banned_until?: string | null;
}

interface PerfilParcial {
  papel: PapelUsuario | null;
  nome: string;
}

/** Deriva o status de acesso a partir dos campos do Auth. */
function derivarStatus(u: AuthUserParcial): StatusUsuario {
  const banidoAte = u.banned_until ?? null;
  if (banidoAte && new Date(banidoAte).getTime() > Date.now()) {
    return 'inativo';
  }
  if (!u.email_confirmed_at) {
    return 'pendente';
  }
  return 'ativo';
}

/** Monta o UsuarioAdmin a partir do usuário do Auth + o perfil (se houver). */
function mapearUsuario(u: AuthUserParcial, perfil?: PerfilParcial): UsuarioAdmin {
  return {
    id: u.id,
    email: u.email ?? '',
    nome: perfil?.nome ?? '',
    papel: perfil?.papel ?? null,
    status: derivarStatus(u),
    ultimoAcesso: u.last_sign_in_at ?? null,
    criadoEm: u.created_at,
  };
}

/**
 * Relê um usuário (Auth + profiles) e aplica a mesma derivação do GET.
 * Reusado pelos PATCH. Retorna null se o usuário não existir no Auth.
 */
async function montarUsuario(id: string): Promise<UsuarioAdmin | null> {
  const { data, error } = await supabase.auth.admin.getUserById(id);
  if (error || !data?.user) return null;

  const { data: perfil } = await supabase
    .from('profiles')
    .select('papel, nome')
    .eq('id', id)
    .maybeSingle<{ papel: PapelUsuario | null; nome: string | null }>();

  const u = data.user as unknown as AuthUserParcial;
  return mapearUsuario(
    u,
    perfil
      ? { papel: perfil.papel ?? null, nome: perfil.nome ?? '' }
      : undefined,
  );
}

/** Ordena por nome (vazios por último); empata pelo e-mail. */
function ordenarPorNome(a: UsuarioAdmin, b: UsuarioAdmin): number {
  const na = a.nome.trim();
  const nb = b.nome.trim();
  if (na && !nb) return -1;
  if (!na && nb) return 1;
  const chaveA = na || a.email;
  const chaveB = nb || b.email;
  return chaveA.localeCompare(chaveB, 'pt-BR');
}

// ---------------------------------------------------------------------------
// Plugin de rotas
// ---------------------------------------------------------------------------

export async function usuariosRoutes(app: FastifyInstance): Promise<void> {
  // GET /usuarios  -> diretório completo (Auth cruzado com profiles)
  app.get('/usuarios', async (req, reply) => {
    if (!exigirLogistica(req, reply)) return reply;
    try {
      const { data: lista, error } = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (error) {
        log.error(`[GET /usuarios] erro ao listar usuários: ${error.message}`);
        return reply
          .code(500)
          .send({ error: 'erro_admin', message: error.message });
      }

      const { data: perfis } = await supabase
        .from('profiles')
        .select('id, papel, nome');

      const mapaPerfis = new Map<string, PerfilParcial>();
      for (const p of perfis ?? []) {
        mapaPerfis.set(p.id as string, {
          papel: (p.papel as PapelUsuario | null) ?? null,
          nome: (p.nome as string) ?? '',
        });
      }

      const usuarios: UsuarioAdmin[] = (lista.users ?? []).map((u) =>
        mapearUsuario(u as unknown as AuthUserParcial, mapaPerfis.get(u.id)),
      );
      usuarios.sort(ordenarPorNome);

      return reply.send(usuarios);
    } catch (err) {
      return responderErro(reply, err, '[GET /usuarios]');
    }
  });

  // POST /usuarios/convite  -> convida por e-mail e cria o perfil
  app.post('/usuarios/convite', async (req, reply) => {
    if (!exigirLogistica(req, reply)) return reply;
    const parsed = conviteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body_invalido',
        message: 'Dados do convite inválidos (e-mail, nome e papel).',
        detalhes: parsed.error.issues,
      });
    }

    try {
      const redirectTo = `${env.APP_URL}/definir-senha`;
      // Gera o link de convite SEM enviar e-mail: a logística repassa o link
      // (ex.: WhatsApp) e o colaborador define a própria senha em /definir-senha.
      const { data, error } = await supabase.auth.admin.generateLink({
        type: 'invite',
        email: parsed.data.email,
        options: { data: { nome: parsed.data.nome }, redirectTo },
      });

      if (error) {
        // Usuário já existe no Auth -> conflito de negócio (não é erro de infra).
        if (/already|registered|exists/i.test(error.message)) {
          return reply.code(422).send({
            error: 'usuario_existe',
            message: 'Já existe um usuário com este e-mail.',
          });
        }
        log.error(`[POST /usuarios/convite] falha ao gerar link: ${error.message}`);
        return reply
          .code(502)
          .send({ error: 'erro_convite', message: error.message });
      }

      const novo = data.user;
      const link = data.properties?.action_link ?? '';
      await supabase
        .from('profiles')
        .upsert({ id: novo.id, papel: parsed.data.papel, nome: parsed.data.nome });

      const u = novo as unknown as AuthUserParcial;
      const usuario: UsuarioAdmin = {
        id: u.id,
        email: u.email ?? parsed.data.email,
        nome: parsed.data.nome,
        papel: parsed.data.papel,
        status: 'pendente',
        ultimoAcesso: null,
        criadoEm: u.created_at,
      };
      const resposta: ConviteUsuarioResposta = { usuario, link };
      return reply.code(201).send(resposta);
    } catch (err) {
      return responderErro(reply, err, '[POST /usuarios/convite]');
    }
  });

  // PATCH /usuarios/:id  -> atualiza papel e/ou nome no perfil
  app.patch('/usuarios/:id', async (req, reply) => {
    if (!exigirLogistica(req, reply)) return reply;
    const { id } = req.params as { id: string };
    const parsed = atualizarSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body_invalido',
        message: 'Dados de atualização inválidos (papel e/ou nome).',
        detalhes: parsed.error.issues,
      });
    }

    // Anti-lockout: a logística não pode remover o próprio acesso.
    if (
      req.usuario?.id === id &&
      parsed.data.papel !== undefined &&
      parsed.data.papel !== 'logistica'
    ) {
      return reply.code(422).send({
        error: 'auto_rebaixamento',
        message: 'Você não pode remover o próprio acesso de logística.',
      });
    }

    const patch: { papel?: PapelUsuario; nome?: string } = {};
    if (parsed.data.papel !== undefined) patch.papel = parsed.data.papel;
    if (parsed.data.nome !== undefined) patch.nome = parsed.data.nome;
    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({
        error: 'body_invalido',
        message: 'Informe ao menos um campo para atualizar (papel ou nome).',
      });
    }

    try {
      const { error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', id);
      if (error) {
        log.error(`[PATCH /usuarios/${id}] erro ao atualizar perfil: ${error.message}`);
        return reply
          .code(500)
          .send({ error: 'erro_banco', message: error.message });
      }

      const usuario = await montarUsuario(id);
      if (!usuario) {
        return reply
          .code(404)
          .send({ error: 'nao_encontrado', message: 'Usuário não encontrado.' });
      }
      return reply.send(usuario);
    } catch (err) {
      return responderErro(reply, err, `[PATCH /usuarios/${id}]`);
    }
  });

  // PATCH /usuarios/:id/status  -> ativa/desativa (ban no Auth)
  app.patch('/usuarios/:id/status', async (req, reply) => {
    if (!exigirLogistica(req, reply)) return reply;
    const { id } = req.params as { id: string };
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body_invalido',
        message: 'Informe ativo: boolean.',
        detalhes: parsed.error.issues,
      });
    }

    // Anti-lockout: a logística não pode desativar a si mesma.
    if (req.usuario?.id === id && parsed.data.ativo === false) {
      return reply.code(422).send({
        error: 'auto_desativacao',
        message: 'Você não pode desativar a si mesmo.',
      });
    }

    try {
      const { error } = await supabase.auth.admin.updateUserById(id, {
        ban_duration: parsed.data.ativo ? 'none' : '876600h',
      });
      if (error) {
        log.error(`[PATCH /usuarios/${id}/status] erro ao atualizar: ${error.message}`);
        return reply
          .code(500)
          .send({ error: 'erro_admin', message: error.message });
      }

      const usuario = await montarUsuario(id);
      if (!usuario) {
        return reply
          .code(404)
          .send({ error: 'nao_encontrado', message: 'Usuário não encontrado.' });
      }
      return reply.send(usuario);
    } catch (err) {
      return responderErro(reply, err, `[PATCH /usuarios/${id}/status]`);
    }
  });

  // POST /usuarios/:id/link  -> (re)gera um link de acesso (recovery) para a
  // pessoa definir/redefinir a senha. Útil quando o link de convite expirou.
  app.post('/usuarios/:id/link', async (req, reply) => {
    if (!exigirLogistica(req, reply)) return reply;
    const { id } = req.params as { id: string };
    try {
      const { data: alvo, error: erroBusca } =
        await supabase.auth.admin.getUserById(id);
      if (erroBusca || !alvo?.user?.email) {
        return reply
          .code(404)
          .send({ error: 'nao_encontrado', message: 'Usuário não encontrado.' });
      }

      const redirectTo = `${env.APP_URL}/definir-senha`;
      const { data, error } = await supabase.auth.admin.generateLink({
        type: 'recovery',
        email: alvo.user.email,
        options: { redirectTo },
      });
      if (error) {
        log.error(`[POST /usuarios/${id}/link] falha ao gerar link: ${error.message}`);
        return reply
          .code(502)
          .send({ error: 'erro_link', message: error.message });
      }

      const resposta: LinkAcessoResposta = {
        link: data.properties?.action_link ?? '',
      };
      return reply.send(resposta);
    } catch (err) {
      return responderErro(reply, err, `[POST /usuarios/${id}/link]`);
    }
  });
}

// ---------------------------------------------------------------------------
// Tratamento de erro inesperado (mesmo padrão de pedidos.ts)
// ---------------------------------------------------------------------------

function responderErro(reply: FastifyReply, err: unknown, contexto: string) {
  const mensagem = err instanceof Error ? err.message : String(err);
  log.error(`${contexto} erro inesperado: ${mensagem}`);
  return reply.code(500).send({ error: 'erro_interno', message: mensagem });
}
