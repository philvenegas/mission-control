-- drizzle-kit enables row-level security but has no way to force it. Forced, the policies bind the
-- tables' owner too, so owning a table is never by itself a way past them: the only roles that see
-- every organisation are those created with BYPASSRLS, which bootstrap gives the owner and refuses
-- the API role.
ALTER TABLE "organisations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crew_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "skills" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crew_skills" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "availability_blocks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "missions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mission_requirements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "match_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mission_approvals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mission_events" FORCE ROW LEVEL SECURITY;
