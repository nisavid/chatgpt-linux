---
name: upstream-dmg-watchdog
description: Non-executable historical record for the retired and unsupported ChatGPT for Linux repository; do not use it to start or continue maintenance.
---

# Historical Official DMG Watchdog Skill

> [!IMPORTANT]
> This repository is retired and unsupported. Do not run this skill to start
> or continue probing, worker dispatch, repair, pull-request, or Nix refresh
> work. See [Repository Retirement](../../../docs/retirement.md).

This file is a non-executable historical record. The former watchdog compared
the mutable official DMG with an accepted identity, coordinated one bounded
worker campaign, recorded acceptance, and reconciled drift issues.

Retirement removed its schedules, write-capable workflows, repair producer,
and package-refresh path. The retained public watchdog program exposes only
read-only status; former mutating modes fail closed. Git history preserves the
last operational protocol and its validation evidence.
