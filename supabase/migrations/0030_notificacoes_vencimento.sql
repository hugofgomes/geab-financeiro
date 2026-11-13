-- Notificações de vencimento: e-mail ao administrador do grupo quando o teste está acabando/acabou ou a assinatura está em atraso.
-- O envio é feito por uma rota do servidor chamada uma vez por dia (agendamento do Coolify); o banco decide QUEM deve receber e
-- garante que cada aviso saia uma única vez (tabela org_notifications). Reversão no fim do arquivo.

create table public.org_notifications (
  id bigserial primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('trial_3d', 'trial_1d', 'trial_fim', 'inadimplencia')),
  ref text not null,                       -- identifica o evento (data do fim do teste, mês da inadimplência): evita repetir o aviso
  to_emails text[] not null default '{}',
  status text not null check (status in ('enviada', 'falhou')),
  error text,
  sent_at timestamptz not null default now(),
  unique (org_id, kind, ref)
);
alter table public.org_notifications enable row level security;   -- sem políticas: só funções
revoke all on public.org_notifications from anon, authenticated;

-- Avisos pendentes (só o servidor, com a chave de serviço).
create function public.billing_notify_candidates()
returns table (org_id uuid, org_name text, kind text, ref text, trial_ends_at timestamptz, emails text[])
language sql stable security definer set search_path = public as $$
  with base as (
    select o.id, o.name, o.trial_ends_at,
      case
        when o.status = 'teste' and o.trial_ends_at > now() and o.trial_ends_at <= now() + interval '1 day' then 'trial_1d'
        when o.status = 'teste' and o.trial_ends_at > now() + interval '1 day' and o.trial_ends_at <= now() + interval '3 days' then 'trial_3d'
        when o.status = 'teste' and o.trial_ends_at <= now() and o.trial_ends_at > now() - interval '14 days' then 'trial_fim'
        when o.status = 'suspensa' and coalesce(i.status_reason, '') like 'inadimplência%' then 'inadimplencia'
      end as kind,
      case when o.status = 'teste' then (o.trial_ends_at at time zone 'America/Sao_Paulo')::date::text
           else to_char(coalesce(i.updated_at, now()) at time zone 'America/Sao_Paulo', 'YYYY-MM') end as ref,
      i.contact_email
    from public.organizations o left join public.org_internal i on i.org_id = o.id
  )
  select b.id, b.name, b.kind, b.ref, b.trial_ends_at,
    (select coalesce(array_agg(distinct lower(e)), '{}') from (
        select u.email as e from public.profiles p join auth.users u on u.id = p.id where p.tenant_id = b.id and p.role = 'admin' and p.active
        union all select b.contact_email) x where e ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  from base b
  where b.kind is not null
    and not exists (select 1 from public.org_notifications n where n.org_id = b.id and n.kind = b.kind and n.ref = b.ref and n.status = 'enviada')
$$;

create function public.billing_notify_mark(p_org uuid, p_kind text, p_ref text, p_emails text[], p_status text, p_error text default null) returns void
language sql security definer set search_path = public as $$
  insert into public.org_notifications (org_id, kind, ref, to_emails, status, error) values (p_org, p_kind, p_ref, coalesce(p_emails, '{}'), p_status, left(p_error, 300))
  on conflict (org_id, kind, ref) do update set to_emails = excluded.to_emails, status = excluded.status, error = excluded.error, sent_at = now()
$$;

-- Histórico de avisos de um cliente (painel do dono).
create function public.sa_org_notifications(p_org uuid)
returns table (kind text, ref text, status text, sent_at timestamptz, to_emails text[], error text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sa_guard();
  return query select n.kind, n.ref, n.status, n.sent_at, n.to_emails, n.error from public.org_notifications n where n.org_id = p_org order by n.sent_at desc limit 30;
end $$;

revoke execute on function public.billing_notify_candidates(), public.billing_notify_mark(uuid, text, text, text[], text, text), public.sa_org_notifications(uuid) from public, anon, authenticated;
grant execute on function public.billing_notify_candidates(), public.billing_notify_mark(uuid, text, text, text[], text, text) to service_role;
grant execute on function public.sa_org_notifications(uuid) to authenticated;

-- Reversão:
--   drop function public.billing_notify_candidates(), public.billing_notify_mark(uuid, text, text, text[], text, text), public.sa_org_notifications(uuid);
--   drop table public.org_notifications;
