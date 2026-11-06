-- Conexão com a API do BTG Empresas (um único registro). Guarda os tokens de acesso.
-- Ninguém no navegador lê ou escreve aqui: RLS ligado e SEM políticas; só o servidor, com a chave de serviço.
create table public.btg_connection (
  id smallint primary key default 1 check (id = 1),
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  connected_by uuid,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.btg_connection enable row level security;
revoke all on public.btg_connection from anon, authenticated;
