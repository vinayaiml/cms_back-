import { IsArray, IsEmail, IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export const INDIAN_STATES = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
] as const;

export type IndianState = (typeof INDIAN_STATES)[number];

export class CreateOrgDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(INDIAN_STATES)
  state!: IndianState;

  @IsString()
  @IsNotEmpty()
  city!: string;

  @IsString()
  @IsNotEmpty()
  authorizedPersonName!: string;

  @IsString()
  @IsNotEmpty()
  contactNo!: string;

  @IsEmail()
  @IsNotEmpty()
  email!: string;
}

export class UpdateOrgDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(INDIAN_STATES)
  state!: IndianState;

  @IsString()
  @IsNotEmpty()
  city!: string;

  @IsString()
  @IsNotEmpty()
  authorizedPersonName!: string;

  @IsString()
  @IsNotEmpty()
  contactNo!: string;
}

export class UpdateOrgPermissionsDto {
  @IsArray()
  @IsString({ each: true })
  permissionKeys!: string[];
}

export class AssignOrgSubscriptionDto {
  @IsInt()
  planId!: number;

  @IsOptional()
  @IsString()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @IsISO8601()
  validFrom!: string;

  @IsISO8601()
  validUntil!: string;
}
