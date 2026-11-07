CREATE INDEX IF NOT EXISTS votes_topic_user_idx ON public.votes USING btree (vote_topic_id, user_id);
