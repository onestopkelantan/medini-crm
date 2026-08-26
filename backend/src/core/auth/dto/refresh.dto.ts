import { IsString, MinLength } from 'class-validator';

/** Refresh request DTO. whitelist+forbidNonWhitelisted strips anything extra. */
export class RefreshDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}
