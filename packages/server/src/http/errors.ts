import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiErrorBody } from "@trase/core";

export class ApiError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new ApiError(400, code, message, details);
export const notFound = (code: string, message: string) => new ApiError(404, code, message);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

export function requireString(body: unknown, field: string, maxLength = 500): string {
  const value = asRecord(body)[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest("INVALID_FIELD", `${field} is required`, { field });
  }
  if (value.length > maxLength) {
    throw badRequest("INVALID_FIELD", `${field} must be ${maxLength} characters or fewer`, { field });
  }
  return value.trim();
}

export function requireInt(body: unknown, field: string): number {
  const raw = asRecord(body)[field];
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw badRequest("INVALID_FIELD", `${field} must be an integer`, { field });
  }
  return value;
}

/** Parses a path parameter that must be a positive integer id. */
export function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) {
    throw badRequest("INVALID_ID", "id must be a positive integer", { id: raw });
  }
  return id;
}

/**
 * One error shape everywhere, so the frontend has exactly one thing to render:
 * { error: { code, message, details? } }
 */
export function onError(err: Error, c: Context) {
  if (err instanceof ApiError) {
    const body: ApiErrorBody = {
      error: { code: err.code, message: err.message, details: err.details },
    };
    return c.json(body, err.status);
  }

  console.error(
    JSON.stringify({ level: "error", msg: err.message, stack: err.stack, path: c.req.path }),
  );
  const body: ApiErrorBody = { error: { code: "INTERNAL", message: "Something went wrong" } };
  return c.json(body, 500);
}
