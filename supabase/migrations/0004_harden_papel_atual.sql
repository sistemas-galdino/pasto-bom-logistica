-- 0004_harden_papel_atual.sql
-- Endurece a função SECURITY DEFINER public.papel_atual() apontada pelo
-- advisor de segurança do Supabase (callable via /rest/v1/rpc por anon).
-- Remove o EXECUTE concedido ao PUBLIC (e portanto ao anon) e concede
-- explicitamente apenas a authenticated e service_role — o suficiente para
-- as políticas RLS continuarem funcionando para usuários logados.

revoke execute on function public.papel_atual() from public;
revoke execute on function public.papel_atual() from anon;
grant execute on function public.papel_atual() to authenticated, service_role;

-- Nota: o aviso equivalente para o papel `authenticated` permanece de propósito.
-- A função é SECURITY DEFINER porque é usada nas próprias políticas RLS de
-- `profiles` (evita recursão infinita), e o papel `authenticated` PRECISA de
-- EXECUTE para que as políticas sejam avaliadas em queries de usuários logados.
-- Ela só revela o papel do próprio usuário chamador — exposição aceitável.
