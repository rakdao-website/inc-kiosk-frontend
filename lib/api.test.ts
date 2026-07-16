import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, requestJson } from "./api";

describe("requestJson", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("throws a readable error when the backend returns plain text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });
    vi.stubGlobal(
      "fetch",
      fetchMock,
    );

    await expect(requestJson("/api/kiosk/recognize-face")).rejects.toMatchObject({
      name: "ApiRequestError",
      message: "Backend server returned an internal error. Please check that the backend is running on port 8000.",
      status: 500,
    } satisfies Partial<ApiRequestError>);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/kiosk/recognize-face",
      expect.any(Object),
    );
  });

  it("throws a readable error when the backend cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(requestJson("/api/kiosk/recognize-face")).rejects.toMatchObject({
      name: "ApiRequestError",
      message: "Backend server is not reachable. Please check that it is running on port 8000.",
      status: 0,
    } satisfies Partial<ApiRequestError>);
  });
});
