-- Responses from models without a known price: the session's transcript price leaves them
-- out, so the backfill reads such sessions again once their model has a price.
alter table agent_usage add column unpriced_requests integer not null default 0;

-- How far the transcript backfill has read: set only once a whole pass finished, so a
-- restart halfway through the first pass, or a session recorded live, cannot make it skip
-- transcripts it never read.
create table usage_backfill (
  id            int primary key default 1 check (id = 1),
  scanned_up_to timestamptz not null
);
