# Device verification plan

## Automated checks

Run npm ci, strict type checking, the 14 test cases, the real API integration script, and Android export. The tests cover concurrent storage updates, replay after a failed local write, bounded capacity, bad saved data, rejected server values, origin validation, and acknowledgement identity.

## Manual device acceptance

| Scenario | Steps | Expected |
| --- | --- | --- |
| Save offline | Disable network, enter a valid reading, save offline. | Reading appears locally and survives app restart. |
| Restore connection | Enable connectivity and sync. | One API reading and event; local entry disappears after acknowledgement. |
| Invalid key | Enter an invalid key and sync. | Pending value remains available for retry. |
| Domain conflict | Save a value lower than the server's cumulative value. | Entry is blocked and retained for review. |
| Reviewed discard | Open the blocked-entry review action and cancel once, then confirm. | Cancel retains data; explicit confirmation removes the selected blocked entry. |
| Key storage | Save a key, restart app, and inspect behavior. | SecureStore restores the key independently of reading data. |
| Concurrent actions | Tap sync repeatedly while a request runs. | UI prevents repeated actions; core serialization prevents duplicate dispatch. |
| Device failure | Interrupt the app around acknowledgement persistence. | Original operation ID is retried and the API deduplicates it. |

Record the OS/device, Expo build, API commit, test steps, expected/actual behavior, and observed error before making device-specific claims.

## Security review

The API origin validator permits HTTPS remote connections and local-development HTTP origins. Credentials stay out of the outbox. Requests time out after five seconds and reject redirects. Server errors retain the submitted value. Saved outbox data is validated before use.

Future work includes credential rotation, enrollment, fleet/tenant scoping, an authenticated device management flow, and tested Bluetooth transport adapters.
