import type { QueueMessage } from "../contracts/queue-event";

export interface TaskDispatchResult {
  dispatchId: string;
  duplicate: boolean;
}

export interface TaskDispatcher {
  dispatch(message: QueueMessage): Promise<TaskDispatchResult>;
}
