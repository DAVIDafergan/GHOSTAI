import { IsEmail } from 'class-validator';

export class CreateEmployeeDto {
  @IsEmail()
  email: string;
}
