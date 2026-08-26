/**
 * Standard API error envelope. Never leaks stack traces or secrets.
 */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
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
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Domain error — safe to surface a business message to the client. */
export class DomainError extends AppError {
  constructor(code: string, message: string, statusCode = 400, fieldErrors?: Record<string, string[]>) {
    super(code, message, statusCode, fieldErrors, true);
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
  constructor(message = 'Access denied') {
    super('FORBIDDEN', message, 403);
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
