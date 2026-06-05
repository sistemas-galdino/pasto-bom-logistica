-- 0003_seed_config.sql
-- Configuração inicial (sync_state). Idempotente via ON CONFLICT.
-- Os valores são editáveis em runtime; o worker e a API leem daqui.

-- Status do Órix que disparam ingestão (gatilho principal + variações).
insert into sync_state (chave, valor)
values (
  'status_gatilho',
  '["00041","00045","00027","00028"]'::jsonb
)
on conflict (chave) do update set
  valor = excluded.valor,
  atualizado_em = now();

-- Status que indicam pedido cancelado no Órix.
insert into sync_state (chave, valor)
values (
  'status_cancelado',
  '["00031"]'::jsonb
)
on conflict (chave) do update set
  valor = excluded.valor,
  atualizado_em = now();

-- Status que indicam pedido concluído (faturado) no Órix.
insert into sync_state (chave, valor)
values (
  'status_concluido',
  '["00030"]'::jsonb
)
on conflict (chave) do update set
  valor = excluded.valor,
  atualizado_em = now();

-- Cursor de paginação por data do worker de poll.
insert into sync_state (chave, valor)
values (
  'poll_cursor',
  '{"last_to": null}'::jsonb
)
on conflict (chave) do update set
  valor = excluded.valor,
  atualizado_em = now();

-- Templates de WhatsApp (PT-BR). Placeholders entre {}.
insert into sync_state (chave, valor)
values (
  'templates',
  jsonb_build_object(
    'agendamento', 'Olá, {nome_cliente}! 🚜 Seu pedido nº {numero} da Pasto Bom foi *agendado para entrega em {data_agendada}* na propriedade {propriedade}. Qualquer dúvida, é só responder por aqui. 🙏',
    'em_rota',     'Olá, {nome_cliente}! 📦 Seu pedido nº {numero} *saiu para entrega* e chega hoje na propriedade {propriedade}. Pedimos que tenha alguém disponível para receber.',
    'entregue',    '{nome_cliente}, seu pedido nº {numero} foi *entregue com sucesso*! ✅ Obrigado por comprar com a Pasto Bom. 🐂'
  )
)
on conflict (chave) do update set
  valor = excluded.valor,
  atualizado_em = now();
