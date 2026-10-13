import { IsString, MinLength } from 'class-validator';

/** Login request DTO. whitelist+forbidNonWhitelisted strips anything extra. */
export class LoginDto {
  @IsString()
  @MinLength(1)
  username!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
