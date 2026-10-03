#!/usr/bin/env bash
# Logs in as each seeded demo user, one profile each, with `lead` current. A repository script, not
# a CLI feature (DESIGN.md section 8): it runs `mctl login --password-stdin` six times. The API
# address comes from MCTL_API, or the default.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
password="mission-control-demo"

# The first login becomes current, so lead goes first.
while read -r profile org email; do
  printf '%s\n' "$password" | "$root/bin/mctl" login --org "$org" --email "$email" --profile "$profile" --password-stdin >/dev/null
  echo "  logged in as $email: profile $profile"
done <<'PROFILES'
lead     artemis sam@artemis.example
director artemis dana@artemis.example
ada      artemis ada@artemis.example
quin     artemis quin@artemis.example
mina     artemis mina@artemis.example
helios   helios  farid@helios.example
PROFILES
echo "  current profile: lead"
