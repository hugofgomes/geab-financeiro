-- Configurações simples do sistema (ex.: Pix copia e cola de recebimento). A Diretoria edita; todos os usuários ativos leem.
create table public.app_settings (
  key text primary key check (key ~ '^[a-z_]{1,40}$'),
  value text not null check (length(value) <= 1000),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.app_settings enable row level security;
create policy app_settings_admin on public.app_settings for all using (public.is_admin()) with check (public.is_admin());
create policy app_settings_member on public.app_settings for select using (public.is_member());
