/**
 * Message Bus type definitions for inter-agent communication.
 */

export interface MessageBase {
  id: string;
  sourceAgentId: string;
  targetAgentId: string | null;
  correlationId: string;
  timestamp: number;
  topic: string;
}

export interface RequestMessage extends MessageBase {
  type: 'request';
  payload: Record<string, unknown>;
}

export interface ResponseMessage extends MessageBase {
  type: 'response';
  payload: Record<string, unknown>;
}

export interface EventMessage extends MessageBase {
  type: 'event';
  payload: Record<string, unknown>;
}

export interface ErrorMessage extends MessageBase {
  type: 'error';
  payload: {
    code: string;
    description: string;
    details?: Record<string, unknown>;
  };
}

export type BusMessage = RequestMessage | ResponseMessage | EventMessage | ErrorMessage;
