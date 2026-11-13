-- Painel do SaaS (entrega 2): detalhe de um cliente e edição pelo dono da plataforma.
-- Só funções novas (nenhuma tabela/coluna alterada). Privacidade mantida: o dono vê contagens e a equipe administrativa
-- (administradores/diretoria), nunca nomes de atletas, pagamentos ou o histórico interno do grupo.
-- Reversão: drop function public.sa_org_detail(uuid), public.sa_update_org(uuid, text, text, text, text, text, text);

create function public.sa_org_detail(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.sa_guard();
  if not exists (select 1 from public.organizations where id = p_org) then raise exception 'Grupo não encontrado'; end if;
  select jsonb_build_object(
    'org', (select jsonb_build_object('id', o.id, 'slug', o.slug, 'name', o.name, 'status', o.status, 'created_at', o.created_at,
              'trial_ends_at', o.trial_ends_at, 'cancelled_at', o.cancelled_at, 'logo_url', o.logo_url, 'primary_color', o.primary_color,
              'website', o.website, 'tagline', o.tagline, 'card_footer', o.card_footer,
              'status_reason', i.status_reason, 'notes', i.notes, 'contact_name', i.contact_name, 'contact_email', i.contact_email, 'contact_phone', i.contact_phone,
              'plan_code', p.code, 'plan_name', p.name, 'plan_price_cents', p.price_cents, 'plan_max_athletes', p.max_athletes)
            from public.organizations o join public.plans p on p.id = o.plan_id left join public.org_internal i on i.org_id = o.id where o.id = p_org),
    'usage', jsonb_build_object(
      'athletes_active', (select count(*) from public.athletes where tenant_id = p_org and active),
      'athletes_total', (select count(*) from public.athletes where tenant_id = p_org),
      'users_total', (select count(*) from public.profiles where tenant_id = p_org),
      'users_active', (select count(*) from public.profiles where tenant_id = p_org and active),
      'matches', (select count(*) from public.matches where tenant_id = p_org),
      'matches_30d', (select count(*) from public.matches where tenant_id = p_org and match_date >= current_date - 30),
      'by_role', coalesce((select jsonb_object_agg(role, n) from (select role::text, count(*) n from public.profiles where tenant_id = p_org and active group by role) x), '{}'::jsonb)),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('name', pr.full_name, 'email', u.email, 'role', pr.role, 'active', pr.active,
                'last_access', (select max(l.last_at) from public.access_log l where l.user_id = pr.id)) order by pr.role, pr.full_name)
              from public.profiles pr join auth.users u on u.id = pr.id where pr.tenant_id = p_org and pr.role in ('admin', 'diretoria')), '[]'::jsonb),
    'billing', coalesce((select jsonb_build_object('paid_until', b.paid_until, 'last_event', b.last_event, 'updated_at', b.updated_at,
                'has_subscription', b.asaas_subscription_id is not null, 'plan_code', b.plan_code)
              from public.org_billing b where b.org_id = p_org), '{}'::jsonb),
    'access', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'users', d.users, 'hits', d.hits) order by d.day desc)
              from (select day, count(*) users, sum(hits) hits from public.access_log where tenant_id = p_org group by day order by day desc limit 30) d), '[]'::jsonb),
    'changes', coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'action', a.action, 'detail', a.detail) order by a.at desc)
              from (select at, action, detail from public.audit_log where tenant_id = p_org and action like 'SA\_%' order by at desc limit 50) a), '[]'::jsonb)
  ) into r;
  return r;
end $$;

-- Edita cadastro e identidade visual do grupo (não mexe em plano/situação: há funções próprias).
create function public.sa_update_org(p_org uuid, p_name text, p_website text, p_tagline text, p_primary_color text, p_logo_url text, p_card_footer text) returns void
language plpgsql security definer set search_path = public as $$
declare nm text := left(trim(coalesce(p_name, '')), 80); col text := nullif(trim(coalesce(p_primary_color, '')), '');
begin
  perform public.sa_guard();
  if length(nm) < 1 then raise exception 'Informe o nome do grupo'; end if;
  if col is not null and col !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Cor inválida (use #RRGGBB)'; end if;
  if nullif(trim(coalesce(p_logo_url, '')), '') is not null and trim(p_logo_url) !~* '^(https://|/)' then raise exception 'Endereço do logo deve começar com https://'; end if;
  update public.organizations set name = nm, website = nullif(left(trim(coalesce(p_website, '')), 120), ''),
    tagline = nullif(left(trim(coalesce(p_tagline, '')), 80), ''), primary_color = col,
    logo_url = nullif(trim(coalesce(p_logo_url, '')), ''), card_footer = nullif(left(trim(coalesce(p_card_footer, '')), 100), '')
  where id = p_org;
  if not found then raise exception 'Grupo não encontrado'; end if;
  perform public.sa_log(p_org, 'SA_UPDATE_ORG', jsonb_build_object('name', nm));
end $$;

revoke execute on function public.sa_org_detail(uuid), public.sa_update_org(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.sa_org_detail(uuid), public.sa_update_org(uuid, text, text, text, text, text, text) to authenticated;
