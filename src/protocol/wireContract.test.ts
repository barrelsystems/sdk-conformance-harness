import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import { CheckInRequest } from "./wireContract.js";

const request = {
  protocolVersion: 1,
  installationId: "00000000-0000-4000-8000-000000000001",
  eventId: "00000000-0000-4000-8000-000000000002",
  checkedInAt: "2026-01-01T00:00:00.000Z",
  sdkVersion: "test",
  channel: "stable",
  observedVersion: "1",
  platform: "test",
  arch: "test",
  osVersion: "test",
  attributes: {},
  lifecycleState: { type: "idle" },
};

describe("check-in wire metadata", () => {
  it.each([{ eventId: "constant" }, { installationId: "invalid" }, { checkedInAt: "yesterday" }])(
    "rejects malformed wire metadata: %j",
    (invalid) => {
      expect(() => Schema.decodeUnknownSync(CheckInRequest)({ ...request, ...invalid })).toThrow();
    },
  );
});
