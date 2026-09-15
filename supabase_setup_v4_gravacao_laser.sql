-- Rode no SQL Editor do Supabase. Libera a nova categoria "gravacao_laser"
-- na coluna category de kaowz_plan_entries.
alter table kaowz_plan_entries drop constraint if exists kaowz_plan_entries_category_check;
alter table kaowz_plan_entries add constraint kaowz_plan_entries_category_check
  check (category in ('encomendadas','producao','gravacao_laser','expedicoes','pos_venda','envios','caixas','espumas'));
