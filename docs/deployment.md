# Deployment of the service

How the Python service gets from the repository to its public address, and how to operate it. The site is deployed separately, see the [architecture plan](architecture.md#hosting-and-tooling).

## In short

- The service runs on Google Cloud Run, in the `us-east4` region, next to the SPHEREx files.
- Every merge to `main` that touches `backend/` builds the container image, publishes it and deploys it. Nobody deploys by hand.
- GitHub holds no key and no password. Google Cloud trusts the workflows of this repository on the `main` branch, and nothing else.
- The service sleeps when nobody calls it, and wakes up on the next request.

## What happens on a merge

The workflow is [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).

1. It builds the image from `backend/Dockerfile` and names it after the commit.
2. It proves its identity to Google Cloud with a short-lived token issued by GitHub. This is Workload Identity Federation.
3. It pushes the image to Artifact Registry.
4. It deploys a new revision of the Cloud Run service with the Google Cloud CLI, with the settings written in the workflow.
5. It calls `/api/health` on the public address. The run fails if the answer is not healthy.

The same workflow can be started by hand from the Actions tab, on `main` only.

## Settings

The settings of the service are in the workflow: 2 CPUs, 1 GiB of memory, the second generation execution environment, 0 to 3 instances, 20 requests at a time per instance, 60 seconds per request. The container starts one worker process per CPU (`WEB_CONCURRENCY` in the Dockerfile): keep the two numbers equal. To change one, change the workflow in a pull request.

What depends on the environment is a repository variable on GitHub (Settings, Secrets and variables, Actions, Variables). None of them is a secret.

| Variable | Meaning |
| --- | --- |
| `GCP_PROJECT_ID` | Google Cloud project that hosts the service |
| `GCP_REGION` | Region of the service and of the image repository |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full name of the identity provider that trusts this repository |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | Service account the workflow acts as |
| `GCP_RUNTIME_SERVICE_ACCOUNT` | Service account the service runs as |
| `SPX_ALLOWED_ORIGINS` | Origins allowed to call the service from a browser, separated by commas, without spaces or quotes. Example: `http://localhost:5173,https://example.org` |

When the site gets its address, add it to `SPX_ALLOWED_ORIGINS` and start the workflow again.

## One-time setup of the Google Cloud project

[`infra/gcp-setup.sh`](../infra/gcp-setup.sh) creates everything the workflow needs. It can be run again safely. Run it from Cloud Shell, signed in as an owner of the project:

```
PROJECT_ID=my-project GITHUB_REPOSITORY=owner/name GITHUB_REPOSITORY_ID=123456789 bash infra/gcp-setup.sh
```

`gh api repos/owner/name --jq .id` gives the numeric id of the repository. The script ends with the values of the repository variables.

What it creates:

| Resource | Purpose |
| --- | --- |
| Six enabled services | Cloud Run, Artifact Registry, IAM, IAM Credentials, Security Token Service, Resource Manager |
| Artifact Registry repository `spherex-explorer` | Holds the images. It keeps the 5 most recent and deletes the others after a day |
| Service account `spx-deployer` | Used by the workflow. It can push images to that repository and deploy revisions, nothing more |
| Service account `spx-runtime` | Identity of the running service. It has no permission, because the service only reads public data |
| Workload identity pool `github` and its provider | Accept tokens from this repository only, identified by its numeric id, and from the `main` branch only |
| Cloud Run service `spherex-explorer` | Created with a sample image from Google, replaced by the first deployment |

Neither service account has a key.

## Public access

The service is public: anyone can call it without signing in. The setup script turns off the caller check of Cloud Run for this service, which is the way that works in an organization that restricts sharing to its own domain.

This is decided once, by a person. The deployer cannot change who may call the service, and a deployment keeps the setting as it is.

## When a deployment fails

A revision that does not start never receives traffic: Cloud Run keeps serving the previous one, and the run turns red. The service refuses to start on an invalid setting, on purpose, so a wrong variable shows up here and not in front of a user. The reason is in the logs of the revision, linked from the failed run.

## Rolling back

Preferred: revert the pull request on GitHub and merge the revert. `main` stays equal to what is deployed.

In an emergency, from Cloud Shell:

```
gcloud run revisions list --service=spherex-explorer --region=us-east4
gcloud run services update-traffic spherex-explorer --region=us-east4 --to-revisions=REVISION_NAME=100
```

The next merge deploys a new revision and takes the traffic back.

## Costs and limits

- With zero instances when idle, the service costs nothing while nobody uses it. The monthly free tier of Cloud Run covers the expected use, see the [architecture plan](architecture.md#hosting-and-tooling).
- Three instances at most: a traffic peak slows the service down instead of raising the bill.
- The first request after a pause waits for the container to start.

## Removing everything

Deleting the Cloud Run service and the Artifact Registry repository stops all use. Deleting the Google Cloud project removes the rest.
