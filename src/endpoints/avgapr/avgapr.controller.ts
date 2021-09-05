import { Controller, Get } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { AVGAPR, AVGAPRService } from './avgapr.service';

@Controller()
@ApiTags('AVGAPR')
export class AVGAPRController {
  constructor(private readonly avgAPRService: AVGAPRService) {}

  @Get('/getAPRAVG')
  @ApiResponse({
    status: 200,
    description: 'The average APR for all providers',
  })
  async getBlocks(): Promise<AVGAPR> {
    return await this.avgAPRService.getAVGHistory();
  }
}
