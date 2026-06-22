-- 0007_cliente_whatsapp.sql
-- Número de WhatsApp canônico do cliente, calculado na ingestão a partir dos
-- campos crus (celular/telefone) do Órix pelo normalizador de @pastobom/shared.
--
-- numero_whatsapp: dígitos "55DDD9XXXXXXXX" (formato exigido pela Evolution),
--                  NULL quando o cliente não tem um número MÓVEL alcançável.
-- whatsapp_tipo:   classificação do contato (movel | fixo | invalido | vazio),
--                  para auditoria de cobertura sem reprocessar o número.

alter table clientes
  add column if not exists numero_whatsapp text,
  add column if not exists whatsapp_tipo   text;

comment on column clientes.numero_whatsapp is
  'Número canônico p/ Evolution (dígitos 55DDD9XXXXXXXX). NULL se não houver móvel alcançável.';
comment on column clientes.whatsapp_tipo is
  'Classificação do contato: movel | fixo | invalido | vazio.';

-- Apoia a auditoria "quem tem WhatsApp" e a leitura no envio.
create index if not exists idx_clientes_numero_whatsapp
  on clientes (numero_whatsapp)
  where numero_whatsapp is not null;
