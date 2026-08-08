import { describe, expect, it } from "vitest";

import { Microservice } from "@microde/microservice";

describe("Microservice", () => {
  it("runs to successful completion when no modules are installed", async () => {
    const microservice = new Microservice();

    await expect(microservice.run()).resolves.toEqual({
      exitCode: 0,
    });
  });
});
