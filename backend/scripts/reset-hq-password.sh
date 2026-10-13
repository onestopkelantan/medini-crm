#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# Set semula password hq (pilot). Hash dijana DALAM container (host tiada argon2).
# Jangan cetak password atau hash penuh ke output.
set -e
PASS="$SEED_DEMO_PASSWORD"
HASH=$(docker exec -e P="$PASS" medini-prod-backend-1 node -e 'const a=require("argon2");a.hash(process.env.P,{type:a.argon2id}).then(h=>process.stdout.write(h))')
if [ -z "$HASH" ]; then echo "GAGAL jana hash"; exit 1; fi
echo "hash dijana: panjang=${#HASH} awalan=$(printf '%s' "$HASH" | cut -c1-14)"
DBP=$(docker exec medini-prod-mysql-1 sh -c 'printf %s "$MYSQL_PASSWORD"')
docker exec -i medini-prod-mysql-1 mysql -umedini -p"$DBP" medini_prod -e \
  "UPDATE staff SET password_hash='${HASH}', status='Active' WHERE username='hq';" 2>&1 | grep -v "Using a password"
echo "--- keadaan staff selepas update ---"
docker exec -i medini-prod-mysql-1 mysql -umedini -p"$DBP" medini_prod -N -B -e \
  "SELECT username, role, status, CASE WHEN password_hash IS NULL THEN 'TIADA' ELSE 'ADA' END FROM staff;" 2>&1 | grep -v "Using a password"
echo "--- ujian login (tidak cetak token) ---"
curl -sk -o /dev/null -w "HTTP=%{http_code}\n" -X POST https://localhost/api/v1/auth/login \
  -H "Content-Type: application/json" -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "hq")"
