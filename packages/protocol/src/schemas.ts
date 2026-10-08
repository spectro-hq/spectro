import common from '../schemas/common.schema.json' with { type: 'json' };
import custom from '../schemas/custom.schema.json' with { type: 'json' };
import envelope from '../schemas/envelope.schema.json' with { type: 'json' };
import error from '../schemas/error.schema.json' with { type: 'json' };
import event from '../schemas/event.schema.json' with { type: 'json' };
import interaction from '../schemas/interaction.schema.json' with { type: 'json' };
import network from '../schemas/network.schema.json' with { type: 'json' };
import page from '../schemas/page.schema.json' with { type: 'json' };
import performance from '../schemas/performance.schema.json' with { type: 'json' };
import session from '../schemas/session.schema.json' with { type: 'json' };

export type ProtocolSchemaValue =
  | string
  | number
  | boolean
  | null
  | readonly ProtocolSchemaValue[]
  | ProtocolSchemaDocument;

export interface ProtocolSchemaDocument {
  readonly [key: string]: ProtocolSchemaValue;
}

export type ProtocolSchemaName =
  | 'common'
  | 'custom'
  | 'envelope'
  | 'error'
  | 'event'
  | 'interaction'
  | 'network'
  | 'page'
  | 'performance'
  | 'session';

/** Original bundled Draft 2020-12 documents. Their $id values are identifiers, not fetch URLs. */
export const protocolSchemas: Readonly<Record<ProtocolSchemaName, ProtocolSchemaDocument>> = {
  common,
  custom,
  envelope,
  error,
  event,
  interaction,
  network,
  page,
  performance,
  session,
};
