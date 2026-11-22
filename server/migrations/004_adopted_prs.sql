alter table initiatives add column kind text not null default 'feature';
create unique index initiatives_one_open_prs_per_project on initiatives (project_id) where kind = 'open-prs';

alter table tickets add column pr_head_ref text;
