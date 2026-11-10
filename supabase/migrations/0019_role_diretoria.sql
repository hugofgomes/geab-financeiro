-- Novo nível de acesso "diretoria" (consulta). Fica sozinho neste arquivo: o Postgres só deixa USAR um valor novo de enum depois
-- que ele é confirmado (commit); as regras que o utilizam estão em 0020.
alter type public.app_role add value if not exists 'diretoria';
