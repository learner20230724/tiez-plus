# Source provenance

- Desktop: jimuzhe/tiez-clipboard v0.3.3, cc2a88a96ff1bc74cfa331441bd0bd630b911f70, plus the existing local Windows clipboard and MQTT patches. GPL-3.0.
- Mobile: jimuzhe/tiez-mobile 6199c1f1b59bfe48abfafe2f065fa0c89dcd426b plus 4828a48dd8b56a5f34cc5c61858467c9c4ad8fab. GPL-3.0.
- Broker: based on learner20230724/tiez-local-mqtt-server 4ac039a and local Windows-service work. Original MIT notice retained.
- Snapshot copied without dependencies, build outputs, runtime data, credentials or upstream Git history. Original source hashes retained to verify isolation.
- Plus is an independent derivative, not an official TieZ release.

## Selective updates (not a beta branch merge)

Reviewed desktop master `40f7305` and beta snapshot `862f1d9` using a read-only upstream checkout. Original source snapshots remain unchanged.

| Upstream | Plus treatment |
| --- | --- |
| `4ebbbdf` tag search | Ported repository tag matching, command arguments, filtered-history and pagination handling. Plus commit `400c9c3`. |
| `d499eda` modifier release | Ported Ctrl/Alt/Shift release alongside both Windows keys, retaining existing local focus/native clipboard retry code. Part of `ff9c467`. |
| `885782d` WPS rich text | Selective port: preserve significant text whitespace in normalization, preserve meaningful Office CSS, remove inverted/rotated preview styles, reset WebKit rich-preview clamping. Existing local rich-format/RTF capture code retained. **Not** a claim that all 665 lines of the beta patch were transplanted. |
| `bc688e2`, `40c482a` file transfer hardening | Adapted session authorization to this v0.3.3 base rather than merging incompatible beta UI: token rotation, native Bearer/browser same-origin cookie, authenticated media URLs, filename/upload ID validation, bounded ordered chunks, mobile base64 chunk endpoint. Plus commit `a68ae68`. |

Theme store, non-Windows platform expansion, beta-wide encryption migration and upstream release publishing are deliberately excluded. Mobile TypeScript `fontWeight: "650"` was corrected to a supported value. Legacy phone text composition in the file-transfer tab is replaced with a link to the durable Plus composer; the browser file page is now file-only so it cannot silently bypass receipt semantics.

Original repositories:
- https://github.com/jimuzhe/tiez-clipboard
- https://github.com/jimuzhe/tiez-mobile (custom mobile fixes: https://github.com/learner20230724/tiez-mobile)
- https://github.com/learner20230724/tiez-local-mqtt-server
