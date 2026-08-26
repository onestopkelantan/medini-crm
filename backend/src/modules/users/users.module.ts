import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { UsersController } from './presentation/users.controller';
import { UserProfileService } from './application/user-profile.service';

/** UsersModule — self-service user profile (Sprint 11). */
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UserProfileService],
  exports: [UserProfileService],
})
export class UsersModule {}
