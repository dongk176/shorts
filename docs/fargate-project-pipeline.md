# Fargate project pipeline runbook

New AWS jobs use pipeline version 2 and run as one AWS Batch Fargate On-Demand
job. All newly submitted projects use 8 vCPU, 16,384 MiB memory, 30 GiB
ephemeral storage, a 120-minute Batch timeout, and one Batch attempt. Initial
rendering is limited to four concurrent outputs inside the task. The legacy
4-vCPU / 30,720-MiB project definition remains registered only so an in-flight
project can resume with the same resources it started with. Edit rerenders use
the same Fargate queue with a separate 2-vCPU / 16,384-MiB definition.

## Deployment order

1. Apply `202607220001_fargate_project_pipeline.sql`.
2. Publish the immutable combined Worker image (download tools and render fonts).
3. Deploy the compute stack and Lambda handlers.
4. Deploy Web after the new RPCs and project outbox exist.

Do not remove the legacy EC2 render queue while a pipeline-version-1 prepare or
render job is active. After those jobs drain, remove the Spot and On-Demand EC2
compute environments, legacy render queue, and legacy render job definition in a
separate infrastructure deployment.

The regional Fargate On-Demand quota is 400 vCPU, allowing at most fifty 8-vCPU
project tasks to run concurrently when no other Fargate work is active.
Rerenders and other Fargate work consume the same quota. The Batch compute
environment is configured for 4,000 vCPU, so the regional service quota is the
effective limit.

## Paid-job scheduling

Before its first Batch submission, each non-terminal job receives an immutable
`dispatch_priority_class` snapshot. Only a subscription with an active or
trialing status, a monthly or yearly billing cycle, and a current entitlement
period is classified as `paid`; complimentary usage and manual usage grants
remain `free`.

The project Outbox normally leases ingestion routes to paid jobs first. A free
job waiting at least 15 minutes joins the same FIFO tier as paid work so a
continuous paid workload cannot starve it forever. AWS Batch then gives
`paid*` fair-share identifiers a `0.25` weight factor and `free*` identifiers a
`1.0` factor. This is a four-to-one compute preference, not preemption: running
jobs are never stopped, and the existing compute reservation remains enabled.
Project resumes, legacy render retries, and editor rerenders reuse the stored
snapshot.

## Production load gate

Run the load command inside the published worker image:

```sh
python fargate_render_load.py
```

It renders two 60-second comment-template outputs with 15 comments each in
parallel. Production telemetry for the 8-vCPU definition must remain below its
16-GiB task limit; the observed peak is checked during rollout. Do not enable a
new worker image in production unless the load gate passes on the target
Fargate definition.
