#!/usr/bin/env bash
# One-time setup of the Google Cloud project that hosts the service.
# Safe to run again: each step first checks what already exists.
#
# Run it from Cloud Shell, or from any machine where gcloud is signed in as an
# owner of the project:
#
#   PROJECT_ID=my-project \
#   GITHUB_REPOSITORY=owner/name \
#   GITHUB_REPOSITORY_ID=123456789 \
#   bash infra/gcp-setup.sh
#
# The details are in docs/deployment.md.

set -euo pipefail

# gcloud must never wait for an answer: some of its output is hidden below,
# and a hidden question would freeze the script.
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID to the Google Cloud project}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:?Set GITHUB_REPOSITORY to owner/name}"
GITHUB_REPOSITORY_ID="${GITHUB_REPOSITORY_ID:?Set GITHUB_REPOSITORY_ID to the numeric id of the repository}"
REGION="${REGION:-us-east4}"
SERVICE="${SERVICE:-spherex-explorer}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-spherex-explorer}"
POOL="${POOL:-github}"
PROVIDER="${PROVIDER:-github-actions}"
KEPT_IMAGES="${KEPT_IMAGES:-5}"

DEPLOYER="spx-deployer"
RUNTIME="spx-runtime"
DEPLOYER_EMAIL="${DEPLOYER}@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_EMAIL="${RUNTIME}@${PROJECT_ID}.iam.gserviceaccount.com"
# Public sample image from Google. It only holds the place until the first deployment.
PLACEHOLDER_IMAGE="us-docker.pkg.dev/cloudrun/container/hello"

step() {
  printf '\n==> %s\n' "$1"
}

warn() {
  printf 'WARNING: %s\n' "$1" >&2
}

# A new service account can take a few seconds to be visible to the other services.
retry() {
  local attempt
  for attempt in 1 2 3 4 5 6; do
    if "$@"; then
      return 0
    fi
    printf 'Attempt %s failed, waiting before the next one.\n' "$attempt" >&2
    sleep 5
  done
  printf 'Giving up after 6 attempts: %s\n' "$*" >&2
  return 1
}

create_service_account() {
  local name="$1"
  local title="$2"
  local email="${name}@${PROJECT_ID}.iam.gserviceaccount.com"
  if gcloud iam service-accounts describe "$email" --project="$PROJECT_ID" > /dev/null 2>&1; then
    echo "Service account ${email} already exists."
  else
    gcloud iam service-accounts create "$name" --project="$PROJECT_ID" --display-name="$title"
  fi
}

step "Project"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
echo "${PROJECT_ID} (number ${PROJECT_NUMBER}), region ${REGION}"

step "Enable the services"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  cloudresourcemanager.googleapis.com \
  firestore.googleapis.com \
  --project="$PROJECT_ID"

# A service that was just enabled can refuse calls for a minute or two.
wait_for() {
  local label="$1"
  shift
  local attempt
  for attempt in $(seq 1 24); do
    if "$@" > /dev/null 2>&1; then
      echo "${label} is ready."
      return 0
    fi
    sleep 5
  done
  printf '%s did not become ready within two minutes. Run the script again.\n' "$label" >&2
  return 1
}
wait_for "Artifact Registry" gcloud artifacts repositories list --project="$PROJECT_ID" --location="$REGION"
wait_for "IAM" gcloud iam service-accounts list --project="$PROJECT_ID"
wait_for "Cloud Run" gcloud run services list --project="$PROJECT_ID" --region="$REGION"

step "Image repository"
if gcloud artifacts repositories describe "$IMAGE_REPOSITORY" --location="$REGION" --project="$PROJECT_ID" > /dev/null 2>&1; then
  echo "Repository ${IMAGE_REPOSITORY} already exists."
else
  gcloud artifacts repositories create "$IMAGE_REPOSITORY" \
    --project="$PROJECT_ID" \
    --location="$REGION" \
    --repository-format=docker \
    --description="Container images of the SPHEREx explorer service"
fi

# Old images are deleted after a day, except the most recent ones, kept for rollbacks.
policy_file="$(mktemp)"
cat > "$policy_file" <<POLICY
[
  {
    "name": "keep-most-recent",
    "action": { "type": "Keep" },
    "mostRecentVersions": { "keepCount": ${KEPT_IMAGES} }
  },
  {
    "name": "delete-older-than-one-day",
    "action": { "type": "Delete" },
    "condition": { "tagState": "ANY", "olderThan": "1d" }
  }
]
POLICY
if ! gcloud artifacts repositories set-cleanup-policies "$IMAGE_REPOSITORY" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --policy="$policy_file" \
  --no-dry-run; then
  warn "The cleanup policy was not applied. Old images will pile up until it is set by hand."
