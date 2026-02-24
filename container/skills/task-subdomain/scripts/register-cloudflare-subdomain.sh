#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <subdomain-slug>" >&2
  exit 2
fi

slug="$1"
token="${CLOUDFLARE_API_TOKEN:-}"
zone_id="${CLOUDFLARE_ZONE_ID:-}"
zone_name="${CLOUDFLARE_ZONE_NAME:-}"
tunnel_target="${CLOUDFLARE_TUNNEL_TARGET:-}"

if [[ -z "$token" || -z "$zone_id" || -z "$zone_name" || -z "$tunnel_target" ]]; then
  echo "missing env vars: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, CLOUDFLARE_ZONE_NAME, CLOUDFLARE_TUNNEL_TARGET" >&2
  exit 3
fi

fqdn="${slug}.${zone_name}"
api="https://api.cloudflare.com/client/v4"
auth_headers=(
  -H "Authorization: Bearer ${token}"
  -H "Content-Type: application/json"
)

payload=$(cat <<JSON
{"type":"CNAME","name":"${fqdn}","content":"${tunnel_target}","ttl":1,"proxied":true}
JSON
)

# Try create first.
create_resp="$(curl -sS -X POST "${api}/zones/${zone_id}/dns_records" "${auth_headers[@]}" --data "${payload}")"
create_ok="$(printf '%s' "${create_resp}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.success?"1":"0")}catch{process.stdout.write("0")}})')"

if [[ "${create_ok}" == "1" ]]; then
  echo "ok: https://${fqdn}"
  exit 0
fi

# If already exists, update existing record.
lookup_resp="$(curl -sS "${api}/zones/${zone_id}/dns_records?type=CNAME&name=${fqdn}" "${auth_headers[@]}")"
record_id="$(printf '%s' "${lookup_resp}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const id=j?.result?.[0]?.id||"";process.stdout.write(id)}catch{process.stdout.write("")}})')"

if [[ -z "${record_id}" ]]; then
  echo "error: could not create or find existing DNS record for ${fqdn}" >&2
  printf '%s\n' "${create_resp}" >&2
  exit 4
fi

update_resp="$(curl -sS -X PUT "${api}/zones/${zone_id}/dns_records/${record_id}" "${auth_headers[@]}" --data "${payload}")"
update_ok="$(printf '%s' "${update_resp}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.success?"1":"0")}catch{process.stdout.write("0")}})')"

if [[ "${update_ok}" != "1" ]]; then
  echo "error: failed updating DNS record ${record_id} (${fqdn})" >&2
  printf '%s\n' "${update_resp}" >&2
  exit 5
fi

echo "ok: https://${fqdn}"
