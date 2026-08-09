import {
  edgeOnePrefetchAutomaticRetryStatusValues,
  edgeOnePrefetchFailureStatusValues,
  edgeOnePrefetchStatusValues,
  isEdgeOnePrefetchAutomaticRetryStatus,
  isEdgeOnePrefetchFailureStatus,
  type EdgeOnePrefetchStatus
} from "@event-arts/shared";

const transitions = {
  reserved: ["submitting", "failed", "invalid"],
  submitting: ["processing", "failed", "timeout"],
  processing: ["success", "failed", "timeout", "canceled", "invalid"],
  success: [],
  failed: ["reserved"],
  timeout: ["reserved"],
  canceled: ["reserved"],
  invalid: ["reserved"]
} as const satisfies Record<EdgeOnePrefetchStatus, readonly EdgeOnePrefetchStatus[]>;

export const edgeOnePrefetchTransitionTable: Readonly<
  Record<EdgeOnePrefetchStatus, readonly EdgeOnePrefetchStatus[]>
> = transitions;

export function canTransitionPrefetchStatus(
  from: EdgeOnePrefetchStatus,
  to: EdgeOnePrefetchStatus
) {
  return from === to || edgeOnePrefetchTransitionTable[from].includes(to as never);
}

export function assertPrefetchStatusTransition(
  from: EdgeOnePrefetchStatus,
  to: EdgeOnePrefetchStatus
) {
  if (!canTransitionPrefetchStatus(from, to)) {
    throw new Error(`Illegal EdgeOne prefetch status transition: ${from} -> ${to}`);
  }
}

export function shouldSkipPrefetchStatus(status: EdgeOnePrefetchStatus) {
  return status === "reserved"
    || status === "submitting"
    || status === "processing"
    || status === "success";
}

export function isPrefetchTerminalStatus(status: EdgeOnePrefetchStatus) {
  return status === "success"
    || status === "canceled"
    || status === "invalid";
}

export function isPrefetchRetryableStatus(status: EdgeOnePrefetchStatus) {
  return isEdgeOnePrefetchAutomaticRetryStatus(status);
}

export function isPrefetchFailureStatus(status: EdgeOnePrefetchStatus) {
  return isEdgeOnePrefetchFailureStatus(status);
}

export function parseEdgeOnePrefetchStatus(value: string): EdgeOnePrefetchStatus {
  if ((edgeOnePrefetchStatusValues as readonly string[]).includes(value)) {
    return value as EdgeOnePrefetchStatus;
  }
  throw new Error("Unknown EdgeOne prefetch status");
}

export const edgeOnePrefetchFailureStatuses = edgeOnePrefetchFailureStatusValues;
export const edgeOnePrefetchAutomaticRetryStatuses = edgeOnePrefetchAutomaticRetryStatusValues;
