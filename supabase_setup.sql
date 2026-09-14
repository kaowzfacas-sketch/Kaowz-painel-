-- Rode este script inteiro no Supabase: Project > SQL Editor > New query > Run

-- Tabela única que guarda os lotes de todas as categorias do painel
-- (Facas Encomendadas, Facas em Produção, Expedições, Envios, Caixas, Espumas)
create table if not exists kaowz_plan_entries (
  id text primary key,
  category text not null check (category in ('encomendadas','producao','expedicoes','envios','caixas','espumas')),
  data_registro date not null,
  lote text not null,
  planejado integer not null default 0,
  realizado integer not null default 0,
  entrega date,
  obs text,
  created_at timestamptz not null default now()
);

-- Row Level Security é obrigatório no Supabase para liberar acesso via chave "anon"
alter table kaowz_plan_entries enable row level security;

-- Sem login: qualquer pessoa com a chave "anon" (a mesma usada no app.js)
-- pode ler e escrever nesta tabela. É o mesmo nível de exposição que o
-- armazenamento "compartilhado" que o painel já usava antes.
create policy "Leitura pública" on kaowz_plan_entries
  for select using (true);

create policy "Inserção pública" on kaowz_plan_entries
  for insert with check (true);

create policy "Atualização pública" on kaowz_plan_entries
  for update using (true);

create policy "Exclusão pública" on kaowz_plan_entries
  for delete using (true);
