ALTER TABLE "assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "availability_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crew_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crew_skills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "match_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mission_approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mission_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mission_requirements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "missions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organisations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "skills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "assignments" AS PERMISSIVE FOR ALL TO public USING ("assignments"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("assignments"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "availability_blocks" AS PERMISSIVE FOR ALL TO public USING ("availability_blocks"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("availability_blocks"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "crew_members" AS PERMISSIVE FOR ALL TO public USING ("crew_members"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("crew_members"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "crew_skills" AS PERMISSIVE FOR ALL TO public USING ("crew_skills"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("crew_skills"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "match_runs" AS PERMISSIVE FOR ALL TO public USING ("match_runs"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("match_runs"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "mission_approvals" AS PERMISSIVE FOR ALL TO public USING ("mission_approvals"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("mission_approvals"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "mission_events" AS PERMISSIVE FOR ALL TO public USING ("mission_events"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("mission_events"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "mission_requirements" AS PERMISSIVE FOR ALL TO public USING ("mission_requirements"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("mission_requirements"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "missions" AS PERMISSIVE FOR ALL TO public USING ("missions"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("missions"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "organisations" AS PERMISSIVE FOR ALL TO public USING ("organisations"."id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("organisations"."id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "skills" AS PERMISSIVE FOR ALL TO public USING ("skills"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("skills"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "users" AS PERMISSIVE FOR ALL TO public USING ("users"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("users"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);