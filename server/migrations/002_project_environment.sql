alter table projects add column copy_files jsonb not null default '[]'::jsonb;
alter table projects add column reference_dirs jsonb not null default '[]'::jsonb;
