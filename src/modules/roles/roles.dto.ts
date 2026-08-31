import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class AddRolePermissionDto {
  @IsString()
  @IsNotEmpty()
  permissionKey!: string;
}

export class RemoveRolePermissionDto {
  @IsString()
  @IsNotEmpty()
  permissionKey!: string;
}
