# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-10-22

First public release.

### Added

- A colored label with the tenant's name on each Kanban card tile in Hermes
  Desktop. Cards without a tenant get no label, and card titles stay unchanged.
- Automatic colors: each tenant gets one of 12 hues based on its name. With up
  to 12 tenants and no pins, every tenant gets a different hue.
- Pinned colors in Settings → Plugins → Kanban Tenant Labels.
- Board data read from the Kanban plugin's query cache, with no backend, no
  network requests and no telemetry.
- A `[hermes-kanban-tenant-labels]` console warning when Desktop's markup or
  data no longer matches. The board keeps working.
- Installation from Git in Hermes Desktop, with `hermes plugins install`, or
  with a `hermes://plugin/install` link.

[0.3.0]: https://github.com/mszenfeld/hermes-kanban-tenant-labels/releases/tag/v0.3.0
