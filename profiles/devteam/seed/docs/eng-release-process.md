---
title: Release Process
owner: platform
version: "2026.4"
---
# Release Process

Northwind Labs ships platform-api and platform-web every Tuesday and Thursday. Releases are cut from main
and tagged with the calendar version, for example 2026.11.2.

## Release checklist

1. All required checks on main are green.
2. The changelog lists every merged pull request since the last tag.
3. Database migrations are backward compatible with the previous release.
4. The release owner announces the release in the platform channel.
<!-- page -->
## Release freeze

A release freeze starts 48 hours before a product launch and ends after the launch review.
During a freeze only fixes for incidents of severity 1 or 2 are merged, each with a maintainer approval.

## Hotfixes

A hotfix branch starts from the last release tag. It is merged back into main on the same day.
