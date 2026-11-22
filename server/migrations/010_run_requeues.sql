alter table runs add column if not exists crash_requeues int not null default 0;
