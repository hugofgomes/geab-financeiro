-- Cobranças Pix (via OpenPix): uma por tentativa de cobrar uma mensalidade. O webhook de pagamento
-- chama register_pix_payment (só o servidor, com a chave de serviço) para baixar a mensalidade.

create table public.pix_charges (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.charges(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id),
  correlation_id text not null unique,
  value_cents integer not null check (value_cents > 0),
  status text not null default 'ativa' check (status in ('ativa', 'paga', 'divergente', 'conferir')),
  br_code text,                 -- Pix copia e cola
  payment_link text,
  qr_image text,                -- URL da imagem do QR Code
  expires_at timestamptz,
  e2e_id text,                  -- identificador do Pix pago (endToEndId)
  paid_at timestamptz,
  note text,
  review boolean not null default false,   -- precisa de conferência manual da Diretoria
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index pix_charges_charge_idx on public.pix_charges (charge_id, created_at desc);

alter table public.pix_charges enable row level security;
create policy pix_charges_admin on public.pix_charges for all using (public.is_admin()) with check (public.is_admin());
create policy pix_charges_self on public.pix_charges for select using (athlete_id = public.my_athlete());

-- Baixa idempotente de um Pix confirmado. Nunca registra valor diferente do cobrado nem Pix repetido.
create function public.register_pix_payment(p_correlation text, p_value_cents int, p_e2e text, p_paid_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare pc record; dia date;
begin
  if coalesce(p_e2e, '') = '' then return jsonb_build_object('result', 'invalid'); end if;
  select * into pc from public.pix_charges where correlation_id = p_correlation for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if exists (select 1 from public.payments where bank_txid = p_e2e) then
    return jsonb_build_object('result', 'duplicate', 'charge_id', pc.charge_id, 'athlete_id', pc.athlete_id);
  end if;
  if p_value_cents is distinct from pc.value_cents then
    update public.pix_charges set status = 'divergente', review = true, e2e_id = p_e2e, paid_at = p_paid_at,
      note = format('Valor recebido (%s centavos) difere do cobrado (%s). Confira e registre manualmente.', p_value_cents, pc.value_cents)
      where id = pc.id;
    return jsonb_build_object('result', 'divergent', 'charge_id', pc.charge_id, 'athlete_id', pc.athlete_id);
  end if;
  dia := (p_paid_at at time zone 'America/Sao_Paulo')::date;
  begin
    insert into public.payments (athlete_id, charge_id, amount, paid_at, method, source, bank_txid, notes)
    values (pc.athlete_id, pc.charge_id, p_value_cents / 100.0, dia, 'pix', 'pix_webhook', p_e2e, 'Pix recebido via OpenPix');
  exception
    when unique_violation then
      return jsonb_build_object('result', 'duplicate', 'charge_id', pc.charge_id, 'athlete_id', pc.athlete_id);
    when raise_exception then
      -- não sobrescreve uma cobrança já paga: só sinaliza o pagamento extra para conferência
      update public.pix_charges set
        status = case when status = 'paga' then status else 'conferir' end,
        e2e_id = case when status = 'paga' then e2e_id else p_e2e end,
        paid_at = case when status = 'paga' then paid_at else p_paid_at end,
        review = true,
        note = left('Pagamento adicional recebido (' || p_e2e || '): ' || sqlerrm, 300)
        where id = pc.id;
      return jsonb_build_object('result', 'conflict', 'charge_id', pc.charge_id, 'athlete_id', pc.athlete_id);
  end;
  update public.pix_charges set status = 'paga', e2e_id = p_e2e, paid_at = p_paid_at where id = pc.id;
  return jsonb_build_object('result', 'ok', 'charge_id', pc.charge_id, 'athlete_id', pc.athlete_id);
end $$;

revoke execute on function public.register_pix_payment(text, int, text, timestamptz) from public, anon, authenticated;
grant execute on function public.register_pix_payment(text, int, text, timestamptz) to service_role;
