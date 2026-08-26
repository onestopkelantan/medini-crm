import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * PasswordService — Argon2id hashing. Approved direction from the blueprint.
 *
 * Rules:
 *  - never store plaintext passwords
 *  - never log passwords or hashes
 *  - never return hashes to the client
 *  - constant-time verification (argon2.verify is constant-time)
 *  - a verify against a DUMMY hash is used for unknown users so the response
 *    time does not reveal whether the account exists (no user enumeration).
 */
@Injectable()
export class PasswordService {
  /** Precomputed dummy hash used to equalize timing for unknown users. */
  private dummyHash: string | null = null;

  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false; /* malformed hash → treat as mismatch, never throw */
    }
  }

  /**
   * Timing-safe verify for login: when the user does not exist we still run a
   * verify against a dummy hash so attackers cannot distinguish "no such user"
   * from "wrong password" by response latency.
   */
  async verifyLogin(storedHash: string | null, plain: string): Promise<boolean> {
    if (storedHash) return this.verify(storedHash, plain);
    if (!this.dummyHash) this.dummyHash = await this.hash('dummy-' + Math.random());
    await this.verify(this.dummyHash, plain);
    return false;
  }
}
