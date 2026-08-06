import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateEmployeeDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}
