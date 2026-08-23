# Changelog

## 2.4.0 - 2026-07-18

### Added

- Streamed exports: a report now downloads while it is built, so a large
  workspace no longer times out at sixty seconds.
- A `--filter` flag on `report list`, with the same syntax the web search
  box uses.

### Fixed

- A retried upload no longer duplicates the first chunk when the connection
  drops mid-request.
- Timezone handling for weekly digests scheduled on a DST boundary.

### Changed

- The default page size for list endpoints rose from 20 to 50.

## 2.3.2 - 2026-06-02

### Fixed

- A crash on startup when the config directory is read-only.

## 2.3.1 - 2026-05-20

### Fixed

- The progress bar no longer overdraws on narrow terminals.
