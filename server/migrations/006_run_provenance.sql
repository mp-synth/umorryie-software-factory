alter table runs add column if not exists role_sha text;
alter table runs add column if not exists claude_version text;
alter table runs add column if not exists factory_sha text;
alter table runs add column if not exists base_sha text;
alter table runs add column if not exists head_sha text;
