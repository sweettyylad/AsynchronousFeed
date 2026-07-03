import { Module } from '@nestjs/common';

import { ImageProviderService } from './image-provider.service';

@Module({
  providers: [ImageProviderService],
  exports: [ImageProviderService],
})
export class ImageProviderModule {}
