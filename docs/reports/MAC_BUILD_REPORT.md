# GSN Paints macOS packaging report

## Summary

This report records the state as prepared on this Windows machine. It does not claim a real macOS DMG was built or tested here.

## Stage status

| Stage | Status | Evidence |
| --- | --- | --- |
| M0 baseline | DONE | Repository state, version checks, branch/tag creation, and validation commands run on Windows |
| M1 branding + shared server | DONE | Branding files updated to GSN Paints; default company name and login metadata updated |
| M2 Electron main process | PARTIAL | Electron code exists and is shared; macOS-only app-menu and packaging details remain in script/workflow form |
| M3 packaging config | DONE (prepared) | `electron-builder.yml`, `scripts/build-mac.sh`, `.github/workflows/build-mac.yml` added |
| M4 smoke validation | NOT DONE | Needs a real Mac or GitHub Actions macOS runner |
| M5 docs | DONE | Build, install, and checklist docs authored |
| M6 final verification | NOT DONE | Real DMG build and macOS verification are owner/CI jobs |

## Versions

- Electron: 22.3.27
- Node: 22.23.2 (Windows validation environment)
- npm: 11.11.1
- better-sqlite3: 11.10.0 in the main server package

## Better-sqlite3 binary proof

The repo currently uses `better-sqlite3` in the server package and keeps the default system-Node workflow separate from Electron-specific native ABI work. A real darwin binary was not built on this machine, so no packaged macOS ARM/X64 binary is claimed here.

## DMG built status

DMG built: NO — requires a Mac or the CI workflow.

## Limitations

- This Windows machine cannot launch or verify a macOS installer.
- Ad-hoc signing does not remove Gatekeeper warnings without additional owner steps.
- The old Electron 22 / Chromium 108 stack needs a real macOS validation cycle.
- No auto-update or telemetry is included.

## Questions for owner

1. Do you want the build to be created only in GitHub Actions, or do you also want a local Mac script run by a team member?
2. Which chip is the target MacBook: Apple Silicon or Intel?
3. Is a private GitHub repo acceptable for the macOS Actions workflow?
4. Do you have an Apple Developer account for notarization?

## Rollback

`git reset --hard before-gsn-mac` returns the tree to the pre-macOS-prep snapshot while preserving the repo history.

## GO / NO-GO

NO-GO for a real shipped DMG on this machine. The repo is prepared for the macOS process, but the actual package must be built and validated on a real Mac or in the macOS GitHub Actions runner.
