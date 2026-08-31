import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateSectionDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsString()
  @IsNotEmpty()
  path!: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsString()
  requiredPermission?: string;

  @IsOptional()
  @IsBoolean()
  isSuperAdminOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSectionDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  path?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsString()
  requiredPermission?: string;

  @IsOptional()
  @IsBoolean()
  isSuperAdminOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
