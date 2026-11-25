-- What each ticket needs from the others, as the planner wrote it. depends_on keeps the one
-- ticket it stacks on (its branch and PR sit on that ticket's), derived from needs.
alter table tickets add column if not exists needs jsonb;
update tickets set needs = depends_on where needs is null;
alter table tickets alter column needs set default '[]'::jsonb;
alter table tickets alter column needs set not null;
