#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# RiverBeat — Google Cloud Run Deployment Script (with GCS Persistent Volume)
# ==============================================================================

# Ensure Homebrew / local google-cloud-sdk paths are included if not already in PATH
for sdk_bin in "/opt/homebrew/share/google-cloud-sdk/bin" "$HOME/google-cloud-sdk/bin" "/usr/local/share/google-cloud-sdk/bin"; do
  if [[ -d "${sdk_bin}" ]] && [[ ":$PATH:" != *":${sdk_bin}:"* ]]; then
    export PATH="${sdk_bin}:$PATH"
  fi
done

if ! command -v gcloud >/dev/null 2>&1; then
  echo "Error: Google Cloud CLI ('gcloud') is not installed."
  echo "Install it on macOS with Homebrew:"
  echo "  brew install --cask google-cloud-sdk"
  echo "Then authenticate and set your project:"
  echo "  gcloud init"
  exit 1
fi

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${REGION:-us-west1}"
SERVICE_NAME="${SERVICE_NAME:-riverbeat}"

if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "(unset)" ]]; then
  echo "Error: No Google Cloud project is active."
  echo "Run: gcloud auth login && gcloud config set project YOUR_PROJECT_ID"
  exit 1
fi

BUCKET_NAME="${BUCKET_NAME:-${PROJECT_ID}-riverbeat-data}"

if [[ -z "${GOOGLE_CLIENT_ID:-}" ]]; then
  echo "Warning: GOOGLE_CLIENT_ID is not set. Deploying without Google Sign-In gate."
fi

echo "==> Ensuring required APIs (run, cloudbuild, storage) are enabled on ${PROJECT_ID}..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com storage.googleapis.com --project="${PROJECT_ID}"

echo "==> Ensuring Cloud Storage bucket gs://${BUCKET_NAME} exists in ${REGION}..."
if ! gcloud storage buckets describe "gs://${BUCKET_NAME}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET_NAME}" --project="${PROJECT_ID}" --location="${REGION}" --uniform-bucket-level-access
fi

echo "==> Deploying ${SERVICE_NAME} to Cloud Run (${REGION})..."
gcloud run deploy "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --source . \
  --region "${REGION}" \
  --allow-unauthenticated \
  --execution-environment gen2 \
  --max-instances 1 \
  --memory 512Mi \
  --cpu 1 \
  --add-volume="name=riverbeat-data,type=cloud-storage,bucket=${BUCKET_NAME}" \
  --add-volume-mount="volume=riverbeat-data,mount-path=/app/data" \
  --set-env-vars="NODE_ENV=production,DATA_DIR=/app/data,GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-},ALLOWED_EMAILS=${ALLOWED_EMAILS:-}"

echo "==> Deployment complete!"
