-- Diretoria pode alterar o valor da mensalidade para qualquer valor (inclusive 0 = isenção ou abaixo do já pago).
-- O status é recalculado; pagamentos já feitos são preservados (o caixa não muda).
create or replace function public.admin_update_charge(p_charge uuid, p_amount numeric, p_due date) returns void
language plpgsql security definer set search_path = public as $$
declare paid numeric; c record;
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  select * into c from public.charges where id = p_charge for update;
  if not found then raise exception 'Mensalidade não encontrada'; end if;
  if p_amount is null or p_amount < 0 or p_amount > 9999999 then raise exception 'Informe um valor válido (0 ou mais)'; end if;
  if p_due is null then raise exception 'Informe o vencimento'; end if;
  select coalesce(sum(amount), 0) into paid from public.payments where charge_id = p_charge;
  update public.charges set amount = p_amount, due_date = p_due,
    status = case when paid >= p_amount and (paid > 0 or p_amount = 0) then 'pago'::public.charge_status
                  when paid > 0 then 'parcial'::public.charge_status
                  when c.status = 'em_conferencia' then c.status
                  else 'pendente'::public.charge_status end
    where id = p_charge;
end $$;
