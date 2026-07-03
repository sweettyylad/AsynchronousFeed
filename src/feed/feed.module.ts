import { Module } from '@nestjs/common';

import { ImageProviderModule } from '../image-provider/image-provider.module';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';
import { SearchResultRepository } from './search-result.repository';

@Module({
  imports: [ImageProviderModule],
  controllers: [FeedController],
  providers: [FeedService, SearchResultRepository],
})
export class FeedModule {}
