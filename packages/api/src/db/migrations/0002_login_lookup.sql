-- Login is the only lookup that crosses organisations: it happens before any tenant is known.
-- It goes through this one narrow function, which runs with its owner's rights, so it keeps
-- working unchanged once row-level security hides every organisation's users from the API role.
CREATE FUNCTION auth_find_user(p_org_slug text, p_email text)
  RETURNS TABLE (user_id uuid, org_id uuid, role text, password_hash text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT u.id, u.org_id, u.role, u.password_hash
    FROM users u JOIN organisations o ON o.id = u.org_id
    WHERE o.slug = p_org_slug AND u.email = p_email
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_find_user(text, text) FROM PUBLIC;
