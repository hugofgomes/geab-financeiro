-- Comunicados com imagem: o dono anexa uma imagem (hospedada no Supabase Storage, bucket público "comunicados") que aparece no e-mail e no aviso do painel.
-- Só o dono da plataforma grava no bucket; a imagem é pública por endereço (necessário para aparecer nos e-mails).
-- Reversão no fim do arquivo.

alter table public.broadcasts add column image_url text
  check (image_url is null or image_url ~ '^https://[^/\s]+/storage/v1/object/public/comunicados/[A-Za-z0-9._-]+$');

-- Bucket e permissões (só existe no Supabase; o ambiente de testes não tem o schema storage).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('comunicados', 'comunicados', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
    on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];
    execute 'drop policy if exists comunicados_dono_grava on storage.objects';
    execute $p$create policy comunicados_dono_grava on storage.objects for all to authenticated
      using (bucket_id = 'comunicados' and public.is_platform_admin()) with check (bucket_id = 'comunicados' and public.is_platform_admin())$p$;
  end if;
end $$;

-- Envio com imagem (substitui a versão da 0033).
drop function public.sa_broadcast_send(text, text, boolean, boolean, text[], text[], int);
create function public.sa_broadcast_send(p_subject text, p_body text, p_email boolean, p_in_app boolean, p_statuses text[], p_plans text[], p_in_app_days int default 14, p_image_url text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare bid uuid; o int := 0; e int := 0; r record; m text; seen text[] := '{}';
begin
  perform public.sa_guard();
  if not coalesce(p_email, false) and not coalesce(p_in_app, false) then raise exception 'Escolha pelo menos um canal: e-mail ou aviso no painel'; end if;
  if coalesce(cardinality(p_statuses), 0) = 0 then raise exception 'Escolha para quais situações enviar'; end if;
  if exists (select 1 from unnest(p_statuses) s where s not in ('teste', 'ativa', 'suspensa', 'cancelada')) then raise exception 'Situação inválida'; end if;
  if nullif(trim(coalesce(p_image_url, '')), '') is not null and trim(p_image_url) !~ '^https://[^/\s]+/storage/v1/object/public/comunicados/[A-Za-z0-9._-]+$' then raise exception 'Imagem inválida: envie pela própria tela'; end if;
  if p_in_app_days is null or p_in_app_days < 1 or p_in_app_days > 90 then raise exception 'O aviso no painel dura de 1 a 90 dias'; end if;
  insert into public.broadcasts (created_by, subject, body, image_url, send_email, show_in_app, in_app_until, audience, status)
  values (auth.uid(), trim(p_subject), trim(p_body), nullif(trim(coalesce(p_image_url, '')), ''), coalesce(p_email, false), coalesce(p_in_app, false),
          case when p_in_app then now() + make_interval(days => p_in_app_days) end,
          jsonb_build_object('statuses', p_statuses, 'plans', coalesce(p_plans, '{}')), case when p_email then 'enviando' else 'enviada' end)
  returning id into bid;
  for r in select id from public.broadcast_audience_orgs(p_statuses, p_plans) id loop
    o := o + 1;
    insert into public.broadcast_orgs (broadcast_id, org_id) values (bid, r.id);
    if p_email then
      foreach m in array public.broadcast_org_emails(r.id) loop
        if not (m = any (seen)) then
          seen := seen || m;
          insert into public.broadcast_recipients (broadcast_id, org_id, email) values (bid, r.id, m);
          e := e + 1;
        end if;
      end loop;
    end if;
  end loop;
  if o = 0 then raise exception 'Nenhum cliente corresponde ao público escolhido'; end if;
  update public.broadcasts set orgs_count = o, emails_count = e, finished_at = case when p_email then null else now() end where id = bid;
  return bid;
end $$;

-- Aviso no painel e conteúdo do envio passam a trazer a imagem.
drop function public.my_announcements();
create function public.my_announcements() returns table (id uuid, subject text, body text, created_at timestamptz, image_url text)
language sql stable security definer set search_path = public as $$
  select b.id, b.subject, b.body, b.created_at, b.image_url
  from public.broadcasts b
  join public.broadcast_orgs bo on bo.broadcast_id = b.id and bo.org_id = public.current_tenant()
  where b.show_in_app and b.in_app_until > now()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role in ('admin', 'diretoria'))
    and not exists (select 1 from public.broadcast_dismissals d where d.broadcast_id = b.id and d.user_id = auth.uid())
  order by b.created_at desc limit 3
$$;
drop function public.broadcast_content(uuid);
create function public.broadcast_content(p_id uuid) returns table (subject text, body text, send_email boolean, image_url text)
language sql stable security definer set search_path = public as $$ select subject, body, send_email, image_url from public.broadcasts where id = p_id $$;

revoke execute on function public.sa_broadcast_send(text, text, boolean, boolean, text[], text[], int, text), public.my_announcements(), public.broadcast_content(uuid) from public, anon, authenticated;
grant execute on function public.sa_broadcast_send(text, text, boolean, boolean, text[], text[], int, text), public.my_announcements() to authenticated;
grant execute on function public.broadcast_content(uuid) to service_role;

-- Reversão:
--   (recriar sa_broadcast_send, my_announcements e broadcast_content com as definições da 0033)
--   alter table public.broadcasts drop column image_url;
--   delete from storage.objects where bucket_id = 'comunicados'; delete from storage.buckets where id = 'comunicados';
