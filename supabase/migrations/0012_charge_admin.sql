-- Diretoria edita (valor e vencimento) ou exclui uma mensalidade. Tudo auditado.

create function public.admin_update_charge(p_charge uuid, p_amount numeric, p_due date) returns void
language plpgsql security definer set search_path = public as $$
declare paid numeric; c record;
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  select * into c from public.charges where id = p_charge for update;
  if not found then raise exception 'Mensalidade não encontrada'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000 then raise exception 'Informe um valor maior que zero'; end if;
  if p_due is null then raise exception 'Informe o vencimento'; end if;
  select coalesce(sum(amount), 0) into paid from public.payments where charge_id = p_charge;
  if p_amount < paid then
    raise exception 'O valor (%) não pode ser menor que o já pago (%)', p_amount, paid;
  end if;
  update public.charges set amount = p_amount, due_date = p_due,
    status = case when paid >= p_amount then 'pago'::public.charge_status
                  when paid > 0 then 'parcial'::public.charge_status
                  when c.status = 'em_conferencia' then c.status
                  else 'pendente'::public.charge_status end
    where id = p_charge;
end $$;

create function public.admin_delete_charge(p_charge uuid, p_with_payments boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare c record; n int; paid numeric;
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  select * into c from public.charges where id = p_charge for update;
  if not found then raise exception 'Mensalidade não encontrada'; end if;
  select count(*), coalesce(sum(amount), 0) into n, paid from public.payments where charge_id = p_charge;
  if n > 0 and not p_with_payments then
    raise exception 'A mensalidade tem % pagamento(s) (total %). Confirme a exclusão dos pagamentos para continuar.', n, paid;
  end if;
  delete from public.notifications where charge_id = p_charge;
  delete from public.payments where charge_id = p_charge;
  delete from public.charges where id = p_charge;
  insert into public.audit_log (user_id, action, entity, entity_id, detail)
    values (auth.uid(), 'DELETE_CHARGE', 'charges', p_charge::text,
            jsonb_build_object('athlete_id', c.athlete_id, 'competence', c.competence, 'amount', c.amount, 'payments_deleted', n, 'payments_total', paid));
end $$;

revoke execute on function public.admin_update_charge(uuid, numeric, date), public.admin_delete_charge(uuid, boolean) from public, anon;
grant execute on function public.admin_update_charge(uuid, numeric, date), public.admin_delete_charge(uuid, boolean) to authenticated;
