-- Promote the two platform super-admins.
-- These accounts exist in production with role = 'admin' but need
-- role = 'super_admin' to access platform-admin routes and assume-role.
-- Safe to re-run: UPDATE only affects matching emails and is idempotent.

UPDATE team_members
SET role = 'super_admin'
WHERE email IN (
  'omnianalyticsconsulting@gmail.com',
  'chandanrathore8@gmail.com'
)
AND role != 'super_admin';
