import { describe, expect, it } from "vitest";
import { AGENT_FUNCTIONS, isAgentFunction, parseAgentResponse } from "./agent-api";

describe("parseAgentResponse", () => {
  it("reads a success line", () => {
    const r = parseAgentResponse("SUCCESS: external_pause function set to PAUSE - agent1|PAUSE");
    expect(r.ok).toBe(true);
  });

  it("reads an error and strips the prefix for the message", () => {
    const r = parseAgentResponse("ERROR: agent is not logged in - agent1");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("agent is not logged in - agent1");
  });

  it("splits pipe-delimited rows", () => {
    expect(parseAgentResponse("1001|agent1|READY").rows).toEqual([["1001", "agent1", "READY"]]);
  });

  it("treats an empty body as a failure rather than a silent success", () => {
    const r = parseAgentResponse("   ");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/nothing/);
  });

  it("does not guess at anything it does not recognise", () => {
    const r = parseAgentResponse("<html>Service Unavailable</html>");
    expect(r.ok).toBe(false);
  });
});

describe("isAgentFunction", () => {
  it("accepts what the screen needs", () => {
    for (const fn of ["external_dial", "external_hangup", "external_status", "external_pause"]) {
      expect(isAgentFunction(fn)).toBe(true);
    }
  });

  it("refuses anything else, including real VICIdial functions we did not allow", () => {
    // These exist in the Agent API. Not being in our list is the point.
    expect(isAgentFunction("call_agent")).toBe(false);
    expect(isAgentFunction("send_notification")).toBe(false);
    expect(isAgentFunction("")).toBe(false);
    expect(isAgentFunction(null)).toBe(false);
    expect(isAgentFunction(["external_hangup"])).toBe(false);
  });

  it("has no function that could log another agent out or dial on their behalf by name", () => {
    // agent_user is resolved from the session, but keep the surface small regardless.
    expect(AGENT_FUNCTIONS).not.toContain("call_agent");
    expect(AGENT_FUNCTIONS).not.toContain("ra_call_control");
  });
});
