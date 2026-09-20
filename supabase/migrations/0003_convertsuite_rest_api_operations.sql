-- ConvertSuite REST calls reserve one operation per successful prepare request.
-- The processing service calls this overload with p_operation_units=1 for the
-- KmerHosting gateway path and uses the existing function for web jobs.

create or replace function public.convertsuite_create_job(
  p_job_id uuid,
  p_user_id uuid,
  p_scope_key_hash text,
  p_idempotency_key text,
  p_tool text,
  p_options jsonb,
  p_files jsonb,
  p_operation_units integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job public.convertsuite_jobs%rowtype;
  v_file jsonb;
  v_quota jsonb;
  v_input_count integer := jsonb_array_length(coalesce(p_files, '[]'::jsonb));
  v_operation_units integer := coalesce(p_operation_units, v_input_count);
  v_index integer;
begin
  if p_job_id is null
     or char_length(trim(coalesce(p_scope_key_hash, ''))) < 32
     or char_length(trim(coalesce(p_idempotency_key, ''))) < 16
     or p_tool not in (
       'document-to-pdf', 'html-to-pdf', 'document-merge', 'pdf-to-docx', 'pdf-to-pptx', 'pdf-to-xlsx', 'pdf-to-rtf',
       'image-to-pdf', 'pdf-to-jpg', 'pdf-to-png', 'ocr-pdf', 'compress-pdf', 'linearize-pdf',
       'merge-pdf', 'split-pdf', 'pdf-properties', 'pdf-extract', 'rotate-pdf', 'delete-pdf-pages',
       'reorder-pdf-pages', 'insert-pdf-pages', 'replace-pdf-pages', 'protect-pdf',
       'remove-pdf-protection', 'watermark-pdf', 'accessibility-check', 'autotag-pdf',
       'image-convert', 'image-resize', 'image-compress', 'document-to-text', 'media-probe',
       'media-audio-extract', 'media-trim', 'resume-generate', 'cover-letter-generate'
     )
     or v_input_count < 1
     or v_input_count > 10
     or v_operation_units < 1
     or v_operation_units > 10 then
    raise exception 'invalid_convertsuite_job_request';
  end if;

  select * into v_job
  from public.convertsuite_jobs
  where scope_key_hash = trim(p_scope_key_hash)
    and idempotency_key = trim(p_idempotency_key)
  for update;

  if found then
    if v_job.tool <> p_tool or v_job.input_count <> v_input_count then
      raise exception 'idempotency_key_reused';
    end if;
    return public.convertsuite_job_payload(v_job);
  end if;

  insert into public.convertsuite_jobs(id, user_id, scope_key_hash, idempotency_key, tool, options, input_count)
  values (p_job_id, p_user_id, trim(p_scope_key_hash), trim(p_idempotency_key), p_tool, coalesce(p_options, '{}'::jsonb), v_input_count)
  returning * into v_job;

  for v_file in select value from jsonb_array_elements(p_files) loop
    if char_length(trim(coalesce(v_file->>'storagePath', ''))) < 40
       or char_length(trim(coalesce(v_file->>'originalName', ''))) < 1
       or char_length(trim(coalesce(v_file->>'mimeType', ''))) < 1
       or (v_file->>'sizeBytes')::bigint not between 1 and 52428800 then
      raise exception 'invalid_convertsuite_file_request';
    end if;

    insert into public.convertsuite_job_files(job_id, storage_path, original_name, mime_type, size_bytes, checksum)
    values (v_job.id, trim(v_file->>'storagePath'), left(trim(v_file->>'originalName'), 255), left(trim(v_file->>'mimeType'), 160), (v_file->>'sizeBytes')::bigint, nullif(left(trim(v_file->>'checksum'), 128), ''));
  end loop;

  for v_index in 1..v_operation_units loop
    v_quota := public.convertsuite_reserve_operation(p_user_id, trim(p_scope_key_hash));
    if coalesce((v_quota->>'allowed')::boolean, false) is not true then
      raise exception 'convertsuite_quota_exceeded';
    end if;
  end loop;

  return public.convertsuite_job_payload(v_job);
exception
  when unique_violation then
    select * into v_job from public.convertsuite_jobs where scope_key_hash = trim(p_scope_key_hash) and idempotency_key = trim(p_idempotency_key);
    if found then return public.convertsuite_job_payload(v_job); end if;
    raise;
end;
$function$;

revoke all on function public.convertsuite_create_job(uuid, uuid, text, text, text, jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.convertsuite_create_job(uuid, uuid, text, text, text, jsonb, jsonb, integer) to service_role;
