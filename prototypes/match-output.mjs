#!/usr/bin/env node
// PROTOTYPE — throwaway. What should `mctl match run` print?
// Usage: node prototypes/match-output.mjs [--variant a|b|c] [--scenario full|unfilled|clash]
// With no flags it prints every variant for every scenario.

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map(s => s.trim().split(/\s+/)));
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = s => c(1, s), dim = s => c(2, s), green = s => c(32, s), yellow = s => c(33, s), red = s => c(31, s), cyan = s => c(36, s);

const W = { proficiency: 0.45, workload: 0.35, rest: 0.2 };
const score = (level, min, days, rest) => {
  const p = (0.6 + 0.1 * (level - min)) * W.proficiency, w = (1 - days / 180) * W.workload, r = (Math.min(rest ?? 30, 30) / 30) * W.rest;
  return { total: p + w + r, p, w, r };
};
const pct = x => String(Math.round(x * 100));
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - strip(s).length));
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');
const bar = (s, width = 20) => {
  const n = k => Math.round(s[k] * width);
  return cyan('█'.repeat(n('p'))) + c(34, '▓'.repeat(n('w'))) + dim('░'.repeat(n('r'))) + ' '.repeat(Math.max(0, width - n('p') - n('w') - n('r')));
};
const who = (ref, name, level, min, days, rest, extra = {}) => ({ ref, name, level, days, rest, s: score(level, min, days, rest), ...extra });

const SCENARIOS = {
  full: {
    mission: 'MSN-4  Europa Survey', period: '1–20 Mar 2027', run: 'RUN-9', filled: 3, total: 3,
    slots: [
      { label: 'pilot', min: 3, chosen: who('CRW-1', 'Ada Reyes', 5, 3, 20, 25),
        alternates: [who('CRW-2', 'Ben Osei', 4, 3, 20, 25), who('CRW-9', 'Cy Lindqvist', 3, 3, 60, 10)] },
      { label: 'medic 1 of 2', min: 3, chosen: who('CRW-7', 'Quin Abara', 3, 3, 15, 30),
        alternates: [who('CRW-1', 'Ada Reyes', 4, 3, 20, 25, { note: 'chosen as pilot' })] },
      { label: 'medic 2 of 2', min: 3, chosen: who('CRW-3', 'Mina Farouk', 4, 3, 25, 22), alternates: [] },
    ],
    excluded: ['CRW-5 Omar Vance — availability block AVL-3, 5–12 Mar', 'CRW-4 Noor Haddad — medic certification expires 10 Mar, before the mission ends'],
  },
  unfilled: {
    mission: 'MSN-7  Titan Relay', period: '4–30 Apr 2027', run: 'RUN-12', filled: 1, total: 2,
    slots: [
      { label: 'medic 1 of 2', min: 4, chosen: who('CRW-11', 'Rosa Imani', 4, 4, 20, 20), alternates: [] },
      { label: 'medic 2 of 2', min: 4, unfilled: {
          reasons: ['1 below level 4', '1 has an availability block', '11 do not have medic'],
          nearest: ['CRW-13 Tala Moreno — medic level 5, availability block AVL-8, 1–14 Apr', 'CRW-12 Sven Dahl — medic level 3, needs 4'],
          try: ['lower the level:  mctl mission require MSN-7 --skill medic --level 3 --count 2', 'or the headcount: mctl mission require MSN-7 --skill medic --level 4 --count 1'] } },
    ],
    excluded: [],
  },
  clash: {
    mission: 'MSN-8  Ceres Resupply', period: '10–24 Mar 2027', run: 'RUN-14', filled: 1, total: 1,
    slots: [
      { label: 'pilot', min: 3, chosen: who('CRW-1', 'Ada Reyes', 5, 3, 20, 25, { clash: 'MSN-4 Europa Survey (draft, owner Sam Okafor)' }), alternates: [] },
    ],
    excluded: ['CRW-2 Ben Osei — availability block AVL-5, 8–15 Mar', 'CRW-9 Cy Lindqvist — held by MSN-2 Lunar Gateway (submitted), 1–31 Mar'],
  },
};

const head = sc => `${bold(sc.mission)}  ${dim(sc.period)}\n`;
const verdict = sc => (sc.filled === sc.total ? green(`✓ ${sc.filled} of ${sc.total} slots filled`) : yellow(`! ${sc.filled} of ${sc.total} slots filled`));
const next = sc => {
  const lines = [`Saved as ${bold(sc.run)}. Nothing has changed yet.`, `  Apply it:      mctl match apply ${sc.run}`];
  if (sc.slots.some(s => s.alternates?.length)) lines.push(`  Pick another:  mctl assignment add ${sc.mission.split(' ')[0]} --crew CRW-2 --skill pilot`);
  return dim(lines.join('\n'));
};

