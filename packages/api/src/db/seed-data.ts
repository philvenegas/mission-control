import {
  DEFAULT_MATCH_WEIGHTS,
  DEFAULT_ORG_SETTINGS,
  type MissionStatus,
  type OrgSettings,
  type Role,
} from '@mission-control/contract';

// The demo data, as DESIGN.md section 10 specifies it. People are named by first name, which is
// unique within an organisation here.

/** Every seeded date is a number of days from this one. Move it forward once the 2027 dates pass. */
export const SEED_BASE_DATE = '2026-10-01';

interface CrewSeed {
  name: string;
  /** Has a user, and so can log in. */
  login?: boolean;
  skills: Record<string, number | { level: number; certifiedUntilDay: number }>;
  blocks?: { fromDay: number; toDay: number; reason: string }[];
}

export interface MissionSeed {
  name: string;
  description: string;
  /** The period, in days from SEED_BASE_DATE; the end is exclusive. */
  fromDay: number;
  toDay: number;
  status: Exclude<MissionStatus, 'cancelled'>;
  owner: string;
  /** Directors who have approved the current submission. */
  approvedBy?: string[];
  requirements: { skill: string; minLevel: number; headcount?: number; crew?: string[] }[];
}

export interface OrgSeed {
  name: string;
  slug: string;
  settings: OrgSettings;
  skills: Record<string, string>;
  users: { name: string; role: Exclude<Role, 'crew_member'> }[];
  crew: CrewSeed[];
  missions: MissionSeed[];
}

const artemis: OrgSeed = {
  name: 'Artemis',
  slug: 'artemis',
  settings: DEFAULT_ORG_SETTINGS,
  skills: {
    pilot: 'flight',
    navigator: 'flight',
    medic: 'medical',
    engineer: 'engineering',
    geologist: 'science',
    comms: 'operations',
  },
  users: [
    { name: 'Dana Okoye', role: 'director' },
    { name: 'Marcus Hale', role: 'director' },
    { name: 'Sam Okafor', role: 'mission_lead' },
    { name: 'Priya Nair', role: 'mission_lead' },
  ],
  crew: [
    { name: 'Ada Reyes', login: true, skills: { pilot: 5, medic: 4 } },
    { name: 'Ben Osei', skills: { pilot: 4 } },
    { name: 'Mina Farouk', login: true, skills: { medic: 4, engineer: 3 } },
    // Her medic certification expires on 10 Mar 2027.
    { name: 'Noor Haddad', skills: { engineer: 5, medic: { level: 3, certifiedUntilDay: 160 } } },
    {
      name: 'Omar Vance',
      skills: { medic: 5 },
      blocks: [
        { fromDay: 155, toDay: 162, reason: 'Training course' }, // 5–12 Mar 2027
        { fromDay: 243, toDay: 272, reason: 'Parental leave' }, // 1–30 Jun 2027
      ],
    },
    { name: 'Kira Novak', skills: { engineer: 5, medic: 3 } },
    { name: 'Quin Abara', login: true, skills: { medic: 3 } },
    { name: 'Leo Adeyemi', skills: { engineer: 4, navigator: 3 } },
    { name: 'Cy Lindqvist', skills: { pilot: 3, comms: 3 } },
    { name: 'Rosa Imani', skills: { geologist: 4, comms: 2 } },
    { name: 'Sven Dahl', skills: { geologist: 3, navigator: 4 } },
    {
      name: 'Tala Moreno',
      skills: { geologist: 5 },
      blocks: [{ fromDay: 182, toDay: 195, reason: 'Leave' }], // 1–14 Apr 2027
    },
  ],
  missions: [
    {
      name: 'Lunar Gateway Resupply',
      description: 'Cargo and crew rotation for the gateway station.',
      fromDay: 14, // 15 Oct 2026
      toDay: 132, // 10 Feb 2027
      status: 'active',
      owner: 'Sam',
      approvedBy: ['Dana'],
      requirements: [
        // Ben flies it alongside Cy. Without that, the Europa Survey walk-through has two equally
        // good crews (Ada and Quin, or Ben and Ada) and the matcher's choice would rest on a tie.
        { skill: 'pilot', minLevel: 3, headcount: 2, crew: ['Ben', 'Cy'] },
        { skill: 'engineer', minLevel: 4, headcount: 2, crew: ['Kira', 'Leo'] },
        { skill: 'medic', minLevel: 4, crew: ['Mina'] },
      ],
    },
    {
      name: 'Mars Relay Repair',
      description: 'Replace the failed transponder on the Mars relay.',
      fromDay: -30, // 1 Sep 2026
      toDay: -6, // 25 Sep 2026
      status: 'completed',
      owner: 'Priya',
      approvedBy: ['Marcus'],
      requirements: [
        { skill: 'engineer', minLevel: 5, crew: ['Noor'] },
        { skill: 'comms', minLevel: 2, crew: ['Rosa'] },
      ],
    },
    {
      name: 'Phobos Survey',
      description: 'Surface survey ahead of the sample-return programme.',
      fromDay: 243, // 1 Jun 2027
      toDay: 272, // 30 Jun 2027
      status: 'submitted',
      owner: 'Priya',
      requirements: [{ skill: 'medic', minLevel: 3, headcount: 2, crew: ['Mina', 'Quin'] }],
    },
    {
      name: 'Ceres Resupply',
      description: 'Supplies for the Ceres outpost.',
      fromDay: 214, // 3 May 2027
      toDay: 235, // 24 May 2027
      status: 'draft',
      owner: 'Sam',
      requirements: [
        { skill: 'pilot', minLevel: 3, crew: ['Ada'] },
        { skill: 'engineer', minLevel: 4, crew: ['Noor'] },
      ],
    },
    {
      name: 'Vesta Mapping',
      description: 'Orbital mapping of Vesta.',
      fromDay: 221, // 10 May 2027
      toDay: 242, // 31 May 2027
      status: 'draft',
      owner: 'Priya',
      requirements: [
        { skill: 'pilot', minLevel: 3, crew: ['Ada'] },
        { skill: 'geologist', minLevel: 3, crew: ['Sven'] },
      ],
    },
    {
      name: 'Titan Relay',
      description: 'Place a relay and sample the surface.',
      fromDay: 185, // 4 Apr 2027
      toDay: 211, // 30 Apr 2027
      status: 'draft',
      owner: 'Sam',
      requirements: [{ skill: 'geologist', minLevel: 4, headcount: 2 }],
    },
    {
      name: 'Io Flyby',
      description: 'A fast pass over Io.',
      fromDay: 249, // 7 Jun 2027
      toDay: 263, // 21 Jun 2027
      status: 'draft',
      owner: 'Sam',
      requirements: [
        { skill: 'pilot', minLevel: 3 },
        { skill: 'medic', minLevel: 4 },
      ],
    },
  ],
};

