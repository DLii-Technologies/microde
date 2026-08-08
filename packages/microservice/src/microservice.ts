export interface MicroserviceExecutionResult {
  exitCode: number;
  error?: unknown;
}

export class Microservice {
  async run(): Promise<MicroserviceExecutionResult> {
    return { exitCode: 0 };
  }
}
