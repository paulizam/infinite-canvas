ALTER TABLE admin_content_entries
  ADD COLUMN category text NOT NULL DEFAULT 'general',
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN targets text[] NOT NULL DEFAULT '{agent,canvas,drama}';

ALTER TABLE admin_content_entries
  ADD CONSTRAINT admin_content_category_not_blank CHECK (length(btrim(category)) > 0),
  ADD CONSTRAINT admin_content_tags_limit CHECK (cardinality(tags) <= 20),
  ADD CONSTRAINT admin_content_targets_valid CHECK (targets <@ ARRAY['agent','canvas','drama']::text[] AND cardinality(targets) > 0);

CREATE INDEX admin_prompt_catalog_idx
  ON admin_content_entries(category, updated_at DESC, id)
  WHERE kind='prompt' AND status='published';