// Variant A — one table, alternates indented beneath each slot.
function variantA(sc) {
  let out = head(sc) + verdict(sc) + '\n\n';
  out += dim(pad('SLOT', 16) + pad('CREW', 22) + pad('LVL', 5) + pad('SCORE', 7) + 'proficiency ▓ workload ░ rest') + '\n';
  for (const s of sc.slots) {
    if (s.chosen) {
      const x = s.chosen;
      out += pad(`${s.label} ≥${s.min}`, 16) + pad(bold(x.name), 22) + pad(String(x.level), 5) + pad(bold(pct(x.s.total)), 7) + bar(x.s) + '\n';
      if (x.clash) out += pad('', 16) + yellow(`⚠ clash: also proposed on ${x.clash}`) + '\n';
      for (const a of s.alternates) out += pad('', 16) + dim(pad(`  alt ${a.name}`, 22) + pad(String(a.level), 5) + pad(pct(a.s.total), 7) + (a.note ? a.note : '')) + '\n';
    } else {
      out += pad(`${s.label} ≥${s.min}`, 16) + red(bold('unfilled')) + '   ' + s.unfilled.reasons.join(' · ') + '\n';
      for (const n of s.unfilled.nearest) out += pad('', 16) + `nearest: ${n}` + '\n';
      for (const t of s.unfilled.try) out += pad('', 16) + dim(t) + '\n';
    }
  }
  if (sc.excluded.length) out += '\n' + dim('Excluded with the skill:\n' + sc.excluded.map(e => '  ' + e).join('\n')) + '\n';
  return out + '\n' + next(sc) + '\n';
}

// Variant B — one block per slot, with the reasoning in words.
function variantB(sc) {
  let out = head(sc) + verdict(sc) + '\n';
  for (const s of sc.slots) {
    out += '\n' + bold(`${s.label}`) + dim(`  level ${s.min} or above`) + '\n';
    if (s.chosen) {
      const x = s.chosen;
      out += `  ${green('→')} ${bold(x.name)} ${dim(x.ref)}   score ${bold(pct(x.s.total))}\n`;
      out += `    level ${x.level} (${pct(x.s.p)} of ${pct(W.proficiency)}) · ${x.days} of 180 days assigned (${pct(x.s.w)} of ${pct(W.workload)}) · ${x.rest} days rested (${pct(x.s.r)} of ${pct(W.rest)})\n`;
      if (x.clash) out += `    ${yellow(`⚠ clash: also proposed on ${x.clash}. Neither mission can be submitted until one lets her go.`)}\n`;
      if (s.alternates.length) out += dim('    alternates: ' + s.alternates.map(a => `${a.name} ${pct(a.s.total)}${a.note ? ` (${a.note})` : ''}`).join(', ')) + '\n';
    } else {
      out += `  ${red('✗ unfilled')} — nobody qualifies: ${s.unfilled.reasons.join(', ')}\n`;
      for (const n of s.unfilled.nearest) out += `    nearest: ${n}\n`;
      for (const t of s.unfilled.try) out += dim(`    ${t}`) + '\n';
    }
  }
  if (sc.excluded.length) out += '\n' + dim('Excluded with the skill:\n' + sc.excluded.map(e => '  ' + e).join('\n')) + '\n';
  return out + '\n' + next(sc) + '\n';
}

// Variant C — compact summary; detail only on request.
function variantC(sc) {
  let out = head(sc) + verdict(sc) + '\n\n';
  for (const s of sc.slots) {
    if (s.chosen) out += `  ${pad(s.label, 14)} ${pad(bold(s.chosen.name), 18)} ${pct(s.chosen.s.total)}${s.chosen.clash ? yellow('  ⚠ clash with ' + s.chosen.clash.split(' ')[0]) : ''}\n`;
    else out += `  ${pad(s.label, 14)} ${red('unfilled')}  nearest: ${s.unfilled.nearest[0].split(' — ')[0]}\n`;
  }
  return out + '\n' + dim(`Saved as ${sc.run}. Why these people:  mctl match show ${sc.run}\n                 Apply it:          mctl match apply ${sc.run}`) + '\n';
}

const VARIANTS = { a: ['A — one table, alternates beneath', variantA], b: ['B — a block per slot, reasons in words', variantB], c: ['C — compact, detail on request', variantC] };
for (const v of args.variant ? [args.variant] : Object.keys(VARIANTS))
  for (const s of args.scenario ? [args.scenario] : Object.keys(SCENARIOS)) {
    console.log(dim(`──── variant ${VARIANTS[v][0]} · scenario: ${s} ────`));
    console.log(dim(`$ mctl match run ${SCENARIOS[s].mission.split(' ')[0]}`) + '\n');
    console.log(VARIANTS[v][1](SCENARIOS[s]));
  }
