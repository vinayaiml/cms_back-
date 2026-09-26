import { IsArray, IsBoolean, IsEmail, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  // Only Super Admin can specify orgId (otherwise inferred from token)
  @IsOptional()
  @IsInt()
  orgId?: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  roleIds?: number[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionKeys?: string[];
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fullName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

export class AssignRoleDto {
  @IsInt()
  roleId!: number;
}

export class LockUserDto {
  @IsBoolean()
  locked!: boolean;
}

export class UpsertUserCapabilityAssignmentDto {
  @IsString()
  @IsNotEmpty()
  capabilityStableKey!: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsObject()
  limits?: Record<string, unknown>;
}
