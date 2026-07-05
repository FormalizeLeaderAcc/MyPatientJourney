-- Add Sub Super User before policies/functions reference the enum value.
-- Kept separate because PostgreSQL enum values should not be used later in
-- the same transactional migration that creates them.

alter type public.app_role add value if not exists 'sub_super_user';
