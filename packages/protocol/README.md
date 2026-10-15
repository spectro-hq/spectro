# @spectro/protocol

Spectro Protocol V1 JSON Schemas, TypeScript types, serialization limits and strict validators. The common event envelope and event-specific payloads are shared by SDKs and server services.

```ts
import { validateEnvelope, protocolSchemas } from '@spectro/protocol';

const result = validateEnvelope({ version: 1, sentAt: Date.now(), items: [] });
console.log(result.success);
console.log(protocolSchemas.event.$id);
```

Original JSON Schemas are also exported through `@spectro/protocol/schemas/*.json`. Package release versions are independent of event and envelope protocol versions. The package is ESM; Node consumers need a runtime that supports JSON import attributes (Node 22.12+).

MIT, including this package's original schemas. See LICENSE. Platform services outside this package are not covered by this license.
