-- Rodapé do card da escalação: texto livre por grupo (ex.: "GEAB - Grêmio Amigos da Bola").
alter table public.organizations
  add column card_footer text check (card_footer is null or length(card_footer) <= 100);
update public.organizations set card_footer = 'GEAB - Grêmio Amigos da Bola' where slug = 'geab';

-- update_organization ganha o rodapé (o parâmetro é opcional: chamadas antigas com 5 argumentos continuam valendo).
drop function public.update_organization(text, text, text, text, text);
create function public.update_organization(p_name text, p_logo_url text, p_primary_color text, p_website text, p_tagline text, p_card_footer text default null)
returns void language plpgsql security definer set search_path = public as $$
declare tn uuid := public.current_tenant(); nm text := trim(coalesce(p_name, ''));
begin
  if not public.is_admin() or tn is null then raise exception 'Apenas a Diretoria'; end if;
  if length(nm) < 1 or length(nm) > 80 then raise exception 'Informe o nome do grupo (até 80 caracteres)'; end if;
  if nullif(trim(coalesce(p_logo_url, '')), '') is not null and trim(p_logo_url) !~ '^https://[^\s]{3,255}$' then
    raise exception 'O logotipo precisa ser um endereço https';
  end if;
  if nullif(trim(coalesce(p_primary_color, '')), '') is not null and trim(p_primary_color) !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Cor inválida (use o formato #0057B8)';
  end if;
  update public.organizations set name = nm,
         logo_url = nullif(trim(coalesce(p_logo_url, '')), ''),
         primary_color = nullif(trim(coalesce(p_primary_color, '')), ''),
         website = nullif(left(trim(coalesce(p_website, '')), 120), ''),
         tagline = nullif(left(trim(coalesce(p_tagline, '')), 80), ''),
         card_footer = nullif(left(trim(coalesce(p_card_footer, '')), 100), '')
   where id = tn;
  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, detail)
    values (tn, auth.uid(), 'UPDATE_ORGANIZATION', 'organizations', tn::text, jsonb_build_object('name', nm));
end $$;
revoke execute on function public.update_organization(text, text, text, text, text, text) from public, anon;
grant execute on function public.update_organization(text, text, text, text, text, text) to authenticated;
