import { IsString, MinLength, Matches, MaxLength } from 'class-validator';

/** Staff self-registration DTO (via single-use invitation token). */
export class RegisterDto {
  @IsString()
  @MinLength(1)
  inviteToken!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(256)
  name!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(128)
  @Matches(/^[a-z0-9_.-]+$/, { message: 'lowercase letters, digits, _ . - only' })
  username!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
