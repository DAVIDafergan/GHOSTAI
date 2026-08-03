import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Employee } from '@prisma/client';

export const CurrentEmployee = createParamDecorator((_: unknown, ctx: ExecutionContext): Employee => {
  return ctx.switchToHttp().getRequest().employee;
});
