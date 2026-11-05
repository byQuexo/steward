---
title: On-call Runbook (scan)
owner: oncall
version: "2026.2"
scanned: true
---
# On-call Runbook

The on-call SRE carries the pager for one week, Monday 10:00 to Monday 10:00 UTC.
Acknowledge a page within 5 minutes and open an incident in the incident queue within 15 minutes.

1. Check the status dashboard and the latest deploys.
2. Name an incident lead for severity 1 and 2.
3. Post updates in the oncall channel every 30 minutes.
<!-- page -->
## payments-service returns 503

If payments-service returns 503 errors after a deploy, roll back the deploy with nwctl rollback payments-service.
When the error rate stays above 1 percent for 10 minutes after the rollback, page the payments team lead.

## Build runners out of disk

Prune the Docker image cache with nwctl runners prune. Runners above 95 percent are drained first.
