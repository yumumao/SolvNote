#!/usr/bin/env bash
# CI-only smoke test: immutable image, isolated synthetic volumes, no AI/network.
set -euo pipefail

if [[ ! "${IMAGE_REF:-}" =~ ^ghcr\.io/[a-z0-9_.-]+/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$ ]]; then
  echo 'IMAGE_REF must be an immutable GHCR image digest.' >&2
  exit 2
fi
command -v docker >/dev/null
command -v node >/dev/null
umask 077
tmp=$(mktemp -d -t wrong-notebook-smoke.XXXXXXXX)
run_id="wn-smoke-$(node -e "process.stdout.write(require('node:crypto').randomBytes(12).toString('hex'))")"
containers=()
volumes=()
phase=setup

# Cleanup only resources created by this invocation; never user volumes/paths.
cleanup() {
  local result=$? resource owner
  trap - EXIT
  if (( result != 0 )); then
    echo "Container smoke failed during phase: $phase" >&2
    for resource in "${containers[@]}"; do
      docker logs "$resource" > "$tmp/container.log" 2>&1 || true
      # Report fixed diagnostic categories, never raw logs or environment values.
      for category in MODULE_NOT_FOUND PrismaClientInitializationError 'Admin initialization failed' 'Database migration failed' 'Tag initialization failed' INITIAL_ADMIN_PASSWORD; do
        if grep -Fq "$category" "$tmp/container.log"; then
          printf 'Diagnostic category: %s\n' "$category" >&2
        fi
      done
    done
  fi
  for resource in "${containers[@]}"; do
    owner=$(docker inspect --format '{{index .Config.Labels "wrong-notebook.smoke"}}' "$resource" 2>/dev/null) || continue
    if [[ "$owner" == "$run_id" ]]; then docker rm -f "$resource" >/dev/null 2>&1 || true; fi
  done
  for resource in "${volumes[@]}"; do
    owner=$(docker volume inspect --format '{{index .Labels "wrong-notebook.smoke"}}' "$resource" 2>/dev/null) || continue
    if [[ "$owner" == "$run_id" ]]; then docker volume rm "$resource" >/dev/null 2>&1 || true; fi
  done
  # mktemp returned an absolute, unique directory; no caller-supplied path here.
  if [[ "$tmp" == /*/wrong-notebook-smoke.* && -d "$tmp" ]]; then rm -rf -- "$tmp"; fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

node - "$tmp" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = process.argv[2];
const common = [
  'AI_WORKER_DISABLED=1',
  'NEXT_TELEMETRY_DISABLED=1',
  'NEXTAUTH_URL=http://127.0.0.1:3000',
  `NEXTAUTH_SECRET=${crypto.randomBytes(32).toString('hex')}`,
  'DATABASE_URL=file:/app/data/dev.db',
  'HTTPS_ENABLED=false',
].join('\n') + '\n';
fs.writeFileSync(path.join(root, 'retained.env'), common, {mode: 0o600});
fs.writeFileSync(path.join(root, 'fresh.env'), common +
  'INITIAL_ADMIN_EMAIL=bootstrap@example.invalid\n' +
  `INITIAL_ADMIN_PASSWORD=${crypto.randomBytes(32).toString('hex')}\n`, {mode: 0o600});
NODE

phase=pull
docker pull "$IMAGE_REF" > "$tmp/pull.log" 2>&1

make_volume() {
  local name="$run_id-$1"
  # Names are random, but still refuse an existing resource rather than adopt it.
  if docker volume inspect "$name" >/dev/null 2>&1; then return 1; fi
  docker volume create --label "wrong-notebook.smoke=$run_id" "$name" >/dev/null
  volumes+=("$name")
}
make_container() {
  local name="$run_id-$1" env_file="$2" data="$3" config="$4"
  if docker inspect "$name" >/dev/null 2>&1; then return 1; fi
  docker create --name "$name" --label "wrong-notebook.smoke=$run_id" \
    --network none --env-file "$env_file" \
    --mount "type=volume,source=$data,target=/app/data" \
    --mount "type=volume,source=$config,target=/app/config" \
    "$IMAGE_REF" > "$tmp/create.log" 2>&1
  containers+=("$name")
  docker start "$name" >/dev/null
}
wait_http() {
  local name="$1" attempt
  for ((attempt=0; attempt<90; attempt++)); do
    [[ "$(docker inspect --format '{{.State.Running}}' "$name")" == true ]] || return 1
    if docker exec --user nextjs:nodejs "$name" node -e '
      fetch("http://127.0.0.1:3000/login", {signal: AbortSignal.timeout(2000), redirect: "manual"})
        .then(r => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1));
    ' >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo 'HTTP readiness deadline exceeded.' >&2
  return 1
}

phase=fresh-database
make_volume data
make_volume config
make_container fresh "$tmp/fresh.env" "$run_id-data" "$run_id-config"
wait_http "$run_id-fresh"
# Exercise the actual CLI imports and native Prisma engine inside the image.
docker exec -i --user nextjs:nodejs "$run_id-fresh" node <<'NODE'
const {PrismaClient} = require('@prisma/client');
const {compare} = require('bcryptjs');
const fs = require('node:fs');
const crypto = require('node:crypto');
const prisma = new PrismaClient();
(async () => {
  const users = await prisma.user.findMany();
  const admin = users[0];
  if (users.length !== 1 || admin.role !== 'admin' || !admin.isActive ||
      admin.email !== process.env.INITIAL_ADMIN_EMAIL ||
      !await compare(process.env.INITIAL_ADMIN_PASSWORD, admin.password)) throw Error();
  if (!fs.existsSync('/app/data/.seed_completed') || !fs.existsSync('/app/data/.app_version') ||
      await prisma.knowledgeTag.count() === 0) throw Error();
  // A renamed/disabled admin still owns the install; restart must not reset it.
  const changed = await prisma.user.update({where: {id: admin.id}, data: {
    email: 'renamed@example.invalid', name: 'Retained synthetic administrator',
    isActive: false, educationStage: 'primary', enrollmentYear: 2024,
  }});
  fs.writeFileSync('/app/data/.smoke-admin-fingerprint',
    crypto.createHash('sha256').update(JSON.stringify(changed)).digest('hex'), {mode: 0o600});
  const marker = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync('/app/config/.smoke-retained', marker, {mode: 0o600});
  fs.writeFileSync('/app/data/.smoke-config-fingerprint',
    crypto.createHash('sha256').update(marker).digest('hex'), {mode: 0o600});
  console.log('PASS: fresh migrations, bcrypt bootstrap, system tags and HTTP.');
})().catch(() => {console.error('Fresh synthetic state assertion failed.'); process.exitCode = 1;})
  .finally(() => prisma.$disconnect());
NODE
docker stop --time 15 "$run_id-fresh" >/dev/null

phase=retained-volumes
# No initial password on restart; reuse ONLY volumes created just above.
make_container retained "$tmp/retained.env" "$run_id-data" "$run_id-config"
wait_http "$run_id-retained"
docker exec -i --user nextjs:nodejs "$run_id-retained" node <<'NODE'
const {PrismaClient} = require('@prisma/client');
const fs = require('node:fs');
const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const prisma = new PrismaClient();
(async () => {
  if (process.env.INITIAL_ADMIN_PASSWORD !== undefined) throw Error();
  const users = await prisma.user.findMany();
  if (users.length !== 1 || digest(JSON.stringify(users[0])) !==
      fs.readFileSync('/app/data/.smoke-admin-fingerprint', 'utf8')) throw Error();
  if (digest(fs.readFileSync('/app/config/.smoke-retained')) !==
      fs.readFileSync('/app/data/.smoke-config-fingerprint', 'utf8')) throw Error();
  console.log('PASS: retained administrator unchanged, both volumes preserved, HTTP ready.');
})().catch(() => {console.error('Retained synthetic state assertion failed.'); process.exitCode = 1;})
  .finally(() => prisma.$disconnect());
NODE
docker stop --time 15 "$run_id-retained" >/dev/null

phase=missing-initial-password
make_volume rejected-data
make_volume rejected-config
make_container rejected "$tmp/retained.env" "$run_id-rejected-data" "$run_id-rejected-config"
for ((attempt=0; attempt<60; attempt++)); do
  [[ "$(docker inspect --format '{{.State.Running}}' "$run_id-rejected")" == true ]] || break
  sleep 1
done
[[ "$(docker inspect --format '{{.State.Running}}' "$run_id-rejected")" == false ]]
[[ "$(docker inspect --format '{{.State.ExitCode}}' "$run_id-rejected")" == 1 ]]
docker logs "$run_id-rejected" > "$tmp/rejected.log" 2>&1
grep -Fq 'Admin initialization failed; refusing to start the application.' "$tmp/rejected.log"
grep -Fq 'INITIAL_ADMIN_PASSWORD' "$tmp/rejected.log"
for marker in .seed_completed .app_version; do
  if docker cp "$run_id-rejected:/app/data/$marker" "$tmp/unexpected-marker" >/dev/null 2>&1; then
    echo 'Failed initialization incorrectly recorded a success marker.' >&2
    exit 1
  fi
done
echo 'PASS: fresh database without initial password refuses startup without success markers.'
echo 'Container startup smoke passed (synthetic volumes only; no external network).'
