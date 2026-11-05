---
title: Security Policy
owner: security
version: "2026.2"
---
# Security Policy

This policy is owned by the security team of Northwind Labs. Engineers outside the security team see it
only through their team lead.

## Leaked secrets

A leaked secret is rotated within 1 hour of discovery, by the owning team, with the security engineer on call.
The rotation is recorded in a private incident; the secret value is never pasted into chat or issues.
<!-- page -->
## Vulnerability handling

Critical vulnerabilities in dependencies are patched within 72 hours, high ones within 14 days.
Security fixes to payments-service are merged only after a second review by the security team.

## Access reviews

Repository access is reviewed every quarter by each team lead.
