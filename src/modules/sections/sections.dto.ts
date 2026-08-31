import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

// TemplateType is validated in service (zod) to keep DTO flexible.

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

  // Template-driven dashboards
  @IsOptional()
  @IsString()
  templateType?: string;

  @IsOptional()
  templateConfig?: any;
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

  @IsOptional()
  @IsString()
  templateType?: string;

  @IsOptional()
  templateConfig?: any;
}
