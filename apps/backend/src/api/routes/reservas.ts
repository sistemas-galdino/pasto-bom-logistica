// [AGENTE API] Reservas de caminhão (o card avulso do Johnny).
//
//   GET   /api/reservas?de=&ate=&caminhaoId=&status=  -> Reserva[]  (equipe)
//   POST  /api/reservas                               -> 201        (logística)
//   PATCH /api/reservas/:id                           -> Reserva    (logística)
//   POST  /api/reservas/:id/cancelar                  -> Reserva    (logística)
//   GET   /api/minhas-reservas                        -> Reserva[]  (motorista)
//
// Não há DELETE: cancelar guarda o histórico, como em entregas e caminhões.
//
// `/minhas-reservas` existe em vez de a reserva entrar em `/minhas-entregas`
// porque aquela rota devolve `Entrega[]` e seu consumidor (RotaDoDia) indexa o
// clima por `pedidoId` e espera cliente e itens — coisas que reserva não tem.
// Misturar os dois tipos ali quebraria a tela do motorista em runtime.
//
// O prefixo /api é aplicado no registro do plugin (server.ts).

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { log } from "../../log.js";
import { exigirLogistica } from "../guards.js";
import { TransicaoError } from "../../services/erros.js";
import {
  atualizarReserva,
  cancelarReserva,
  carregarReserva,
  criarReserva,
  listarReservas,
} from "../../services/reservas.js";

// ---------------------------------------------------------------------------
// Schemas de validação (zod)
// ---------------------------------------------------------------------------

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

const textoOpcional = z.string().trim().max(500).nullable().optional();

const criarSchema = z.object({
  // O serviço é o título do card: sem ele o card não diz nada, e o banco tem
  // check de string não vazia — melhor recusar aqui, com mensagem.
  servico: z.string().trim().min(1).max(200),
  dataAgendada: z.string().regex(DATA_ISO, "Use o formato YYYY-MM-DD."),
  periodo: z.enum(["manha", "tarde"]),
  caminhaoId: z.string().uuid(),
  motoristaId: z.string().uuid().nullable().optional(),
  fornecedorCodigo: z.string().trim().max(60).nullable().optional(),
  cidade: z.string().trim().max(120).nullable().optional(),
  produtos: textoOpcional,
  pesoPrevistoKg: z.number().finite().nonnegative().nullable().optional(),
  // Ausente = true: o pedido literal do Johnny é RESERVAR o caminhão. Quem
  // quer dividir o período (coleta de adubo) desmarca na tela.
  bloqueiaCaminhao: z.boolean().optional(),
  observacoes: textoOpcional,
});

const atualizarSchema = criarSchema
  .partial()
  .refine((o) => Object.keys(o).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });

const listarSchema = z.object({
  de: z.string().regex(DATA_ISO).optional(),
  ate: z.string().regex(DATA_ISO).optional(),
  caminhaoId: z.string().uuid().optional(),
  status: z.enum(["ativa", "cancelada"]).optional(),
});

// ---------------------------------------------------------------------------
// Guard local
// ---------------------------------------------------------------------------

/**
 * 403 para o motorista na listagem geral: ele tem `/minhas-reservas`. Os outros
 * papéis leem — o vendedor precisa saber que o caminhão está tomado antes de
 * prometer data ao cliente, que é a mesma razão de a agenda ser aberta a ele.
 */
function exigirLeituraReservas(
  req: FastifyRequest,
  reply: FastifyReply,
): boolean {
  const papel = req.usuario?.papel;
  if (!req.usuario || papel !== "motorista") return true;
  reply.code(403).send({
    error: "sem_permissao",
    message: "Use a sua rota do dia para ver as suas reservas.",
  });
  return false;
}

// ---------------------------------------------------------------------------
// Plugin de rotas
// ---------------------------------------------------------------------------

export async function reservasRoutes(app: FastifyInstance): Promise<void> {
  app.get("/reservas", async (req, reply) => {
    if (!exigirLeituraReservas(req, reply)) return reply;

    const parsed = listarSchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "query_invalida",
        message: "Filtros inválidos (de, ate, caminhaoId, status).",
        detalhes: parsed.error.issues,
      });
    }

    try {
      return reply.send(await listarReservas(parsed.data));
    } catch (err) {
      return responderErro(reply, err, "[GET /reservas]");
    }
  });

  app.get("/reservas/:id", async (req, reply) => {
    if (!exigirLeituraReservas(req, reply)) return reply;
    const { id } = req.params as { id: string };

    try {
      const reserva = await carregarReserva(id);
      if (!reserva) {
        return reply
          .code(404)
          .send({
            error: "nao_encontrado",
            message: "Reserva não encontrada.",
          });
      }
      return reply.send(reserva);
    } catch (err) {
      return responderErro(reply, err, `[GET /reservas/${id}]`);
    }
  });

  app.post("/reservas", async (req, reply) => {
    if (!exigirLogistica(req, reply)) return reply;

    const parsed = criarSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "body_invalido",
        message: "Informe serviço, data, período e caminhão.",
        detalhes: parsed.error.issues,
      });
    }

    try {
      const reserva = await criarReserva({
        ...parsed.data,
        usuarioId: req.usuario?.id ?? null,
      });
      return reply.code(201).send(reserva);
    } catch (err) {
      return responderErro(reply, err, "[POST /reservas]");
    }
  });

  app.patch("/reservas/:id", async (req, reply) => {
    if (!exigirLogistica(req, reply)) return reply;
    const { id } = req.params as { id: string };

    const parsed = atualizarSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "body_invalido",
        message: "Dados de atualização inválidos.",
        detalhes: parsed.error.issues,
      });
    }

    try {
      return reply.send(await atualizarReserva(id, parsed.data));
    } catch (err) {
      return responderErro(reply, err, `[PATCH /reservas/${id}]`);
    }
  });

  app.post("/reservas/:id/cancelar", async (req, reply) => {
    if (!exigirLogistica(req, reply)) return reply;
    const { id } = req.params as { id: string };

    try {
      return reply.send(await cancelarReserva(id));
    } catch (err) {
      return responderErro(reply, err, `[POST /reservas/${id}/cancelar]`);
    }
  });

  // GET /minhas-reservas — o motorista vê, não mexe.
  //
  // Filtro pelo uid do token, nunca por parâmetro: o motorista não escolhe de
  // quem é a reserva. Só da data de hoje em diante — reserva de semana passada
  // não é rota de ninguém.
  app.get("/minhas-reservas", async (req, reply) => {
    const usuario = req.usuario;
    if (!usuario) return reply.send([]);

    try {
      const hoje = new Date();
      const iso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(
        2,
        "0",
      )}-${String(hoje.getDate()).padStart(2, "0")}`;
      const reservas = await listarReservas({
        motoristaId: usuario.id ?? undefined,
        de: iso,
      });
      return reply.send(reservas);
    } catch (err) {
      return responderErro(reply, err, "[GET /minhas-reservas]");
    }
  });
}

// ---------------------------------------------------------------------------
// Erro (mesmo padrão de routes/entregas.ts)
// ---------------------------------------------------------------------------

function responderErro(reply: FastifyReply, err: unknown, contexto: string) {
  if (err instanceof TransicaoError) {
    return reply
      .code(err.statusCode)
      .send({ error: err.codigo, message: err.message });
  }
  const mensagem = err instanceof Error ? err.message : String(err);
  log.error(`${contexto} erro inesperado: ${mensagem}`);
  return reply.code(500).send({ error: "erro_interno", message: mensagem });
}
