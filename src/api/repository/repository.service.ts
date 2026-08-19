import { ConfigService } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { PrismaClient } from '@prisma/client';

export class Query<T> {
  where?: T;
  sort?: 'asc' | 'desc';
  page?: number;
  offset?: number;
}

const POOL_LIMIT = 2;

export function prismaPoolUrl(url: string): string {
  if (!url) return url;
  const separator = url.includes('?') ? '&' : '?';
  const connLimit = `${separator}connection_limit=${POOL_LIMIT}`;
  if (url.includes('connection_limit=')) return url;
  return url + connLimit;
}

export class PrismaRepository extends PrismaClient {
  constructor(private readonly configService: ConfigService) {
    super({
      datasources: {
        db: {
          url: prismaPoolUrl(
            configService.get<{ CONNECTION: { URI: string } }>('DATABASE').CONNECTION.URI ?? '',
          ),
        },
      },
    });
  }

  private readonly logger = new Logger('PrismaRepository');

  public async onModuleInit() {
    await this.$connect();
    this.logger.info('Repository:Prisma - ON');
  }

  public async onModuleDestroy() {
    await this.$disconnect();
    this.logger.warn('Repository:Prisma - OFF');
  }
}
