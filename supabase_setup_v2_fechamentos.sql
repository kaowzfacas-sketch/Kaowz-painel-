-- Rode este script no SQL Editor do Supabase (Project > SQL Editor > New query > Run)
-- Ele é aditivo: não apaga nem altera os dados que já existem em kaowz_plan_entries.

-- Tabela de fechamentos: cada linha é uma "Semana N" fechada, um "Mês" fechado
-- (com título escrito por você) ou um "Ano" fechado (também com título).
create table if not exists kaowz_closures (
  id text primary key,
  tipo text not null check (tipo in ('semana','mes','ano')),
  titulo text not null,
  numero integer,
  data_inicio date not null,
  data_fim date not null,
  parent_id text references kaowz_closures(id),
  created_at timestamptz not null default now()
);

alter table kaowz_closures enable row level security;

create policy "Leitura pública" on kaowz_closures
  for select using (true);
create policy "Inserção pública" on kaowz_closures
  for insert with check (true);
create policy "Atualização pública" on kaowz_closures
  for update using (true);
create policy "Exclusão pública" on kaowz_closures
  for delete using (true);

-- Marca a qual "fechamento de semana" cada lote pertence.
-- NULL = ainda está ao vivo no Planejamento (não foi fechado ainda).
alter table kaowz_plan_entries
  add column if not exists closure_id text references kaowz_closures(id);
