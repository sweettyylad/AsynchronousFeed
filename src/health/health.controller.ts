import { Controller, Get } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

interface HealthResponse {
  status: 'ok';
}

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getHealth(): Promise<HealthResponse> {
    await this.prisma.ping();

    return { status: 'ok' };
  }
}
