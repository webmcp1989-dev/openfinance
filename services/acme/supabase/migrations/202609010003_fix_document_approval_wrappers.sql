begin;

-- These are the only authenticated approval entry points. Security-definer
-- execution lets them invoke the non-executable private implementations; those
-- implementations still derive auth.uid(), supplier membership, role,
-- ownership, expiry, and approval state independently.
alter function public.request_document_submission_approval(text, text, text, jsonb, text)
  security definer;
alter function public.decide_document_submission_approval(uuid, text)
  security definer;

commit;
