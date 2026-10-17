-- Screenshots are WebP (PNG as a fallback) and well under 10 MB.
update storage.buckets
set file_size_limit = 10485760, allowed_mime_types = '{image/webp,image/png}'
where id = 'screenshots';

-- An item's screenshot must live in its own session's folder, so a reviewer
-- cannot point an item at another session's upload.
alter table public.items add constraint items_screenshot_in_session
  check (screenshot_path is null or screenshot_path like session_id::text || '/%');