fi
rm -f "$policy_file"

step "Service accounts"
create_service_account "$DEPLOYER" "Deploys the service from GitHub Actions"
create_service_account "$RUNTIME" "Identity of the running service"

step "Permissions of the deployer"
# Deploy revisions, without the right to change who can call the service.
retry gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOYER_EMAIL}" \
  --role="roles/run.developer" \
  --condition=None > /dev/null
# Push images to this repository only.
retry gcloud artifacts repositories add-iam-policy-binding "$IMAGE_REPOSITORY" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --member="serviceAccount:${DEPLOYER_EMAIL}" \
  --role="roles/artifactregistry.writer" > /dev/null
# Start the service under its runtime identity.
retry gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_EMAIL" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${DEPLOYER_EMAIL}" \
  --role="roles/iam.serviceAccountUser" > /dev/null
echo "Done."

step "Database of the journal"
# The marks visitors share are kept in the Firestore database of the project. Its place
# cannot be changed afterwards: it is the region of the service.
if gcloud firestore databases describe --database="(default)" --project="$PROJECT_ID" > /dev/null 2>&1; then
  echo "The database exists."
else
  gcloud firestore databases create --location="$REGION" --project="$PROJECT_ID" > /dev/null
  echo "Database created in ${REGION}."
fi
# The running service reads and writes that database, and nothing else in the project.
retry gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_EMAIL}" \
  --role="roles/datastore.user" \
  --condition=None > /dev/null
echo "Done. The runtime identity can read and write the journal: the rest is public data."

step "Trust between GitHub Actions and Google Cloud"
if gcloud iam workload-identity-pools describe "$POOL" --project="$PROJECT_ID" --location=global > /dev/null 2>&1; then
  echo "Pool ${POOL} already exists."
else
  gcloud iam workload-identity-pools create "$POOL" \
    --project="$PROJECT_ID" \
    --location=global \
    --display-name="GitHub Actions"
fi

# Only this repository, and only its main branch, can obtain credentials.
if gcloud iam workload-identity-pools providers describe "$PROVIDER" --project="$PROJECT_ID" --location=global --workload-identity-pool="$POOL" > /dev/null 2>&1; then
  echo "Provider ${PROVIDER} already exists."
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --project="$PROJECT_ID" \
    --location=global \
    --workload-identity-pool="$POOL" \
    --display-name="GitHub Actions" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository_id == '${GITHUB_REPOSITORY_ID}' && assertion.ref == 'refs/heads/main'"
fi

POOL_NAME="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}"
retry gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_EMAIL" \
  --project="$PROJECT_ID" \
  --member="principalSet://iam.googleapis.com/${POOL_NAME}/attribute.repository/${GITHUB_REPOSITORY}" \
  --role="roles/iam.workloadIdentityUser" > /dev/null
echo "Workflows of ${GITHUB_REPOSITORY} on main can act as ${DEPLOYER_EMAIL}."

step "Cloud Run service"
if gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" > /dev/null 2>&1; then
  echo "Service ${SERVICE} already exists."
else
  gcloud run deploy "$SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --image="$PLACEHOLDER_IMAGE" \
    --service-account="$RUNTIME_EMAIL" \
    --max-instances=3 \
    --no-allow-unauthenticated \
    --quiet
fi

# Public access is a decision taken here, by a person. The deployments keep it and cannot change it.
gcloud run services update "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --no-invoker-iam-check \
  --quiet

SERVICE_URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)')"

step "Summary"
cat <<SUMMARY
Service URL: ${SERVICE_URL}

Repository variables to set on GitHub (Settings, Secrets and variables, Actions, Variables):

  GCP_PROJECT_ID=${PROJECT_ID}
  GCP_REGION=${REGION}
  GCP_WORKLOAD_IDENTITY_PROVIDER=${POOL_NAME}/providers/${PROVIDER}
  GCP_DEPLOY_SERVICE_ACCOUNT=${DEPLOYER_EMAIL}
  GCP_RUNTIME_SERVICE_ACCOUNT=${RUNTIME_EMAIL}

SETUP COMPLETE
SUMMARY
