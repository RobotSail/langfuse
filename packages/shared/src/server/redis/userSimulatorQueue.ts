import { Queue } from "bullmq";
import { QueueName, TQueueJobTypes } from "../queues";
import {
  createNewRedisInstance,
  redisQueueRetryOptions,
  getQueuePrefix,
} from "./redis";
import { logger } from "../logger";

export class UserSimulatorQueue {
  private static instance: Queue<
    TQueueJobTypes[QueueName.UserSimulatorQueue]
  > | null = null;

  public static getInstance(): Queue<
    TQueueJobTypes[QueueName.UserSimulatorQueue]
  > | null {
    if (UserSimulatorQueue.instance) return UserSimulatorQueue.instance;

    const newRedis = createNewRedisInstance({
      enableOfflineQueue: false,
      ...redisQueueRetryOptions,
    });

    UserSimulatorQueue.instance = newRedis
      ? new Queue<TQueueJobTypes[QueueName.UserSimulatorQueue]>(
          QueueName.UserSimulatorQueue,
          {
            connection: newRedis,
            prefix: getQueuePrefix(QueueName.UserSimulatorQueue),
            defaultJobOptions: {
              removeOnComplete: true,
              removeOnFail: 1_000,
              attempts: 3,
              backoff: {
                type: "exponential",
                delay: 5000,
              },
            },
          },
        )
      : null;

    UserSimulatorQueue.instance?.on("error", (err) => {
      logger.error("UserSimulatorQueue error", err);
    });

    return UserSimulatorQueue.instance;
  }
}
