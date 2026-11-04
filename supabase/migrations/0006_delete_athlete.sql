-- Exclusão de atleta pela Diretoria.
-- Atleta com pagamentos NÃO pode ser excluído: apagar o histórico alteraria o saldo do Caixa. Nesse caso, desativar.

create function public.admin_delete_athlete(p_athlete uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.athletes;
begin
  if not public.is_admin() then raise exception 'Apenas a Diretoria'; end if;
  select * into a from public.athletes where id = p_athlete for update;
  if not found then raise exception 'Atleta não encontrado'; end if;
  if exists (select 1 from public.payments where athlete_id = p_athlete) then
    raise exception 'Este atleta tem pagamentos registrados. Para preservar o histórico e o saldo do Caixa, desative o atleta em vez de excluir.';
  end if;

  delete from public.profiles where athlete_id = p_athlete and role = 'atleta';   -- remove o acesso ao portal
  update public.profiles set athlete_id = null where athlete_id = p_athlete;
  delete from public.notifications where athlete_id = p_athlete;
  delete from public.charges where athlete_id = p_athlete;                         -- só mensalidades sem pagamento
  delete from public.athletes where id = p_athlete;

  insert into public.audit_log (user_id, action, entity, entity_id, detail)
  values (auth.uid(), 'DELETE_ATHLETE', 'athletes', p_athlete::text, jsonb_build_object('full_name', a.full_name));
end $$;

revoke execute on function public.admin_delete_athlete(uuid) from public, anon;
grant execute on function public.admin_delete_athlete(uuid) to authenticated;
