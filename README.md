# Field Meter Sync

A React Native/Expo and TypeScript mobile prototype for collecting synthetic meter readings offline, then synchronizing them with the companion C# metering API.

The client saves pending readings before sending them. Every reading keeps a stable operation ID across retries. Server conflicts remain visible for review, and credentials are stored separately through Expo SecureStore.

## Role alignment

Honeywell's Software Engineer II requisition 152359 requests mobile frameworks, APIs, .NET integration, relational data, automated testing, CI/CD, and security design. This project demonstrates the mobile and integration aspects alongside the companion API. [Official posting](https://ibqbjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Honeywell/job/152359)

## Setup

Use Node.js 22.13+ and npm.

~~~sh
git clone https://github.com/ping58972/field-sync-client.git
cd field-sync-client
npm ci
npm run typecheck
npm test
npm start
~~~

Open the app using a compatible Expo development environment. Start the [Meter Reading API](https://github.com/ping58972/meter-reading-api) with generated credentials. For Android emulator development, use `http://10.0.2.2:5079` as the API origin. For physical devices, configure an accessible HTTPS API endpoint.

Enter the API writer key, save it to SecureStore, enter MTR-001 or MTR-002, and save a whole-number cumulative reading in Wh. Tap Sync pending readings when connected.

## Architecture and skills

| Area | Implementation |
| --- | --- |
| Mobile UI | React Native controls, labelled inputs, status messages, and a review flow for rejected readings. |
| Offline state | AsyncStorage-backed outbox, bounded to 100 readings, serialized operations, validation on reload, and stable GUIDs. |
| Credential handling | SecureStore keeps the writer key separate from saved reading data. |
| API adapter | Fetch, five-second cancellation, exact acknowledgement checks, HTTPS origin validation, and error classification. |
| Retry behavior | Network/authentication failures retain pending entries. Domain rejection marks an entry blocked for review. |
| Verification | Node test runner with tsx, strict TypeScript, actual API/SQLite integration, and Android bundle export. |
| Delivery | GitHub Actions workflow and Jenkinsfile for tests, dependency checks, and bundle creation. |

The Expo SDK supplies the mobile framework and native libraries. The queue logic uses an injected storage interface so its behavior can be verified independently of device-specific storage.

## Offline recovery example

1. A reading is written to the local outbox.
2. The API accepts it and commits its SQL transaction.
3. The local acknowledgement write fails.
4. On restart, the client reloads the pending operation.
5. The API recognizes the same operation and returns a replay acknowledgement.
6. The client removes the acknowledged entry.

A server response that identifies another reading is rejected. A 400, 404, or 409 marks the entry for review. An operator explicitly confirms discarding a blocked entry. A later valid reading can continue syncing.

## End-to-end integration

Clone both repositories into the same parent folder and build the API first.

~~~sh
dotnet build ../meter-reading-api/src/Meter.Api -c Release
npx tsx tools/integration.ts ../meter-reading-api/src/Meter.Api/bin/Release/net10.0/Meter.Api.dll
~~~

The script starts the API on a temporary local port with generated credentials and a temporary database. It verifies offline persistence, accepted-request/local-write failure, replay deduplication, conflict retention, and persistence across an API restart. Set DOTNET_PATH if the SDK executable is outside PATH.

## Validation snapshot

On 2026-11-25, strict TypeScript checking passed, all 14 queue/API-adapter tests passed, the real API integration passed, and Expo exported an Android Hermes bundle successfully.

~~~sh
npm audit --audit-level=moderate
npm run export:android
~~~

The dependency audit reported zero known vulnerabilities at validation time. The manifest overrides the Expo fingerprint tool's minimatch dependency to 11.0.1 to resolve a reported moderate advisory. Type checking, tests, and bundle export passed with that override.

Native keychain/storage behavior, physical-device networking, and handheld-radio integration require device testing. The end-to-end script verifies the shared synchronization logic through a Node-backed disk adapter and the real API.

## Source guide

- [React Native application](App.tsx)
- [Persistent queue and replay behavior](src/outbox.ts)
- [HTTP contract and credential forwarding](src/api.ts)
- [Unit and failure tests](tests/outbox.test.ts)
- [Cross-repository integration script](tools/integration.ts)
- [Device test plan](docs/device-test-plan.md)

### Resume bullet

Developed a React Native/TypeScript field client with offline persistence, secure credential storage, replay-safe synchronization, and automated failure-recovery tests against a C# API.

Created by [Ping](https://github.com/ping58972).
