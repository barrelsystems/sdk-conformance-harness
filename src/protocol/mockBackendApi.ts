import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { CheckInResponse, PreActionCheckRequest } from "./wireContract.js";

/** The harness's own simulation of Barrel's real ingestion endpoint. Every
 * scenario configures what this server returns before pointing a test
 * service's adapter at it. */
export class MockBackendApi extends HttpApiGroup.make("ingestion")
  .add(
    HttpApiEndpoint.post("checkIn", "/check-in", {
      headers: { authorization: Schema.String },
      payload: Schema.Unknown,
      success: CheckInResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("preActionCheck", "/pre-action-check", {
      headers: { authorization: Schema.String },
      payload: PreActionCheckRequest,
      success: CheckInResponse,
    }),
  ) {}

export class MockBackendHttpApi extends HttpApi.make("barrel-mock-backend").add(MockBackendApi) {}
