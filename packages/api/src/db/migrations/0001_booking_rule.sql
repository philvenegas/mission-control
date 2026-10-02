-- The booking rule: a crew member's live assignments never overlap in period.
-- A proposed assignment on a draft is a plan, not a hold, so the constraint ignores it.
-- Needs the btree_gist extension, which is trusted, so the database owner may create it.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "no_double_booking"
  EXCLUDE USING gist ("crew_member_id" WITH =, "period" WITH &&)
  WHERE ("status" IN ('held', 'offered', 'accepted'));