const helios: OrgSeed = {
  name: 'Helios Labs',
  slug: 'helios',
  settings: {
    ...DEFAULT_ORG_SETTINGS,
    approvals_required: 2,
    allow_unfilled_submission: true,
    match_weights: { ...DEFAULT_MATCH_WEIGHTS, proficiency: 0.6, workload: 0.25, rest: 0.15 },
  },
  skills: {
    'flight operations': 'operations',
    'field medicine': 'medical',
    robotics: 'engineering',
    spectroscopy: 'science',
    EVA: 'operations',
  },
  users: [
    { name: 'Ines Varga', role: 'director' },
    { name: 'Tomas Brandt', role: 'director' },
    { name: 'Yuki Mori', role: 'director' },
    { name: 'Farid Rahimi', role: 'mission_lead' },
  ],
  crew: [
    { name: 'Anouk Petit', skills: { 'flight operations': 5, EVA: 3 } },
    { name: 'Bao Tran', skills: { 'flight operations': 3, robotics: 4 } },
    { name: 'Carmen Ruiz', skills: { 'field medicine': 5 } },
    { name: 'Dev Malhotra', skills: { robotics: 5, spectroscopy: 3 } },
    { name: 'Elif Kaya', skills: { spectroscopy: 5 } },
    { name: 'Finn Larsen', skills: { EVA: 4, 'field medicine': 3 } },
    { name: 'Grace Mbeki', skills: { robotics: 3, EVA: 4 } },
    { name: 'Hiro Tanaka', skills: { spectroscopy: 4, 'flight operations': 2 } },
  ],
  missions: [
    {
      name: 'Solar Corona Probe',
      description: 'Spectral readings from inside the corona.',
      fromDay: 123, // 1 Feb 2027
      toDay: 150, // 28 Feb 2027
      status: 'submitted',
      owner: 'Farid',
      // One of the two approvals Helios Labs requires.
      approvedBy: ['Ines'],
      requirements: [
        { skill: 'flight operations', minLevel: 3, crew: ['Anouk'] },
        { skill: 'spectroscopy', minLevel: 4, crew: ['Elif'] },
      ],
    },
    {
      name: 'Mercury Flyby',
      description: 'Robotic sampling during a Mercury pass.',
      fromDay: 186, // 5 Apr 2027
      toDay: 207, // 26 Apr 2027
      status: 'draft',
      owner: 'Farid',
      requirements: [
        { skill: 'flight operations', minLevel: 3, crew: ['Bao'] },
        // One slot is open; Helios Labs allows the mission to be submitted anyway.
        { skill: 'robotics', minLevel: 4, headcount: 2, crew: ['Dev'] },
      ],
    },
  ],
};

export const SEED_ORGS: OrgSeed[] = [artemis, helios];
