/**
 * Standard API error envelope. Never leaks stack traces or secrets.
 */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
    /** Optional machine-readable context for a gated action (e.g. which safety
     *  gate blocked a send). Never carries secrets. */
    details?: Record<string, unknown>;
    correlationId: string;
  };
}

/** Base application error. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly fieldErrors?: Record<string, string[]>,
    public readonly expose: boolean = false,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Domain error — safe to surface a business message to the client. */
export class DomainError extends AppError {
  constructor(
    code: string,
    message: string,
    statusCode = 400,
    fieldErrors?: Record<string, string[]>,
    details?: Record<string, unknown>,
  ) {
    super(code, message, statusCode, fieldErrors, true, details);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id?: string) {
    super('NOT_FOUND', `${entity} not found${id ? `: ${id}` : ''}`, 404);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Access denied', details?: Record<string, unknown>) {
    super('FORBIDDEN', message, 403, undefined, details);
    this.name = 'ForbiddenError';
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Authentication required') {
    super('UNAUTHORIZED', message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ValidationError extends DomainError {
  constructor(fieldErrors: Record<string, string[]>, message = 'Validation failed') {
    super('VALIDATION_ERROR', message, 422, fieldErrors);
    this.name = 'ValidationError';
  }
}

export class ConflictError extends DomainError {
  constructor(message = 'Conflict') {
    super('CONFLICT', message, 409);
    this.name = 'ConflictError';
  }
}

/**
 * Upstream AI provider is not usable right now — missing credentials, rejected
 * key, rate limit, or timeout. Distinct from a generic 500 on purpose: the
 * caller finds out the prompt is fine and the MODEL is the problem, so an
 * operator does not go hunting through their prompt text for a fault that is
 * not there.
 */
export class AiProviderUnavailableError extends DomainError {
  constructor(message: string) {
    super('AI_PROVIDER_UNAVAILABLE', message, 503);
    this.name = 'AiProviderUnavailableError';
  }
}
