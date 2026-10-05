-- 077: Comments that carry an action (#83CC7930)
--
-- "Assign with a comment", "close with a comment", "block with a comment": the
-- comment is posted first and the change follows from the client, so the
-- activity log reads "wrote a comment · closed the task". The action is kept on
-- the comment as a small JSON so the timeline can show a badge next to it:
--   {"kind":"assign","user_id":"…","user_name":"…"}
--   {"kind":"close","status":"Tamamlandı"}
--   {"kind":"block","status":"Bloke"}
-- Nothing on the server acts on it; RLS on ticket_comments is unchanged.

ALTER TABLE public.ticket_comments ADD COLUMN IF NOT EXISTS action jsonb;

ALTER TABLE public.ticket_comments DROP CONSTRAINT IF EXISTS ticket_comments_action_check;
ALTER TABLE public.ticket_comments ADD CONSTRAINT ticket_comments_action_check
  CHECK (action IS NULL OR action ->> 'kind' IN ('assign', 'close', 'block'));

NOTIFY pgrst, 'reload schema';
