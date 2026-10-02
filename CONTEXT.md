# Mission Control

A platform where space organisations plan missions and staff them with crew: a mission lead states what a mission needs, the matcher proposes a crew, a director approves, and crew respond.

## Language

### Tenancy and people

**Organisation**:
A space agency, lab or company using the platform; the owner of every other record.
_Avoid_: Tenant (in user-facing text), company, account, workspace

**User**:
A login belonging to one organisation and holding one role.
_Avoid_: Account, member

**Role**:
What a user may do: director, mission lead or crew member.
_Avoid_: Permission level, user type

**Director**:
A user who runs the organisation and approves missions.
_Avoid_: Admin, manager

**Mission lead**:
A user who plans and staffs missions.
_Avoid_: Planner, lead (alone, in formal text), mission manager

**Crew member**:
A schedulable person with skills, availability and assignment history. A separate thing from a user, linked to one when that person has a login.
_Avoid_: Astronaut, staff, resource, employee

**Skill**:
An entry in one organisation's own taxonomy of capabilities.
_Avoid_: Capability, competency, qualification

**Level**:
A crew member's proficiency in a skill, from 1 (novice) to 5 (expert).
_Avoid_: Rating, grade, proficiency score

**Certification**:
An expiry date on a crew member's skill, after which it no longer counts.
_Avoid_: Licence, qualification

**Availability block**:
A period when a crew member is unavailable. Crew are available outside their blocks.
_Avoid_: Leave, blackout, time off, unavailability

### Missions

**Mission**:
A planned piece of work with a period, a status, an owner and requirements.
_Avoid_: Project, operation, flight

**Period**:
A range of dates, start inclusive and end exclusive.
_Avoid_: Window, timeline, duration, date range

**Owner**:
The mission lead who created a mission.
_Avoid_: Creator, author

**Submitter**:
The user who submitted a mission for approval.
_Avoid_: Requester

**Requirement**:
A skill, a minimum level and a headcount that a mission needs.
_Avoid_: Need, role, position

**Slot**:
One unit of a requirement's headcount; the place one crew member fills.
_Avoid_: Seat, position, opening

**Status**:
Where a mission is in its lifecycle: draft, submitted, approved, active, completed or cancelled.
_Avoid_: State, stage, phase

**Transition**:
A named move between statuses: submit, withdraw, approve, reject, launch, complete or cancel.
_Avoid_: Action, state change

**Guard**:
A condition that must hold for a transition to happen.
_Avoid_: Precondition, validation

**Approval**:
One director's recorded decision on one submission of a mission.
_Avoid_: Sign-off, review

**Event**:
One entry in a mission's permanent history of transitions.
_Avoid_: Log entry, audit record

### Staffing

**Assignment**:
One crew member in one slot of one mission, with a status of proposed, offered, accepted, declined or released.
_Avoid_: Booking, allocation, placement

**Proposed**:
An assignment on a mission that is not yet approved.
_Avoid_: Tentative, pending, draft assignment

**Offered**:
An assignment on an approved mission, awaiting the crew member's response.
_Avoid_: Pending, invited

**Released**:
An assignment withdrawn by the mission lead or by the mission's cancellation.
_Avoid_: Removed, cancelled assignment

**Live**:
An assignment that is proposed, offered or accepted.
_Avoid_: Active assignment, open

**Hold**:
The claim a live assignment has on a crew member for its period.
_Avoid_: Reservation, lock, booking

**Respond**:
A crew member accepting or declining an offered assignment.
_Avoid_: Reply, confirm

### Matching

**Matcher**:
The engine that proposes crew for a mission's open slots.
_Avoid_: Auto-assigner, scheduler, recommender

**Hard constraint**:
A rule that removes a crew member from consideration for a slot, with a recorded reason.
_Avoid_: Filter, rule, requirement

**Candidate**:
A crew member who passes every hard constraint for a slot.
_Avoid_: Option, match, eligible crew

**Score**:
A number from 0 to 1 saying how well a candidate suits a slot, built from weighted components.
_Avoid_: Rank, rating, fit

**Match run**:
A saved matcher result: the proposal and its explanation.
_Avoid_: Suggestion, match result, recommendation

**Apply**:
Turning a match run into assignments.
_Avoid_: Accept (reserved for crew), commit, confirm

**Alternate**:
A next-best candidate listed for a slot.
_Avoid_: Backup, runner-up

**Unfilled slot**:
A slot the matcher found no candidate for.
_Avoid_: Gap, vacancy

**Nearest miss**:
The crew member who came closest to being a candidate for an unfilled slot.
_Avoid_: Near match, closest

**Pin**:
A mission lead fixing a crew member into a match run.
_Avoid_: Lock, force

**Exclude**:
A mission lead keeping a crew member out of a match run.
_Avoid_: Block, ban

**Reference**:
The short per-organisation name by which a record is addressed, such as MSN-12 or CRW-7.
_Avoid_: ID, key, code, slug
