import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';

import { FeedService } from './feed.service';
import { FeedQueryDto, SubmitSearchDto } from './dto';

@Controller('api')
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @Post('searches')
  @HttpCode(HttpStatus.ACCEPTED)
  submitSearch(@Body() dto: SubmitSearchDto) {
    return this.feedService.submitSearch(dto.query);
  }

  @Get('feed')
  getFeed(@Query() dto: FeedQueryDto) {
    return this.feedService.getFeed(dto.query);
  }
}
