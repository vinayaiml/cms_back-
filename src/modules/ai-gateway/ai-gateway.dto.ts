import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class AiToolCallDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsObject()
  arguments?: Record<string, unknown>;
}

export class RobotAiConversationDto {
  @IsString()
  @MaxLength(4000)
  message!: string;

  @IsOptional()
  @IsIn(["speech", "text"])
  inputMode?: "speech" | "text";

  @IsOptional()
  @IsObject()
  contextReferences?: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => AiToolCallDto)
  requestedTool?: AiToolCallDto;
}
