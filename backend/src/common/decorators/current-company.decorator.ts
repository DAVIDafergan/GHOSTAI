import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Company } from '@prisma/client';

export const CurrentCompany = createParamDecorator((_: unknown, ctx: ExecutionContext): Company => {
  return ctx.switchToHttp().getRequest().company;
});
