export class ApiRequestError extends Error {
  status: number;
  errorCode?: string;

  constructor(message: string, status: number, errorCode?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.errorCode = errorCode;
  }
}

type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  data: T;
  error_code?: string;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

export async function requestJson<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
  } catch (error) {
    throw new ApiRequestError(
      "Backend server is not reachable. Please check that it is running on port 8000.",
      0,
    );
  }

  const responseText = await response.text();
  let payload: ApiEnvelope<T> | null = null;

  if (responseText.trim()) {
    try {
      payload = JSON.parse(responseText) as ApiEnvelope<T>;
    } catch {
      const plainMessage = responseText.trim();
      const message =
        response.status === 500 && plainMessage === "Internal Server Error"
          ? "Backend server returned an internal error. Please check that the backend is running on port 8000."
          : plainMessage
            ? `Backend returned ${plainMessage}.`
            : "Backend returned an unexpected response.";
      throw new ApiRequestError(
        message,
        response.status,
      );
    }
  }

  if (!payload) {
    throw new ApiRequestError("Backend returned an empty response.", response.status);
  }

  if (!response.ok || payload.success === false) {
    throw new ApiRequestError(
      payload.message || "Request failed",
      response.status,
      payload.error_code,
    );
  }

  return payload.data;
}
