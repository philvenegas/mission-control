CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"ref" integer NOT NULL,
	"mission_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"crew_member_id" uuid NOT NULL,
	"period" daterange NOT NULL,
	"status" text NOT NULL,
	"score" double precision,
	"match_run_id" uuid,
	"created_by" uuid NOT NULL,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_org_id_id" UNIQUE("org_id","id"),
	CONSTRAINT "assignments_org_id_ref" UNIQUE("org_id","ref"),
	CONSTRAINT "assignments_status" CHECK ("assignments"."status" IN ('proposed', 'held', 'offered', 'accepted', 'declined', 'released'))
);
--> statement-breakpoint
CREATE TABLE "availability_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"ref" integer NOT NULL,
	"crew_member_id" uuid NOT NULL,
	"period" daterange NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_blocks_org_id_id" UNIQUE("org_id","id"),
	CONSTRAINT "availability_blocks_org_id_ref" UNIQUE("org_id","ref"),
	CONSTRAINT "availability_blocks_period" CHECK (NOT isempty("availability_blocks"."period"))
);
--> statement-breakpoint
CREATE TABLE "crew_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"ref" integer NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crew_members_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "crew_members_org_id_id" UNIQUE("org_id","id"),
	CONSTRAINT "crew_members_org_id_ref" UNIQUE("org_id","ref"),
	CONSTRAINT "crew_members_status" CHECK ("crew_members"."status" IN ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "crew_skills" (
	"org_id" uuid NOT NULL,
	"crew_member_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"certified_until" date,
	CONSTRAINT "crew_skills_pk" PRIMARY KEY("crew_member_id","skill_id"),
	CONSTRAINT "crew_skills_level" CHECK ("crew_skills"."level" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "match_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"ref" integer NOT NULL,
	"mission_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"result" jsonb NOT NULL,
	"weights" jsonb NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_runs_org_id_id" UNIQUE("org_id","id"),
	CONSTRAINT "match_runs_org_id_ref" UNIQUE("org_id","ref")
);
--> statement-breakpoint
CREATE TABLE "mission_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"mission_id" uuid NOT NULL,
	"submission_no" integer NOT NULL,
	"approver_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mission_approvals_org_id_id" UNIQUE("org_id","id"),
	CONSTRAINT "mission_approvals_once_per_submission" UNIQUE("mission_id","submission_no","approver_id"),
	CONSTRAINT "mission_approvals_decision" CHECK ("mission_approvals"."decision" IN ('approve', 'reject'))
);
--> statement-breakpoint
CREATE TABLE "mission_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"mission_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mission_events_org_id_id" UNIQUE("org_id","id"),
	CONSTRAINT "mission_events_type" CHECK ("mission_events"."type" IN ('submit', 'withdraw', 'approve', 'reject', 'launch', 'complete', 'cancel', 'clash'))
);
--> statement-breakpoint
CREATE TABLE "mission_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"mission_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"min_level" integer NOT NULL,
	"headcount" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "mission_requirements_org_id_id" UNIQUE("org_id","id"),
	CONSTRAINT "mission_requirements_org_id_mission_id_id" UNIQUE("org_id","mission_id","id"),
	CONSTRAINT "mission_requirements_mission_skill" UNIQUE("mission_id","skill_id"),
	CONSTRAINT "mission_requirements_min_level" CHECK ("mission_requirements"."min_level" BETWEEN 1 AND 5),
	CONSTRAINT "mission_requirements_headcount" CHECK ("mission_requirements"."headcount" >= 1)
);
--> statement-breakpoint
CREATE TABLE "missions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"ref" integer NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"period" daterange NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"owner_id" uuid NOT NULL,
	"submitted_by" uuid,
	"submission_no" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "missions_org_id_id" UNIQUE("org_id","id"),
	CONSTRAINT "missions_org_id_ref" UNIQUE("org_id","ref"),
	CONSTRAINT "missions_org_id_id_period" UNIQUE("org_id","id","period"),
	CONSTRAINT "missions_status" CHECK ("missions"."status" IN ('draft', 'submitted', 'approved', 'active', 'completed', 'cancelled')),
	CONSTRAINT "missions_period" CHECK (NOT isempty("missions"."period"))
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"settings" jsonb DEFAULT '{"approvals_required":1,"allow_unfilled_submission":false,"min_rest_days":0,"match_weights":{"proficiency":0.45,"workload":0.35,"rest":0.2}}'::jsonb NOT NULL,
	"last_mission_ref" integer DEFAULT 0 NOT NULL,
	"last_crew_member_ref" integer DEFAULT 0 NOT NULL,
	"last_assignment_ref" integer DEFAULT 0 NOT NULL,
	"last_match_run_ref" integer DEFAULT 0 NOT NULL,
	"last_availability_block_ref" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	CONSTRAINT "skills_org_id_id" UNIQUE("org_id","id"),
	CONSTRAINT "skills_org_id_name" UNIQUE("org_id","name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_org_id_id" UNIQUE("org_id","id"),
	CONSTRAINT "users_org_id_email" UNIQUE("org_id","email"),
	CONSTRAINT "users_role" CHECK ("users"."role" IN ('director', 'mission_lead', 'crew_member'))
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_mission_fk" FOREIGN KEY ("org_id","mission_id","period") REFERENCES "public"."missions"("org_id","id","period") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_requirement_fk" FOREIGN KEY ("org_id","mission_id","requirement_id") REFERENCES "public"."mission_requirements"("org_id","mission_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_crew_member_fk" FOREIGN KEY ("org_id","crew_member_id") REFERENCES "public"."crew_members"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_match_run_fk" FOREIGN KEY ("org_id","match_run_id") REFERENCES "public"."match_runs"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_created_by_fk" FOREIGN KEY ("org_id","created_by") REFERENCES "public"."users"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_crew_member_fk" FOREIGN KEY ("org_id","crew_member_id") REFERENCES "public"."crew_members"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_user_fk" FOREIGN KEY ("org_id","user_id") REFERENCES "public"."users"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_skills" ADD CONSTRAINT "crew_skills_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_skills" ADD CONSTRAINT "crew_skills_crew_member_fk" FOREIGN KEY ("org_id","crew_member_id") REFERENCES "public"."crew_members"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_skills" ADD CONSTRAINT "crew_skills_skill_fk" FOREIGN KEY ("org_id","skill_id") REFERENCES "public"."skills"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_runs" ADD CONSTRAINT "match_runs_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_runs" ADD CONSTRAINT "match_runs_mission_fk" FOREIGN KEY ("org_id","mission_id") REFERENCES "public"."missions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_runs" ADD CONSTRAINT "match_runs_created_by_fk" FOREIGN KEY ("org_id","created_by") REFERENCES "public"."users"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_approvals" ADD CONSTRAINT "mission_approvals_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_approvals" ADD CONSTRAINT "mission_approvals_mission_fk" FOREIGN KEY ("org_id","mission_id") REFERENCES "public"."missions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_approvals" ADD CONSTRAINT "mission_approvals_approver_fk" FOREIGN KEY ("org_id","approver_id") REFERENCES "public"."users"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_events" ADD CONSTRAINT "mission_events_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_events" ADD CONSTRAINT "mission_events_mission_fk" FOREIGN KEY ("org_id","mission_id") REFERENCES "public"."missions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_events" ADD CONSTRAINT "mission_events_actor_fk" FOREIGN KEY ("org_id","actor_id") REFERENCES "public"."users"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_requirements" ADD CONSTRAINT "mission_requirements_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_requirements" ADD CONSTRAINT "mission_requirements_mission_fk" FOREIGN KEY ("org_id","mission_id") REFERENCES "public"."missions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_requirements" ADD CONSTRAINT "mission_requirements_skill_fk" FOREIGN KEY ("org_id","skill_id") REFERENCES "public"."skills"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_owner_fk" FOREIGN KEY ("org_id","owner_id") REFERENCES "public"."users"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_submitted_by_fk" FOREIGN KEY ("org_id","submitted_by") REFERENCES "public"."users"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;